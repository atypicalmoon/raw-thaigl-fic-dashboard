const state = {
  currentKind: "required",
  items: [],
  counts: { required: 0, candidate: 0, risk: 0 },
  search: "",
  selected: new Set(),
  history: [],
  saving: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const escText = (value) => String(value ?? "");
const kindLabels = { required: "待确认", candidate: "抽查候选", risk: "风险提示" };
const actionLabels = { keep: "保留", change: "修改 CP", exclude: "排除", defer: "稍后处理" };

function setMessage(message, tone = "") {
  const target = $("#globalMessage");
  target.textContent = message || "";
  target.dataset.tone = tone;
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(body.error || "请求未完成。");
    error.status = response.status;
    throw error;
  }
  return body;
}

function showApp(email) {
  $("#loginCard").hidden = true;
  $("#app").hidden = false;
  $("#logoutButton").hidden = false;
  setMessage(email ? "已登录：" + email : "");
}

function showLogin(message = "") {
  $("#loginCard").hidden = false;
  $("#app").hidden = true;
  $("#logoutButton").hidden = true;
  $("#loginMessage").textContent = message;
}

function setCount(kind, value) {
  const target = $("#" + kind + "Count");
  if (target) target.textContent = Number(value || 0).toLocaleString();
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function evidence(label, value) {
  const item = make("div", "evidence");
  item.append(make("span", "", label), make("strong", "", value || "—"));
  return item;
}

function renderCard(item) {
  const card = make("article", "review-card");
  card.dataset.itemId = item.id;
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = state.selected.has(item.id);
  check.setAttribute("aria-label", "选择 " + (item.title || item.link));
  check.addEventListener("change", () => {
    if (check.checked) state.selected.add(item.id); else state.selected.delete(item.id);
    updateSelectionBar();
  });
  card.append(check);

  const main = make("div", "review-main");
  const meta = make("div", "review-meta");
  meta.append(make("span", "kind-badge " + item.kind, kindLabels[item.kind] || "记录"));
  if (item.state === "confirmed") meta.append(make("span", "state-badge", "已确认"));
  if (item.state === "published") meta.append(make("span", "state-badge published", "已提交发布"));
  meta.append(make("span", "", item.trigger_reason || item.source_status || "来源规则待说明"));
  main.append(meta);

  const title = make("h2", "review-title");
  const link = document.createElement("a");
  link.href = item.link || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = item.title || "无标题";
  title.append(link);
  main.append(title);
  main.append(make("p", "review-detail", item.kind === "risk" ? "这是提示项，不影响公开数据；有空再看即可。" : "原文链接已保留；只有需要时再打开。"));

  const evidenceGrid = make("div", "review-evidence");
  evidenceGrid.append(
    evidence("当前 CP", item.current_cp),
    evidence("候选 CP", item.candidate_cps),
    evidence("作者", item.author),
    evidence("标签 / 触发原因", item.tag || item.trigger_reason),
  );
  main.append(evidenceGrid);

  const decisionRow = make("div", "decision-row");
  const buttons = make("div", "decision-buttons");
  const currentAction = item.action || "";
  const actions = item.kind === "risk" ? ["defer"] : ["keep", "change", "exclude", "defer"];
  actions.forEach((action) => {
    const button = make("button", "decision-button" + (currentAction === action ? " active" : ""), actionLabels[action]);
    button.type = "button";
    button.addEventListener("click", () => {
      item.action = action;
      if (action !== "change") item.new_cp = "";
      renderCurrentCard(item);
      saveDraft(item);
    });
    buttons.append(button);
  });
  decisionRow.append(buttons);

  const select = document.createElement("select");
  select.className = "decision-select";
  select.setAttribute("aria-label", "选择新的 CP");
  select.disabled = currentAction !== "change";
  const placeholder = make("option", "", currentAction === "change" ? "选择 CP" : "修改 CP 时选择");
  placeholder.value = "";
  select.append(placeholder);
  String(item.candidate_cps || "").split("|").map((value) => value.trim()).filter(Boolean).forEach((cp) => {
    const option = make("option", "", cp);
    option.value = cp;
    option.selected = item.new_cp === cp;
    select.append(option);
  });
  select.addEventListener("change", () => { item.new_cp = select.value; saveDraft(item); });
  decisionRow.append(select);

  const note = document.createElement("textarea");
  note.className = "review-note";
  note.rows = 1;
  note.placeholder = "备注（可选）";
  note.value = item.note || "";
  note.addEventListener("input", () => { item.note = note.value; scheduleDraft(item); });
  decisionRow.append(note);
  main.append(decisionRow);
  card.append(main);
  return card;
}

function renderCurrentCard(item) {
  const old = document.querySelector('[data-item-id="' + CSS.escape(item.id) + '"]');
  if (!old) return;
  const replacement = renderCard(item);
  old.replaceWith(replacement);
  updateSelectionBar();
}

function filteredItems() {
  const needle = state.search.trim().toLowerCase();
  return state.items.filter((item) => item.kind === state.currentKind && (!needle || [item.title, item.author, item.current_cp, item.candidate_cps, item.tag, item.trigger_reason].some((value) => String(value || "").toLowerCase().includes(needle))));
}

function renderItems() {
  const list = $("#reviewList");
  list.replaceChildren();
  const items = filteredItems();
  if (!items.length) {
    list.append(make("div", "empty", state.search ? "没有符合搜索条件的记录。" : "这里暂时没有需要处理的记录。"));
    updateSelectionBar();
    return;
  }
  items.forEach((item) => list.append(renderCard(item)));
  updateSelectionBar();
}

function updateSelectionBar() {
  const selected = state.items.filter((item) => state.selected.has(item.id));
  const actionable = selected.filter((item) => item.action && item.action !== "defer");
  const confirmed = selected.filter((item) => item.state === "confirmed");
  const saving = selected.some((item) => state.saving.has(item.id));
  $("#selectionSummary").textContent = selected.length ? "已选 " + selected.length + " 条 · 可确认 " + actionable.length + " 条 · 已确认 " + confirmed.length + " 条" : "尚未选择";
  $("#confirmButton").disabled = !actionable.length || saving;
  $("#publishButton").disabled = !confirmed.length || saving;
}

function setActiveKind(kind) {
  state.currentKind = kind;
  document.querySelectorAll("[data-kind]").forEach((node) => node.classList.toggle("active", node.dataset.kind === kind));
  const isHistory = kind === "history";
  $("#selectionBar").hidden = isHistory;
  $("#reviewList").hidden = isHistory;
  $("#historyList").hidden = !isHistory;
  if (isHistory) loadHistory(); else renderItems();
}

async function loadQueue() {
  const data = await api("/api/admin/review/queue");
  state.items = data.items || [];
  state.counts = data.counts || state.counts;
  ["required", "candidate", "risk"].forEach((kind) => setCount(kind, state.counts[kind]));
  renderItems();
}

async function loadHistory() {
  const target = $("#historyList");
  target.replaceChildren(make("div", "empty", "正在读取操作历史…"));
  try {
    const data = await api("/api/admin/review/history");
    state.history = data.history || [];
    $("#historyCount").textContent = state.history.length.toLocaleString();
    target.replaceChildren();
    if (!state.history.length) { target.append(make("div", "empty", "还没有操作记录。")); return; }
    state.history.forEach((row) => {
      const item = make("div", "history-row");
      item.append(make("b", "", actionLabels[row.action] || row.event || "操作"), make("span", "", " · " + (row.title || row.item_id)));
      item.append(make("small", "", row.created_at + " · " + (row.user_email || "管理台")));
      if (row.note) item.append(make("small", "", row.note));
      target.append(item);
    });
  } catch (error) {
    target.replaceChildren(make("div", "empty", error.message));
  }
}

async function saveDraft(item) {
  if (!item.action) return;
  try {
    state.saving.set(item.id, true);
    await api("/api/admin/review/draft", { method: "POST", body: JSON.stringify({ item_id: item.id, action: item.action, new_cp: item.new_cp || "", note: item.note || "" }) });
    item.state = "draft";
    setMessage("已保存草稿");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    state.saving.delete(item.id);
    updateSelectionBar();
  }
}

function scheduleDraft(item) {
  clearTimeout(item._draftTimer);
  item._draftTimer = setTimeout(() => saveDraft(item), 500);
}

async function confirmSelected() {
  const selected = state.items.filter((item) => state.selected.has(item.id));
  selected.forEach((item) => { if (item._draftTimer) { clearTimeout(item._draftTimer); item._draftTimer = null; } });
  await Promise.all(selected.filter((item) => item.action).map((item) => saveDraft(item)));
  const ids = selected.filter((item) => item.action && item.action !== "defer").map((item) => item.id);
  if (!ids.length) return;
  try {
    const result = await api("/api/admin/review/confirm", { method: "POST", body: JSON.stringify({ item_ids: ids }) });
    state.items.forEach((item) => { if (ids.includes(item.id)) item.state = "confirmed"; });
    setMessage("已确认 " + result.confirmed + " 条，尚未发布。");
    renderItems();
  } catch (error) { setMessage(error.message, "error"); }
}

async function publishSelected() {
  const items = state.items.filter((item) => state.selected.has(item.id) && item.state === "confirmed");
  if (!items.length) return;
  const changes = items.filter((item) => item.action === "change").length;
  const exclusions = items.filter((item) => item.action === "exclude").length;
  const message = "将提交 " + items.length + " 条决定" + (changes ? "，修改 CP " + changes + " 条" : "") + (exclusions ? "，排除 " + exclusions + " 条" : "") + "。继续吗？";
  if (!window.confirm(message)) return;
  try {
    const result = await api("/api/admin/review/publish", { method: "POST", body: JSON.stringify({ item_ids: items.map((item) => item.id) }) });
    setMessage(result.workflow_started ? "已提交发布，云端正在重建看板。" : (result.warning || "已写入私有账本，但云端任务尚未启动。"), result.workflow_started ? "" : "error");
    state.selected.clear();
    await loadQueue();
  } catch (error) { setMessage(error.message, "error"); }
}

async function boot() {
  try {
    const session = await api("/api/admin/session", { headers: {} });
    showApp(session.email);
    await loadQueue();
  } catch (error) {
    showLogin(error.status === 503 ? error.message : "");
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#loginMessage");
  message.textContent = "正在登录…";
  try {
    const result = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("#loginPassword").value }) });
    showApp(result.email);
    await loadQueue();
  } catch (error) { message.textContent = error.message; }
});

$("#logoutButton").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST" }); } finally { window.location.reload(); }
});
$("#refreshButton").addEventListener("click", async () => { try { await loadQueue(); setMessage("列表已刷新"); } catch (error) { setMessage(error.message, "error"); } });
$("#searchInput").addEventListener("input", (event) => { state.search = event.target.value; renderItems(); });
$("#confirmButton").addEventListener("click", confirmSelected);
$("#publishButton").addEventListener("click", publishSelected);
document.querySelectorAll("[data-kind]").forEach((node) => node.addEventListener("click", () => setActiveKind(node.dataset.kind)));

boot();
