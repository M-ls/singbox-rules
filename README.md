# singbox-rules

个人 sing-box 分流规则集。这里只发布可审阅的域名规则和编译产物，不发布节点、DNS 凭据或完整运行配置。

## 规则文件

| 文件 | 用途 |
| --- | --- |
| `rules/streaming.json` / `rules/streaming.srs` | 流媒体聚合规则，供专用流媒体出口使用 |
| `rules/non-cn.json` / `rules/non-cn.srs` | 旧配置首条规则的等价备份，含流媒体和 AI 等站点，不应当作纯流媒体规则 |

`streaming` 从 `overrides/streaming-seed.json` 和 `sources.json` 中指定的 28 个上游服务规则合并，去重并按字典序输出。`sources.lock.json` 记录每个上游文件对应的提交和内容哈希。只提取域名、域名后缀、域名关键词和域名正则；不合并 IP 规则，因此不会把共享 CDN 的 IP 整段划给流媒体。

初始 seed 由旧 `non-cn` 列表筛出流媒体相关条目，剔除了 AI 和明显通用的域名，并补入解锁检测所用的具体服务主机。它是人工维护的补丁层；上游同步不会覆盖它。

## 更新与上游同步

需要 Node.js 22+ 和 sing-box。直接运行：

```powershell
node scripts/sync.mjs --sing-box path/to/sing-box
node scripts/sync.mjs --check --sing-box path/to/sing-box
```

脚本先把两个上游仓库的分支固定到本次运行的提交，再下载列出的 JSON 文件。任何文件下载或解析失败都会停止，不会生成部分更新。与现有规则相比，条目减少超过 15% 或增加超过 50% 时也会停止，须审阅后显式传入 `--allow-large-change`。

`.github/workflows/sync-streaming.yml` 每周运行一次，也可手动触发；变化会提出 PR，**不会自动合并到 `main`**。PR 中检查 `rules/streaming.json` 的域名差异及 `sources.lock.json` 的上游来源。CI 使用固定版本和 SHA-256 校验的 sing-box 编译器。GitHub 仓库需要允许 Actions 创建 PR；如果此设置关闭，手动运行上述命令并提交即可。

## 接入 singbox-gui

在本地 `tagss.overrides.json` 中增加一个空成员的 `selector` 组，例如 `📺 流媒体`。订阅转换器会自动把订阅节点加入这个组；组里不要放直连出口。选择 `tw02` 时，流媒体目标域名应由该 Shadowsocks 节点的远端处理。

在 `route_rules` 的现有大域名规则和通用 `resolve` 规则**之前**加入：

```json
{
  "rule_set": ["cfg-streaming-rule"],
  "action": "route",
  "outbound": "📺 流媒体"
}
```

并在 `rule_set` 增加：

```json
{
  "type": "remote",
  "tag": "cfg-streaming-rule",
  "format": "binary",
  "url": "https://raw.githubusercontent.com/M-ls/singbox-rules/main/rules/streaming.srs"
}
```

**不要**给这条流媒体规则先执行 `route action: resolve`：那会由客户端的指定 DNS 服务器先解析目的地址，无法保证选中节点自己解析。HTTP/SOCKS 入口把域名交给代理节点；TUN 模式下单独的 DNS 请求会被本地 DNS 劫持。可在现有 `dns.servers`、`dns.rules` 和 `cache_file` 中分别合并以下字段，让流媒体 DNS 返回 FakeIP，使后续连接仍带域名进入选中的节点：

```json
{
  "dns": {
    "servers": [
      {"type": "fakeip", "tag": "cfg-streaming-fakeip", "inet4_range": "198.18.0.0/15"}
    ],
    "rules": [
      {"inbound": ["tun-in"], "rule_set": ["cfg-streaming-rule"], "action": "route", "server": "cfg-streaming-fakeip"}
    ]
  },
  "cache_file": {"enabled": true, "store_fakeip": true}
}
```

现有 `dns-alias-local` 可继续处理其他域名。应用自行使用外部 DoH 或直接访问 IP 时，域名规则无法保证命中；选中的节点也须支持转发域名。具体配置变更需在 `.srs` 发布后应用并实测。

当前规则源文件格式为 sing-box source version 2，适用于本仓库所用的域名字段。完整上游信息及许可证见 [NOTICE.md](NOTICE.md)。
