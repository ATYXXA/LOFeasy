const state = { page: 1, pageSize: 20, search: "", subscriptionStatus: "", sortBy: "premiumRate", sortOrder: "desc", totalPages: 1 };
const staticMode = !["localhost", "127.0.0.1"].includes(location.hostname);
let staticSnapshot = null;
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const number = (value, digits = 4) => value == null ? "—" : Number(value).toFixed(digits);
const dateTime = (value) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle:"short", timeStyle:"medium", hour12:false }).format(new Date(value)) : "—";

function compareNullable(a, b, direction) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
  return String(a).localeCompare(String(b), "zh-CN", { numeric:true }) * direction;
}

async function fetchResult(params) {
  if (!staticMode) {
    const response = await fetch(`/api/v1/premiums?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  if (!staticSnapshot) {
    const response = await fetch("./data/premiums.json", { cache:"no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    staticSnapshot = await response.json();
  }
  const needle = state.search.trim().toLocaleLowerCase("zh-CN");
  const direction = state.sortOrder === "asc" ? 1 : -1;
  const filtered = staticSnapshot.data.filter(item => {
    const matchesSearch = !needle || item.code.toLocaleLowerCase().includes(needle) || item.name.toLocaleLowerCase().includes(needle);
    const matchesStatus = !state.subscriptionStatus || (state.subscriptionStatus === "purchasable"
      ? item.subscriptionStatus === "open" || item.subscriptionStatus === "limited"
      : item.subscriptionStatus === state.subscriptionStatus);
    return matchesSearch && matchesStatus;
  });
  filtered.sort((a, b) => compareNullable(a[state.sortBy], b[state.sortBy], direction) || a.code.localeCompare(b.code));
  const start = (state.page - 1) * state.pageSize;
  return {
    data: filtered.slice(start, start + state.pageSize),
    pagination: { page:state.page, pageSize:state.pageSize, total:filtered.length, totalPages:Math.ceil(filtered.length / state.pageSize) },
    meta: staticSnapshot.meta
  };
}

function renderRow(item) {
  const rate = item.premiumRate;
  const rateClass = rate == null ? "" : rate >= 0 ? "positive" : "negative";
  const reason = item.staleReasons?.join("、") || "数据时效正常";
  const subscriptionLabels = { open: "开放申购", suspended: "暂停申购", limited: "限购", closed: "封闭", unknown: "未知" };
  const subscriptionLabel = item.subscriptionStatus === "limited" && item.subscriptionLimit != null
    ? `限购 ${new Intl.NumberFormat("zh-CN", { style:"currency", currency:"CNY", maximumFractionDigits:0 }).format(item.subscriptionLimit)}`
    : item.subscriptionStatus === "limited" ? "限购（金额未披露）" : (subscriptionLabels[item.subscriptionStatus] ?? "未知");
  const priceCheck = item.crossValidation?.price;
  const navCheck = item.crossValidation?.nav;
  const checkLabel = (label, check) => {
    if (!check || check.comparableSourceCount < 2) return `${label}：单源`;
    return check.consistent ? `${label}：${check.comparableSourceCount}源一致` : `${label}：偏差 ${number(check.spreadPercent, 3)}%`;
  };
  const observationTitle = [
    ...(priceCheck?.observations ?? []).map(o => `价格 ${o.source}: ${o.value} @ ${o.asOf ?? "时间未知"}${o.selected ? "（采用）" : ""}`),
    ...(navCheck?.observations ?? []).map(o => `净值 ${o.source}: ${o.value} @ ${o.asOf ?? "日期未知"}${o.selected ? "（采用）" : ""}`)
  ].join("\n");
  const history = item.historicalPremiums ?? [];
  const historyHtml = history.length ? `<div class="history-list">${history.map(point => {
    const rateText = point.premiumRate == null ? "待净值" : `${point.premiumRate > 0 ? "+" : ""}${number(point.premiumRate, 2)}%`;
    const rateClass = point.premiumRate == null ? "pending" : point.premiumRate >= 0 ? "positive" : "negative";
    return `<span title="收盘 ${point.closePrice ?? "—"} · 净值 ${point.referenceNav ?? "待更新"}"><b>${escapeHtml(point.date.slice(5))}</b><em class="${rateClass}">${escapeHtml(rateText)}</em></span>`;
  }).join("")}</div>` : "—";
  const rules = item.tradingRules;
  const feeRows = (tiers) => tiers?.length ? tiers.map(tier => `<li><span>${escapeHtml(tier.condition)}</span><b>${escapeHtml(tier.rate)}</b></li>`).join("") : "<li>暂无数据</li>";
  const rulesHtml = rules ? `<div class="rule-summary"><strong class="sellable">场内申购 ${escapeHtml(rules.onExchangeSellableText ? `预计 ${rules.onExchangeSellableText} 可卖` : "可卖日未知")}</strong><span>依据：确认 ${escapeHtml(rules.purchaseConfirmText ?? "未知")} 后下一交易日</span><details><summary>查看申赎费率</summary><div class="fee-pop"><strong>申购费率（基金原费率）</strong><ul>${feeRows(rules.subscriptionFees)}</ul><strong>赎回费率</strong><ul>${feeRows(rules.redemptionFees)}</ul><small>可卖日及场内实际费率以基金公告和券商到账为准 · ${escapeHtml(rules.source)}</small></div></details></div>` : "—";
  return `<tr>
    <td class="fund"><strong>${escapeHtml(item.name)}</strong><span>${item.exchange} · ${escapeHtml(item.code)}</span></td>
    <td>${number(item.price)}</td><td>${number(item.referenceNav)}</td>
    <td class="rate ${rateClass}">${rate == null ? "—" : `${rate > 0 ? "+" : ""}${number(rate,2)}%`}</td>
    <td>${historyHtml}</td>
    <td><span class="subscription ${escapeHtml(item.subscriptionStatus)}" title="${escapeHtml(item.subscriptionStatusText ?? item.subscriptionSource)}">${escapeHtml(subscriptionLabel)}</span></td>
    <td>${rulesHtml}</td>
    <td class="time"><span>价格 ${dateTime(item.priceTime)}</span><span>净值 ${escapeHtml(item.navDate ?? "—")}</span></td>
    <td class="source" title="${escapeHtml(observationTitle)}"><span>${escapeHtml(item.priceSource)}（最新）</span><span>${escapeHtml(item.navSource)}</span><em class="validation ${priceCheck?.consistent === false ? "diverged" : ""}">${escapeHtml(checkLabel("行情", priceCheck))} · ${escapeHtml(checkLabel("净值", navCheck))}</em></td>
    <td><span class="badge ${item.isStale ? "stale" : ""}" title="${escapeHtml(reason)}">${item.isStale ? "已过期" : "正常"}</span></td>
  </tr>`;
}

async function load() {
  $("status").textContent = "加载中";
  const params = new URLSearchParams(Object.fromEntries(Object.entries(state).filter(([key]) => key !== "totalPages")));
  try {
    const result = await fetchResult(params);
    state.totalPages = Math.max(1, result.pagination.totalPages);
    $("rows").innerHTML = result.data.length ? result.data.map(renderRow).join("") : '<tr><td colspan="10" class="empty">没有找到匹配的基金</td></tr>';
    $("total").textContent = result.pagination.total.toLocaleString("zh-CN");
    $("updated").textContent = dateTime(result.meta.lastRefreshAt);
    $("status").textContent = "服务正常";
    $("pageInfo").textContent = `第 ${state.page} / ${state.totalPages} 页`;
    $("previous").disabled = state.page <= 1;
    $("next").disabled = state.page >= state.totalPages;
  } catch (error) {
    $("status").textContent = "连接失败";
    $("rows").innerHTML = `<tr><td colspan="10" class="empty">读取失败：${escapeHtml(error.message)}</td></tr>`;
  }
}

let searchTimer;
$("search").addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = event.target.value; state.page = 1; load(); }, 250); });
$("subscriptionStatus").addEventListener("change", (event) => { state.subscriptionStatus = event.target.value; state.page = 1; load(); });
$("sortBy").addEventListener("change", (event) => { state.sortBy = event.target.value; state.page = 1; load(); });
$("sortOrder").addEventListener("change", (event) => { state.sortOrder = event.target.value; state.page = 1; load(); });
$("previous").addEventListener("click", () => { if (state.page > 1) { state.page--; load(); } });
$("next").addEventListener("click", () => { if (state.page < state.totalPages) { state.page++; load(); } });
$("refresh").addEventListener("click", () => { if (staticMode) staticSnapshot = null; load(); });
load();
