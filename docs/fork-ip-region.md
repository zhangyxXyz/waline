# IP 属地配置

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
