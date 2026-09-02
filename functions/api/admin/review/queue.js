import { json, requireAdmin } from "../../../_lib/admin.js";

export async function onRequestGet({ request, env }) {
  try {
    const identity = await requireAdmin(request, env);
    if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
    const where = "WHERE i.active = 1 AND i.kind = 'required' AND COALESCE(d.state, '') NOT IN ('submitted','effective','published')";
    const query = "SELECT i.*, d.action, d.new_cp, d.note, d.state, d.user_email, d.updated_at AS decision_updated_at " +
      "FROM review_items i LEFT JOIN review_decisions d ON d.item_id = i.id " + where +
      " ORDER BY i.updated_at DESC";
    const result = await env.DB.prepare(query).all();
    const items = (result.results || []).map((item) => ({ ...item, active: Boolean(item.active) }));
    const resultCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM review_decisions WHERE state IN ('submitted','effective','published')").first();
    return json({ items, counts: { pending: items.length, results: Number(resultCount?.count || 0) }, email: identity.email });
  } catch (error) {
    return error instanceof Response ? error : json({ error: error.message || "读取待处理列表失败。" }, error.status || 500);
  }
}
