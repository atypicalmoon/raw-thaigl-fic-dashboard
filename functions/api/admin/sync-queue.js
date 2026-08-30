import { json, nowIso, readJson, requireSyncToken } from "../../_lib/admin.js";

export async function onRequestPost({ request, env }) {
  if (!requireSyncToken(request, env)) return json({ error: "管理台同步凭据无效。" }, 401);
  if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
  let body;
  try { body = await readJson(request); } catch (error) { return error; }
  const items = Array.isArray(body.items) ? body.items.slice(0, 5000) : [];
  const sourceRevision = String(body.source_revision || nowIso()).slice(0, 120);
  const now = nowIso();
  const seen = [];
  for (const raw of items) {
    const id = String(raw.id || raw.link || "").trim().slice(0, 300);
    const kind = ["required", "candidate", "risk"].includes(String(raw.kind)) ? String(raw.kind) : "candidate";
    const link = String(raw.link || "").trim().slice(0, 1000);
    if (!id || !link) continue;
    seen.push(id);
    await env.DB.prepare(
      "INSERT INTO review_items(id,kind,link,title,author,current_cp,candidate_cps,tag,trigger_reason,publish_date,source_status,source_revision,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,link=excluded.link,title=excluded.title,author=excluded.author,current_cp=excluded.current_cp,candidate_cps=excluded.candidate_cps,tag=excluded.tag,trigger_reason=excluded.trigger_reason,publish_date=excluded.publish_date,source_status=excluded.source_status,source_revision=excluded.source_revision,active=1,updated_at=excluded.updated_at",
    ).bind(
      id, kind, link, String(raw.title || "").slice(0, 1000), String(raw.author || "").slice(0, 300),
      String(raw.current_cp || "").slice(0, 200), String(raw.candidate_cps || "").slice(0, 1000),
      String(raw.tag || "").slice(0, 2000), String(raw.trigger_reason || "").slice(0, 300),
      String(raw.publish_date || "").slice(0, 40), String(raw.source_status || "").slice(0, 100),
      sourceRevision, now, now,
    ).run();
  }
  // 每次同步使用新的 revision；本轮没有被更新的旧记录自然失效，
  // 不使用超长的 NOT IN 列表，避免队列变大后触发 SQLite 参数上限。
  await env.DB.prepare("UPDATE review_items SET active=0,updated_at=? WHERE source_revision<>?").bind(now, sourceRevision).run();
  return json({ synced: seen.length, source_revision: sourceRevision, updated_at: now });
}
