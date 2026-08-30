import { json, requireAdmin } from "../../../_lib/admin.js";

export async function onRequestGet({ request, env }) {
  try {
    const identity = await requireAdmin(request, env);
    if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
    const url = new URL(request.url);
    const kind = ["required", "candidate", "risk"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "";
    const where = kind ? "WHERE i.active = 1 AND (d.state IS NULL OR d.state <> 'published') AND i.kind = ?" : "WHERE i.active = 1 AND (d.state IS NULL OR d.state <> 'published')";
    const query = "SELECT i.*, d.action, d.new_cp, d.note, d.state, d.user_email, d.updated_at AS decision_updated_at " +
      "FROM review_items i LEFT JOIN review_decisions d ON d.item_id = i.id " + where +
      " ORDER BY CASE i.kind WHEN 'required' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, i.updated_at DESC";
    const result = kind ? await env.DB.prepare(query).bind(kind).all() : await env.DB.prepare(query).all();
    const items = (result.results || []).map((item) => ({ ...item, active: Boolean(item.active) }));
    const counts = await env.DB.prepare("SELECT i.kind, COUNT(*) AS count FROM review_items i LEFT JOIN review_decisions d ON d.item_id = i.id WHERE i.active = 1 AND (d.state IS NULL OR d.state <> 'published') GROUP BY i.kind").all();
    const countMap = Object.fromEntries((counts.results || []).map((row) => [row.kind, Number(row.count)]));
    return json({ items, counts: { required: countMap.required || 0, candidate: countMap.candidate || 0, risk: countMap.risk || 0 }, email: identity.email });
  } catch (error) {
    return error instanceof Response ? error : json({ error: error.message || "读取待处理列表失败。" }, error.status || 500);
  }
}
