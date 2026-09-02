import { json, requireAdmin } from "../../../_lib/admin.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
    const result = await env.DB.prepare(
      "SELECT d.item_id,d.action,d.new_cp,d.note,d.state,d.user_email,d.updated_at,d.confirmed_at,d.published_at," +
      "i.title,i.link,i.current_cp,i.candidate_cps," +
      "COALESCE(d.published_at,d.confirmed_at,d.updated_at) AS decision_at " +
      "FROM review_decisions d LEFT JOIN review_items i ON i.id=d.item_id " +
      "WHERE d.state IN ('submitted','effective','published') ORDER BY decision_at DESC LIMIT 200",
    ).all();
    return json({ history: result.results || [] });
  } catch (error) {
    return error instanceof Response ? error : json({ error: error.message || "读取操作历史失败。" }, error.status || 500);
  }
}
