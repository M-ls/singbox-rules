# singbox-rules

供 sing-box 使用的域名规则集。仓库包含可审阅的规则源文件和编译产物。

## 规则文件

| 文件 | 用途 |
| --- | --- |
| `rules/streaming.json` / `rules/streaming.srs` | 以流媒体为主的聚合规则，另含少量 AI 域名，共用专用出口 |
| `rules/non-cn.json` / `rules/non-cn.srs` | 历史兼容规则，混合多个服务类别，不应当作纯流媒体规则 |

`streaming` 从 `overrides/streaming-seed.json` 和 `sources.json` 中指定的 28 个上游服务规则合并，去重并按字典序输出。`sources.lock.json` 记录每个上游文件对应的提交和内容哈希。只提取域名、域名后缀、域名关键词和域名正则；不合并 IP 规则，因此不会把共享 CDN 的 IP 整段划给流媒体。

本地 seed 补充上游未覆盖的服务域名，包括指定的 AI 服务及其依赖域名。它由维护者审阅；上游同步不会覆盖它。`intercom.io` 是多个应用共用的服务域名，命中它的其他应用也会使用同一出口。

## 更新与上游同步

需要 Node.js 22+ 和 sing-box。直接运行：

```powershell
node scripts/sync.mjs --sing-box path/to/sing-box
node scripts/sync.mjs --check --sing-box path/to/sing-box
```

脚本先把两个上游仓库的分支固定到本次运行的提交，再下载列出的 JSON 文件。任何文件下载或解析失败都会停止，不会生成部分更新。与现有规则相比，条目减少超过 15% 或增加超过 50% 时也会停止，须审阅后显式传入 `--allow-large-change`。

`.github/workflows/sync-streaming.yml` 每周运行一次，也可手动触发；变化会提出 PR，**不会自动合并到 `main`**。PR 中检查 `rules/streaming.json` 的域名差异及 `sources.lock.json` 的上游来源。CI 使用固定版本和 SHA-256 校验的 sing-box 编译器。GitHub 仓库需要允许 Actions 创建 PR；如果此设置关闭，手动运行上述命令并提交即可。

## 接入 sing-box

创建一个专用于此规则集的出站选择器，例如 `streaming-out`，并将支持转发域名的代理出站加入其中。规则集内的 AI 域名也会使用这个出口。示例中的标签和入站名称应按实际配置调整。

在 `route.rules` 中，将流媒体规则放在通用 `resolve` 规则之前：

```json
{
  "rule_set": ["streaming-rule"],
  "action": "route",
  "outbound": "streaming-out"
}
```

在 `route.rule_set` 中增加远程规则集（将 `<owner>/<repo>` 换成实际仓库地址）：

```json
{
  "type": "remote",
  "tag": "streaming-rule",
  "format": "binary",
  "url": "https://raw.githubusercontent.com/<owner>/<repo>/main/rules/streaming.srs"
}
```

**不要**给这条流媒体规则先执行 `route action: resolve`：那会由客户端的指定 DNS 服务器先解析目的地址，无法保证选中节点自己解析。HTTP/SOCKS 入口把域名交给代理节点；TUN 模式下单独的 DNS 请求会被本地 DNS 劫持。可在现有 `dns.servers`、`dns.rules` 和 `cache_file` 中分别合并以下字段，让流媒体 DNS 返回 FakeIP，使后续连接仍带域名进入选中的节点：

```json
{
  "dns": {
    "servers": [
      {"type": "fakeip", "tag": "streaming-fakeip", "inet4_range": "198.18.0.0/15"}
    ],
    "rules": [
      {"inbound": ["tun"], "rule_set": ["streaming-rule"], "action": "route", "server": "streaming-fakeip"}
    ]
  },
  "cache_file": {"enabled": true, "store_fakeip": true}
}
```

其他域名可继续使用原有 DNS 配置。应用自行使用外部 DoH 或直接访问 IP 时，域名规则无法保证命中；选中的代理也须支持转发域名。应用配置后应实测解析和路由结果。

当前规则源文件格式为 sing-box source version 2，适用于本仓库所用的域名字段。完整上游信息及许可证见 [NOTICE.md](NOTICE.md)。
