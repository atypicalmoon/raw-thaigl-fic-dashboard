import { json, requireAdmin } from "../../../_lib/admin.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
    const result = await env.DB.prepare(
      "SELECT h.*,i.title,i.link FROM review_history h LEFT JOIN review_items i ON i.id=h.item_id ORDER BY h.created_at DESC LIMIT 100",
    ).all();
    return json({ history: result.results || [] });
  } catch (error) {
    return error instanceof Response ? error : json({ error: error.message || "读取操作历史失败。" }, error.status || 500);
  }
}
