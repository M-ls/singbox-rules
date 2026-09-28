# 上游来源

`rules/streaming.json` 和 `rules/streaming.srs` 聚合以下仓库中 `sources.json` 指定的服务分类：

- [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)，GPL-3.0。
- [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata)，GPL-3.0。

每次生成所用的具体上游提交、文件路径及 SHA-256 位于 `sources.lock.json`。本仓库对生成结果去重、排序，并叠加 `overrides/streaming-seed.json` 中的本地条目。上游项目未赞助或审核本仓库。

规则集按 [GPL-3.0](LICENSE) 发布；上游项目各自的版权及署名仍归其原作者所有。
