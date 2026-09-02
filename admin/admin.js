const state = {
  currentKind: "pending",
  items: [],
  counts: { pending: 0, results: 0 },
  search: "",
  filters: { state: "", cp: "", date: "" },
  selected: new Set(),
  results: [],
  saving: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const actionLabels = { keep: "保留原 CP", change: "修改 CP", exclude: "排除作品" };

function setMessage(message, tone = "") {
  const target = $("#globalMessage");
  target.textContent = message || "";
  target.dataset.tone = tone;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
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

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setCount(kind, value) {
  const target = $("#" + kind + "Count");
  if (target) target.textContent = Number(value || 0).toLocaleString();
}

function evidence(label, value) {
  const item = make("div", "evidence");
  item.append(make("span", "", label), make("strong", "", value || "—"));
  return item;
}

function validDecision(item) {
  return ["keep", "change", "exclude"].includes(item.action) && (item.action !== "change" || Boolean(item.new_cp));
}

function decisionSummary(item) {
  const current = item.current_cp || "未标注";
  if (item.action === "change") return current + " → " + (item.new_cp || "尚未选择");
  if (item.action === "exclude") return "排除作品（原 CP：" + current + "）";
  if (item.action === "keep") return "保留原 CP：" + current;
  return "尚未决定";
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
  meta.append(make("span", "kind-badge required", "CP 冲突"));
  if (item.state === "draft" || item.state === "confirmed") {
    meta.append(make("span", "state-badge draft", "未提交修改"));
  }
  meta.append(make("span", "", item.trigger_reason || "多个 CP 命中，无法自动确定"));
  main.append(meta);

  const title = make("h2", "review-title");
  const link = document.createElement("a");
  link.href = item.link || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = item.title || "无标题";
  title.append(link);
  main.append(title);

  const evidenceGrid = make("div", "review-evidence");
  evidenceGrid.append(
    evidence("当前 CP", item.current_cp),
    evidence("候选 CP", item.candidate_cps),
    evidence("作者", item.author),
    evidence("标签", item.tag),
  );
  main.append(evidenceGrid);

  const decisionRow = make("div", "decision-row");
  const buttons = make("div", "decision-buttons");
  ["keep", "change", "exclude"].forEach((action) => {
    const button = make("button", "decision-button" + (item.action === action ? " active" : ""), actionLabels[action]);
    button.type = "button";
    button.addEventListener("click", () => {
      item.action = action;
      if (action !== "change") item.new_cp = "";
      renderCurrentCard(item);
      if (validDecision(item)) saveDraft(item);
    });
    buttons.append(button);
  });
  decisionRow.append(buttons);

  const select = document.createElement("select");
  select.className = "decision-select";
  select.setAttribute("aria-label", "选择最终 CP");
  select.disabled = item.action !== "change";
  const placeholder = make("option", "", item.action === "change" ? "选择最终 CP" : "修改 CP 时选择");
  placeholder.value = "";
  select.append(placeholder);
  String(item.candidate_cps || "").split("|").map((value) => value.trim()).filter(Boolean).forEach((cp) => {
    const option = make("option", "", cp);
    option.value = cp;
    option.selected = item.new_cp === cp;
    select.append(option);
  });
  select.addEventListener("change", () => {
    item.new_cp = select.value;
    if (validDecision(item)) saveDraft(item);
    updateSelectionBar();
  });
  decisionRow.append(select);

  const note = document.createElement("textarea");
  note.className = "review-note";
  note.rows = 1;
  note.placeholder = "备注（可选，会显示在处理结果中）";
  note.value = item.note || "";
  note.addEventListener("input", () => {
    item.note = note.value;
    if (validDecision(item)) scheduleDraft(item);
  });
  decisionRow.append(note);
  main.append(decisionRow);
  card.append(main);
  return card;
}

function renderCurrentCard(item) {
  const old = document.querySelector('[data-item-id="' + CSS.escape(item.id) + '"]');
  if (!old) return;
  old.replaceWith(renderCard(item));
  updateSelectionBar();
}

function filteredItems() {
  const needle = state.search.trim().toLowerCase();
  return state.items.filter((item) => {
    if (needle && ![item.title, item.author, item.current_cp, item.candidate_cps, item.tag, item.trigger_reason].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
    if (state.filters.state === "pending" && item.action) return false;
    if (state.filters.state === "draft" && !["draft", "confirmed"].includes(item.state)) return false;
    if (state.filters.cp) {
      const cps = String(item.current_cp || "").split("|").concat(String(item.candidate_cps || "").split("|"));
      if (!cps.map((value) => value.trim()).includes(state.filters.cp)) return false;
    }
    if (state.filters.date) {
      const publishDate = String(item.publish_date || "");
      if (state.filters.date === "未注明" ? /^\d{4}-\d{2}/.test(publishDate) : !publishDate.startsWith(state.filters.date)) return false;
    }
    return true;
  });
}

function setSelectOptions(select, values, firstLabel) {
  const current = select.value;
  const first = make("option", "", firstLabel);
  first.value = "";
  select.replaceChildren(first);
  values.forEach((value) => {
    const option = make("option", "", value);
    option.value = value;
    select.append(option);
  });
  select.value = values.includes(current) ? current : "";
}

function refreshFilterOptions() {
  const cps = [...new Set(state.items.flatMap((item) => String(item.current_cp || "").split("|").concat(String(item.candidate_cps || "").split("|")).map((value) => value.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
  const dates = [...new Set(state.items.map((item) => {
    const value = String(item.publish_date || "");
    return value ? (/^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "未注明") : "";
  }).filter(Boolean))].sort((a, b) => b.localeCompare(a, "zh-CN"));
  setSelectOptions($("#cpFilter"), cps, "全部 CP");
  setSelectOptions($("#dateFilter"), dates, "全部时间");
}

function renderItems() {
  const list = $("#reviewList");
  list.replaceChildren();
  const items = filteredItems();
  if (!items.length) {
    const hasFilters = state.search.trim() || Object.values(state.filters).some(Boolean);
    list.append(make("div", "empty", hasFilters ? "没有符合条件的记录。" : "没有需要人工决定的 CP 冲突。"));
  } else {
    items.forEach((item) => list.append(renderCard(item)));
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  const selected = state.items.filter((item) => state.selected.has(item.id));
  const ready = selected.filter(validDecision);
  const saving = selected.some((item) => state.saving.has(item.id));
  $("#selectionSummary").textContent = selected.length ? "已选 " + selected.length + " · 可提交 " + ready.length : "尚未选择";
  $("#submitButton").disabled = !ready.length || saving;
}

function renderResults() {
  const target = $("#resultList");
  const needle = state.search.trim().toLowerCase();
  const rows = state.results.filter((row) => !needle || [row.title, row.current_cp, row.new_cp, row.note, row.user_email].some((value) => String(value || "").toLowerCase().includes(needle)));
  target.replaceChildren();
  if (!rows.length) {
    target.append(make("div", "empty", needle ? "没有符合条件的处理结果。" : "还没有提交过处理决定。"));
    return;
  }
  rows.forEach((row) => {
    const item = make("article", "result-row");
    const top = make("div", "result-top");
    const title = make("a", "result-title", row.title || row.item_id);
    title.href = row.link || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    const effective = row.state === "effective" || row.state === "published";
    top.append(title, make("span", "state-badge " + (effective ? "effective" : "submitted"), effective ? "已生效" : "已提交"));
    item.append(top, make("strong", "result-decision", decisionSummary(row)));
    item.append(make("small", "result-meta", (row.user_email || "管理台") + " · " + (row.decision_at || row.updated_at || "")));
    if (row.note) item.append(make("p", "result-note", row.note));
    target.append(item);
  });
}

function setActiveKind(kind) {
  state.currentKind = kind;
  document.querySelectorAll("[data-kind]").forEach((node) => node.classList.toggle("active", node.dataset.kind === kind));
  const isResults = kind === "results";
  state.selected.clear();
  $("#selectionBar").hidden = isResults;
  $(".filter-strip").hidden = isResults;
  $("#reviewList").hidden = isResults;
  $("#resultList").hidden = !isResults;
  if (isResults) loadResults(); else renderItems();
}

async function loadQueue() {
  const data = await api("/api/admin/review/queue");
  state.items = data.items || [];
  state.counts = data.counts || state.counts;
  state.selected = new Set([...state.selected].filter((id) => state.items.some((item) => item.id === id)));
  refreshFilterOptions();
  setCount("pending", state.counts.pending);
  setCount("results", state.counts.results);
  renderItems();
}

async function loadResults() {
  const target = $("#resultList");
  target.replaceChildren(make("div", "empty", "正在读取处理结果…"));
  try {
    const data = await api("/api/admin/review/history");
    state.results = data.history || [];
    setCount("results", state.results.length);
    renderResults();
  } catch (error) {
    target.replaceChildren(make("div", "empty", error.message));
  }
}

async function saveDraft(item) {
  if (!validDecision(item)) return false;
  try {
    state.saving.set(item.id, true);
    await api("/api/admin/review/draft", {
      method: "POST",
      body: JSON.stringify({ item_id: item.id, action: item.action, new_cp: item.new_cp || "", note: item.note || "" }),
    });
    item.state = "draft";
    setMessage("未提交修改已保存");
    return true;
  } catch (error) {
    setMessage(error.message, "error");
    return false;
  } finally {
    state.saving.delete(item.id);
    updateSelectionBar();
  }
}

function scheduleDraft(item) {
  clearTimeout(item._draftTimer);
  item._draftTimer = setTimeout(() => saveDraft(item), 500);
}

async function submitSelected() {
  const selected = state.items.filter((item) => state.selected.has(item.id) && validDecision(item));
  if (!selected.length) return;
  selected.forEach((item) => {
    if (item._draftTimer) {
      clearTimeout(item._draftTimer);
      item._draftTimer = null;
    }
  });
  const saved = await Promise.all(selected.map((item) => saveDraft(item)));
  const ready = selected.filter((_, index) => saved[index]);
  if (!ready.length) return;
  const preview = ready.slice(0, 12).map((item) => "• " + (item.title || item.id) + "：" + decisionSummary(item));
  if (ready.length > preview.length) preview.push("• 另有 " + (ready.length - preview.length) + " 条");
  if (!window.confirm("将提交以下决定：\n\n" + preview.join("\n") + "\n\n提交后会启动云端更新。")) return;
  try {
    const result = await api("/api/admin/review/publish", {
      method: "POST",
      body: JSON.stringify({ item_ids: ready.map((item) => item.id) }),
    });
    setMessage("已提交 " + result.submitted + " 条；云端更新完成后会自动显示为已生效。");
    state.selected.clear();
    await loadQueue();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function refreshCurrent() {
  try {
    if (state.currentKind === "results") await loadResults(); else await loadQueue();
    setMessage("列表已刷新");
  } catch (error) {
    setMessage(error.message, "error");
  }
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
$("#refreshButton").addEventListener("click", refreshCurrent);
$("#searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  if (state.currentKind === "results") renderResults(); else renderItems();
});
$("#stateFilter").addEventListener("change", (event) => { state.filters.state = event.target.value; renderItems(); });
$("#cpFilter").addEventListener("change", (event) => { state.filters.cp = event.target.value; renderItems(); });
$("#dateFilter").addEventListener("change", (event) => { state.filters.date = event.target.value; renderItems(); });
$("#clearFilters").addEventListener("click", () => {
  state.search = "";
  state.filters = { state: "", cp: "", date: "" };
  $("#searchInput").value = "";
  $("#stateFilter").value = "";
  $("#cpFilter").value = "";
  $("#dateFilter").value = "";
  renderItems();
});
$("#submitButton").addEventListener("click", submitSelected);
document.querySelectorAll("[data-kind]").forEach((node) => node.addEventListener("click", () => setActiveKind(node.dataset.kind)));

boot();
