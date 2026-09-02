import { cleanAction, json, nowIso, readJson, requireAdmin } from "../../../_lib/admin.js";

export async function onRequestPost({ request, env }) {
  try {
    const identity = await requireAdmin(request, env);
    if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
    const body = await readJson(request);
    const itemId = String(body.item_id || "").trim();
    const action = cleanAction(body.action);
    const note = String(body.note || "").trim().slice(0, 1000);
    const newCp = String(body.new_cp || "").trim();
    if (!itemId || !action) return json({ error: "缺少校对记录或操作。" }, 400);
    const item = await env.DB.prepare("SELECT * FROM review_items WHERE id = ? AND active = 1").bind(itemId).first();
    if (!item) return json({ error: "这条记录已更新，请刷新管理台。" }, 409);
    if (action === "change") {
      const candidates = String(item.candidate_cps || "").split("|").map((value) => value.trim()).filter(Boolean);
      if (!newCp || (!candidates.includes(newCp) && newCp !== String(item.current_cp || "").trim())) return json({ error: "新的 CP 不在候选范围内。" }, 400);
    }
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO review_decisions(item_id,action,new_cp,note,state,user_email,updated_at) VALUES(?,?,?,?,?,?,?) " +
      "ON CONFLICT(item_id) DO UPDATE SET action=excluded.action,new_cp=excluded.new_cp,note=excluded.note,state='draft',user_email=excluded.user_email,updated_at=excluded.updated_at,confirmed_at=NULL,published_at=NULL",
    ).bind(itemId, action, newCp, note, "draft", identity.email, now).run();
    return json({ saved: true, item_id: itemId, state: "draft", updated_at: now });
  } catch (error) {
    return error instanceof Response ? error : json({ error: error.message || "草稿保存失败。" }, error.status || 500);
  }
}
