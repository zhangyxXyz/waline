# IP 属地配置

管理员现在可以在顶部“IP 地址管理”页签中选择显示精度、附带国家并保存，同时执行一键属地识别。保存立即影响新的请求，原始 IP 仍仅管理员可见。

网页设置保存于 `/app/runtime/region-settings.json`，部署时必须把 `/app/runtime` 挂载到持久化目录，并允许容器 node 用户写入。可用 `REGION_SETTINGS_FILE` 修改路径。保存后的网页设置优先于下方环境变量；没有保存文件时沿用环境变量默认值。

内置 IPv4 数据已更新，来源、校验和与转换说明位于 `packages/server/data/README.md`。IPv6 沿用原有库。本次报告的 `43.132.141.24` 已验证为中国香港特别行政区。

评论客户端继续读取 `addr` 字符串。完整 `ip` 只返回管理员，客户端请求参数不能提高属地精度。

在 1Panel 的 Waline 环境文件中配置并重新创建容器：

```dotenv
REGION_LEVEL=province
REGION_SHOW_COUNTRY=true
```

- `REGION_LEVEL`：`off`、`country`、`province`（默认）、`city`、`isp`。
- `REGION_SHOW_COUNTRY`：`true` 在省、市、运营商前增加国家；默认 `false`。
- `DISABLE_REGION=true` 仍关闭普通客户端的属地返回。
- 管理员始终可以查看国家、省、市、运营商和原始 IP，便于审核。
- 字段缺失时不会回退到更精细的字段。未知值和重复直辖市名称会被移除。

后台评论管理的“一键识别 IP 属地”按每批 100 条扫描全部评论，刷新当前列表，报告可识别、缺少 IP、未匹配的数量。接口 `GET /api/comment?type=region-audit&page=1` 仅限管理员，返回计数和下一页，不返回 IP 或评论内容。

属地在读取评论时由本地 IP 库动态解析，没有属地数据库列，所以无需写入历史评论。已有 IP 的记录自动使用当前库；缺少 IP 的记录无法准确恢复。未匹配的 IP 可通过更新本地数据文件改善，不能保证全部识别。

自定义 IP 库使用 `IP2REGION_DB_V4`（旧名 `IP2REGION_DB`）和 `IP2REGION_DB_V6`，需挂载兼容 ip2region npm 包的文件并重建容器。解析不调用第三方查询 API。

## 数据库更新

“IP 地址管理”的“IP 数据库”卡片提供数据来源下拉列表，目前仅支持 ip2region。
其下可选择内置快照或官方最新 IPv4 数据。默认使用内置快照，不联网更新。
官方模式支持每天、每周自动检查，或关闭自动检查并使用“保存并立即更新”。
保存设置不会触发手动下载；常驻服务会在下一次定时检查时执行到期的自动更新。

Docker 的 vanilla.js 启动后台定时器，每分钟检查一次是否到期；周期从最近一次尝试计算。
失败不会高频重试，可手动立即重试。无服务器部署不保证后台任务持续运行，不适合此更新模式。
上游免费数据不定期更新，不保证每次检查都有新版本；海外地名仍可能是英文。

程序从固定的官方 GitHub 原始文件地址下载 IPv4 数据，使用 ETag 条件请求跳过未变化的数据，
以源文件 SHA-256 标识版本，并验证完整覆盖、转换格式和试读。无需 GitHub API 或账号。
新数据库与版本信息存放于 `/app/runtime/ip-region`，可用 `REGION_DATABASE_DIR` 改变目录。
需持久化 `/app/runtime`，无需为数据更新重新构建镜像。当前版本和上一成功版本会保留，失败不切换。
更新成功后，下次查询自动重新加载。切回内置快照同样立即生效。
环境变量指定 IPv4 数据库时，页面显示该覆盖状态并禁用更新设置。
IPv6 保持既有行为，不在本次自动更新范围内。

仅管理员可访问 `GET/PUT /api/comment?type=region-database` 和
`POST /api/comment?type=region-database-update`。POST 启动后台任务并立即返回，页面轮询进度。
