# LOFeasy 运行文档

## 1. 环境

需要 Node.js 22+、npm 10+，并能访问东方财富接口。

```powershell
node --version
npm --version
```

## 2. 安装和启动

```powershell
cd "F:\For work\LOFeasy"
npm install
npm run build
npm start
```

默认地址是 `http://localhost:3000`。服务启动时立即刷新数据，之后默认每 1 分钟刷新行情（日净值缓存 30 分钟）。按 `Ctrl+C` 停止。

## 3. 验证

```powershell
Invoke-RestMethod "http://localhost:3000/health"
Invoke-RestMethod "http://localhost:3000/api/v1/premiums?page=1&pageSize=20&sortBy=premiumRate&sortOrder=desc"
Invoke-RestMethod "http://localhost:3000/api/v1/premiums?search=161725"
```

## 4. 查询参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `page` | `1` | 页码，从 1 开始 |
| `pageSize` | `20` | 每页条数，最大 100 |
| `search` | 空 | 搜索代码或名称 |
| `sortBy` | `premiumRate` | 排序字段 |
| `sortOrder` | `desc` | `asc` 或 `desc` |

排序字段支持 `code`、`name`、`price`、`referenceNav`、`premiumRate`、`priceTime`、`navDate`。

缺失的价格、净值和溢价率返回 `null`，不会显示为 `0`。缺失值在升序和降序排序中都位于末尾。

## 5. 配置

修改端口：

```powershell
$env:PORT="8080"
npm start
```

修改刷新周期（毫秒，最小 1000）：

```powershell
$env:REFRESH_INTERVAL_MS="60000"
npm start
```

## 6. 测试

```powershell
npm test
npm run typecheck
```

## 7. 数据字段

- `priceTime`、`navDate`：价格时间和净值日期
- `priceSource`、`navSource`：数据来源
- `subscriptionStatus`：`open`、`suspended`、`limited`、`closed` 或 `unknown`
- `subscriptionStatusText`、`subscriptionLimit`、`subscriptionStatusTime`、`subscriptionSource`：申购原始状态、限额、更新时间和来源
- `premiumRate`：溢价率，不能计算时为 `null`
- `isStale`、`staleReasons`：是否过期及具体原因
- `crossValidation`：东方财富、新浪财经、腾讯证券的观测值、最新值选择结果、来源偏差和一致性告警
- `historicalPremiums`：最近 5 个交易日收盘价、同日单位净值及溢价率
- `tradingRules`：场内申购后最早可卖日、申购确认日和阶梯申购费/赎回费；实际场内费用以券商为准
- `updatedAt`：计算时间

默认价格超过 15 分钟或净值日期超过 3 天即标记为过期。非交易时段、周末和节假日出现过期标记属于预期行为。

## 8. 常见问题

### 排行榜为空

首次启动需等待刷新完成。若日志显示上游请求失败，请检查网络、代理、防火墙，以及 `push2.eastmoney.com` 和 `fundgz.1234567.com.cn` 是否可访问。首次刷新失败时返回空数组；已有成功快照后，上游临时失败不会清空数据。

### 端口被占用

```powershell
$env:PORT="3001"
npm start
```

### 修改代码后没有生效

项目运行编译后的 `dist` 文件，修改源码后需重新执行：

```powershell
npm run build
npm start
```
