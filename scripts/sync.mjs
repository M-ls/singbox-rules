import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = path.join(root, '.work');
const fields = ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'];
const check = process.argv.includes('--check');
const allowLargeChange = process.argv.includes('--allow-large-change');
const binIndex = process.argv.indexOf('--sing-box');
const singBox = binIndex < 0 ? 'sing-box' : process.argv[binIndex + 1];
if (!singBox) throw new Error('--sing-box needs a path');

const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stableSort = (values) => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const authHeader = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'singbox-rules-sync', ...authHeader },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
  return response.text();
}

function extract(input, label) {
  if (!input || !Array.isArray(input.rules) || input.rules.length === 0) {
    throw new Error(`${label}: no rules`);
  }
  const output = Object.fromEntries(fields.map((field) => [field, []]));
  for (const rule of input.rules) {
    if (rule.type === 'logical' || rule.invert) {
      throw new Error(`${label}: logical or inverted rules cannot be flattened`);
    }
    const unexpected = Object.keys(rule).filter((key) => key !== 'type' && !fields.includes(key));
    if (unexpected.length || (rule.type !== undefined && rule.type !== 'default')) {
      throw new Error(`${label}: unsupported rule fields or type: ${unexpected.join(', ') || rule.type}`);
    }
    for (const field of fields) {
      if (rule[field] === undefined) continue;
      const values = Array.isArray(rule[field]) ? rule[field] : [rule[field]];
      for (const value of values) {
        if (typeof value !== 'string' || !value.trim() || /\s/.test(value)) {
          throw new Error(`${label}: invalid ${field} value`);
        }
        output[field].push(field === 'domain_regex' ? value.trim() : value.trim().toLowerCase());
      }
    }
  }
  if (fields.every((field) => output[field].length === 0)) {
    throw new Error(`${label}: no domain fields`);
  }
  return output;
}

async function mapLimited(items, limit, action) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await action(items[index]);
    }
  }));
  return result;
}

const manifest = await readJson('sources.json');
if (manifest.version !== 1 || !Array.isArray(manifest.repositories)) {
  throw new Error('Unsupported sources.json');
}
const seed = extract(await readJson('overrides/streaming-seed.json'), 'streaming seed');
const repositories = await Promise.all(manifest.repositories.map(async (repository) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository.repo)
      || !/^[\w.-]+$/.test(repository.ref)
      || !Array.isArray(repository.sets)) {
    throw new Error('Invalid repository manifest entry');
  }
  const apiUrl = `https://api.github.com/repos/${repository.repo}/commits/${repository.ref}`;
  const commit = JSON.parse(await fetchText(apiUrl));
  if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error(`Invalid commit SHA for ${repository.repo}`);
  return { ...repository, commit: commit.sha };
}));

const requests = repositories.flatMap((repository) => repository.sets.map((set) => {
  if (!/^[a-z0-9-]+$/.test(set)) throw new Error(`Invalid set name: ${set}`);
  const file = [repository.directory, `${set}.json`].filter(Boolean).join('/');
  return {
    name: `${repository.repo}/${set}`,
    repo: repository.repo,
    commit: repository.commit,
    file,
    url: `https://raw.githubusercontent.com/${repository.repo}/${repository.commit}/${file}`,
  };
}));

const upstream = await mapLimited(requests, 6, async (request) => {
  const body = await fetchText(request.url);
  const values = extract(JSON.parse(body), request.name);
  return {
    ...request,
    values,
    sha256: hash(body),
    count: Object.fromEntries(fields.map((field) => [field, values[field].length])),
  };
});

const combined = Object.fromEntries(fields.map((field) => [field, new Set(seed[field])]));
for (const source of upstream) {
  for (const field of fields) {
    for (const value of source.values[field]) combined[field].add(value);
  }
}
const rule = Object.fromEntries(fields
  .map((field) => [field, stableSort(combined[field])])
  .filter(([, values]) => values.length > 0));
const total = Object.values(rule).reduce((sum, values) => sum + values.length, 0);
if (total < 300) throw new Error(`Suspiciously small streaming set: ${total}`);
const output = `${JSON.stringify({ version: 2, rules: [rule] }, null, 2)}\n`;
const outputPath = path.join(root, 'rules', 'streaming.json');
const binaryPath = path.join(root, 'rules', 'streaming.srs');
const previous = await readFile(outputPath, 'utf8').catch(() => null);
if (previous && !allowLargeChange) {
  const old = extract(JSON.parse(previous), 'previous streaming set');
  const oldTotal = fields.reduce((sum, field) => sum + old[field].length, 0);
  if (total < oldTotal * 0.85 || total > oldTotal * 1.5) {
    throw new Error(`Large rule count change: ${oldTotal} -> ${total}; review with --allow-large-change`);
  }
}

await mkdir(work, { recursive: true });
const tempJson = path.join(work, 'streaming.json');
const tempSrs = path.join(work, 'streaming.srs');
await writeFile(tempJson, output, 'utf8');
execFileSync(singBox, ['rule-set', 'compile', '-o', tempSrs, tempJson], { stdio: 'inherit' });
const generatedBinary = await readFile(tempSrs);
const previousBinary = await readFile(binaryPath).catch(() => null);
const contentChanged = previous !== output;
const binaryChanged = !previousBinary?.equals(generatedBinary);
const lock = {
  version: 1,
  sources: upstream.map(({ name, repo, commit, file, sha256, count }) => ({
    name, repo, commit, file, sha256, count,
  })),
  output: { sha256: hash(output), total, count: Object.fromEntries(fields.map((field) => [field, rule[field]?.length ?? 0])) },
};
const lockPath = path.join(root, 'sources.lock.json');
const lockContent = `${JSON.stringify(lock, null, 2)}\n`;
const previousLock = await readFile(lockPath, 'utf8').catch(() => null);
const lockChanged = previousLock !== lockContent;
if (check) {
  if (contentChanged || binaryChanged || lockChanged) {
    throw new Error('Generated streaming rules or source lock differ; run sync and review the changes');
  }
} else {
  if (contentChanged) await copyFile(tempJson, outputPath);
  if (lockChanged) await writeFile(lockPath, lockContent, 'utf8');
  if (binaryChanged) await copyFile(tempSrs, binaryPath);
}
console.log(`Streaming rules: ${total} entries from ${upstream.length} upstream sets + local seed`);
console.log(`JSON ${contentChanged ? 'changed' : 'unchanged'}, SRS ${binaryChanged ? 'changed' : 'unchanged'}, lock ${lockChanged ? 'changed' : 'unchanged'}`);
