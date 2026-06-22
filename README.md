# LOFeasy

A股场内 LOF 基金溢价率排行榜 API。基金池分页覆盖普通 LOF、债券 LOF、商品 LOF、QDII LOF 和分级/行业 LOF 板块；行情同时接入东方财富、新浪财经和腾讯证券。同一基金按时间选择最新价格，并保留多源观测值用于偏差校验。净值和申购状态来自东方财富，未获得同日期第二净值源时会明确标记为单源。

安装、启动、配置及故障排查参见 [RUNNING.md](./RUNNING.md)。

```bash
npm install
npm test
npm start
```

## API

`GET /api/v1/premiums?page=1&pageSize=20&search=161&sortBy=premiumRate&sortOrder=desc`

- `pageSize` 最大 100。
- `sortBy`：`code`、`name`、`price`、`referenceNav`、`premiumRate`、`subscriptionStatus`、`subscriptionLimit`、`priceTime`、`navDate`。
- 缺失的价格、净值或溢价率用 JSON `null` 表示，任何排序方向都排在末尾。
- 每条数据带 `priceTime`、`navDate`、`priceSource`、`navSource`、`isStale` 和 `staleReasons`。
- 申购信息包含 `subscriptionStatus`、原始状态文本、限购金额、状态时间和来源；未披露的限额保持 `null`。
- `crossValidation` 返回各来源观测值、采用项、可比来源数、最大偏差和一致性；行情偏差不超过 0.3% 视为一致，净值偏差不超过 0.1% 视为一致。
- `historicalPremiums` 返回最近 5 个已收盘交易日的收盘价、同日净值与溢价率；当日净值尚未公布时保留 `null`，更新后自动补算。
- `tradingRules.onExchangeSellableText` 表示 T 日通过证券账户场内申购后最早可卖日。它按基金申购确认日后的下一交易日推导（如确认 T+1，则 T+2 可卖）；无法确认时返回 `null`。
- `tradingRules` 同时保留基金原始阶梯申购费率和赎回费率。场内页面不采用天天基金平台优惠费，实际费用以券商为准。
- 默认每 1 分钟刷新行情，可用 `REFRESH_INTERVAL_MS` 调整；日净值缓存 30 分钟，上游全部失败时保留上一次成功快照。

溢价率按 `(price / referenceNav - 1) * 100` 计算。参考净值缺失、为零或非有限数时返回 `null`。

## GitHub Pages 发布

仓库已包含 `.github/workflows/pages.yml`。它会在推送到 `main`、手动运行，以及每小时第 7、37 分钟生成最新静态数据并部署 Pages。

1. 在 GitHub 创建仓库并推送本项目到 `main` 分支。
2. 打开仓库 `Actions`，运行一次 `Refresh data and deploy Pages`。工作流会自动启用 Pages。
3. 新版 `Settings → Pages` 在首次部署前只显示 Jekyll/Static HTML 建议模板；无需选择这些模板，也可能看不到旧版的 Source 下拉框。
4. 首次工作流成功后，Pages 页面会显示部署详情；访问 `https://<用户名>.github.io/<仓库名>/`。

Pages 不运行 Node 服务。工作流会执行 `npm run export:static`，将前端和完整排行榜快照写入 `_site`；线上搜索、筛选、排序和分页由浏览器完成。定时任务使用 UTC，但这里每半小时都运行，不受时区影响。GitHub 的定时任务可能因平台繁忙而延迟，并不保证精确到分钟。
