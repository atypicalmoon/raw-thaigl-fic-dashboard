import { getAdminIdentity, json, nowIso, readJson, requireAdmin } from "../../../_lib/admin.js";

export async function onRequestPost({ request, env }) {
  try {
    const identity = await requireAdmin(request, env);
    if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
    const body = await readJson(request);
    const ids = Array.isArray(body.item_ids) ? [...new Set(body.item_ids.map((id) => String(id).trim()).filter(Boolean))].slice(0, 200) : [];
    if (!ids.length) return json({ error: "请先选择已经保存决定的记录。" }, 400);
    const now = nowIso();
    let confirmed = 0;
    for (const itemId of ids) {
      const decision = await env.DB.prepare("SELECT action,new_cp,note FROM review_decisions WHERE item_id = ? AND state = 'draft'").bind(itemId).first();
      if (!decision || decision.action === "defer") continue;
      await env.DB.prepare("UPDATE review_decisions SET state='confirmed',confirmed_at=?,updated_at=?,user_email=? WHERE item_id=?")
        .bind(now, now, identity.email, itemId).run();
      await env.DB.prepare("INSERT INTO review_history(item_id,event,action,new_cp,note,user_email,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(itemId, "confirmed", decision.action, decision.new_cp, decision.note, identity.email, now).run();
      confirmed += 1;
    }
    return json({ confirmed, updated_at: now });
  } catch (error) {
    return error instanceof Response ? error : json({ error: error.message || "确认失败。" }, error.status || 500);
  }
}
