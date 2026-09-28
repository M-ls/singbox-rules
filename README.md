# singbox-rules

供 sing-box 使用的个人分流规则集。仓库只存规则源文件和编译产物，不包含节点、DNS 凭据或完整运行配置。

## 规则

| 文件 | 用途 |
| --- | --- |
| `rules/non-cn.json` | 可审阅的 sing-box source 规则集 |
| `rules/non-cn.srs` | 供 sing-box 远程加载的 binary 规则集 |

`non-cn` 首版从 `singbox-gui/singbox-home/tagss.overrides.json` 的第一条 `route_rules` 等价提取：80 个 `domain`、357 个 `domain_suffix`。名称沿用原出口“🌍 非中国流量”的用途；列表也包含流媒体、AI 等服务，不能把它理解为严格的地理分类。

## 更新规则

1. 编辑 `rules/non-cn.json`，保持 `version` 和 `rules` 结构符合 sing-box source 格式。
2. 用已安装的 sing-box 编译：

   ```powershell
   sing-box rule-set compile -o rules/non-cn.srs rules/non-cn.json
   ```

3. 核对域名差异与生成的 `.srs`，然后一起提交。不要把 `tagss.overrides.json` 整份上传到本仓库。

本次编译使用 `sing-box 1.15.0-alpha.4`。若其他客户端版本更旧，请先确认其支持规则集 source version 2。

## 在原配置中接入

发布到 GitHub 后，在 `tagss.overrides.json` 的 `rule_set` 中新增：

```json
{
  "type": "remote",
  "tag": "cfg-custom_non_cn-rule",
  "format": "binary",
  "url": "https://raw.githubusercontent.com/M-ls/singbox-rules/main/rules/non-cn.srs"
}
```

把原来第一条 `route_rules` 的 `domain`、`domain_suffix` 换为 `"rule_set": ["cfg-custom_non_cn-rule"]`，保留 `"action": "route"`、`"outbound": "🌍 非中国流量"` 和原来的规则顺序。首次启用前须确认 URL 可下载；原配置默认以直连 HTTP client 下载规则集，且已启用缓存。
