import assert from "node:assert/strict";
import test from "node:test";
import { LOF_BOARD_CODES, parseSubscriptionLimit, parseSubscriptionRows, parseSubscriptionStatus, parseTiantianPurchaseLimitHtml, parseTradingRules } from "../src/sources/eastmoney.js";

test("fund universe includes the dedicated QDII LOF board", () => {
  assert.ok(LOF_BOARD_CODES.includes("MK0407"));
  assert.deepEqual(LOF_BOARD_CODES, ["MK0404", "MK0405", "MK0406", "MK0407", "MK0408"]);
});

test("normalizes subscription statuses", () => {
  assert.equal(parseSubscriptionStatus("开放申购"), "open");
  assert.equal(parseSubscriptionStatus("暂停申购"), "suspended");
  assert.equal(parseSubscriptionStatus("限制大额申购"), "limited");
  assert.equal(parseSubscriptionStatus("封闭期"), "closed");
  assert.equal(parseSubscriptionStatus(null), "unknown");
});

test("extracts disclosed purchase limits without inventing missing amounts", () => {
  assert.equal(parseSubscriptionLimit("限购1,000元"), 1000);
  assert.equal(parseSubscriptionLimit("单日限制申购2万元"), 20_000);
  assert.equal(parseSubscriptionLimit("限大额"), null);
  assert.equal(parseSubscriptionLimit("开放申购"), null);
});

test("parses Eastmoney batch response variants", () => {
  const response = 'var db={chars:[],datas:[["161725","白酒LOF","BJLOF","1","1","1","1","0","0","限购1000元","开放赎回"]],count:["1"],record:"1",pages:"1"}';
  const item = parseSubscriptionRows(response, "2026-06-22T00:00:00Z").get("161725");
  assert.equal(item?.status, "limited");
  assert.equal(item?.limit, 1000);
});

test("combines split subscription status fields before extracting the amount", () => {
  const response = 'var db={datas:[["161725","基金","JJ","1","1","1","1","0","0","开放申购 限制大额","单日限购1,000元"]],count:["1"],record:"1"}';
  const item = parseSubscriptionRows(response, "2026-06-22T00:00:00Z").get("161725");
  assert.equal(item?.status, "limited");
  assert.equal(item?.limit, 1000);
});

test("extracts the purchase cap from a Tiantian Fund transaction-status block", () => {
  const html = '<div><span>交易状态：</span><span>限大额 (<span>单日累计购买上限50.00万元</span>)</span><span>开放赎回</span></div>';
  assert.equal(parseTiantianPurchaseLimitHtml(html), 500_000);
  assert.equal(parseTiantianPurchaseLimitHtml('<div>交易状态：开放申购</div>'), null);
});

test("parses T+ confirmation and tiered subscription/redemption fees", () => {
  const html = `
    <table><tr><td>买入确认日</td><td>T+1</td><td>卖出确认日</td><td>T+2</td></tr></table>
    <h4><label class="left">申购费率</label></h4><table><tbody>
      <tr><td>小于50万元</td><td><strike>1.00%</strike>&nbsp;|&nbsp;0.10%</td></tr>
      <tr><td>大于等于100万元</td><td>每笔1000元</td></tr>
    </tbody></table>
    <h4><label class="left">赎回费率</label></h4><table><tbody>
      <tr><td>小于7天</td><td>1.50%</td></tr><tr><td>大于等于730天</td><td>0.00%</td></tr>
    </tbody></table>`;
  const rules = parseTradingRules(html, "2026-06-22T00:00:00Z");
  assert.equal(rules.purchaseConfirmDays, 1);
  assert.equal(rules.redemptionConfirmDays, 2);
  assert.equal(rules.onExchangeSellableDays, 2);
  assert.equal(rules.onExchangeSellableText, "T+2");
  assert.equal(rules.onExchangeSellableBasis, "CONFIRMATION_PLUS_ONE_TRADING_DAY");
  assert.deepEqual(rules.subscriptionFees[0], { condition: "小于50万元", rate: "1.00%", discountedRate: "0.10%" });
  assert.deepEqual(rules.subscriptionFees[1], { condition: "大于等于100万元", rate: "每笔1000元", discountedRate: null });
  assert.equal(rules.redemptionFees[0]?.rate, "1.50%");
});
