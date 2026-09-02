import { applyConfirmedDecisions, triggerMonthlyWorkflow } from "../../../_lib/github.js";
import { json, nowIso, readJson, requireAdmin } from "../../../_lib/admin.js";

export async function onRequestPost({ request, env }) {
  try {
    const identity = await requireAdmin(request, env);
    if (!env.DB) return json({ error: "管理台数据库尚未连接。" }, 503);
    const body = await readJson(request);
    const ids = Array.isArray(body.item_ids) ? [...new Set(body.item_ids.map((id) => String(id).trim()).filter(Boolean))].slice(0, 200) : [];
    if (!ids.length) return json({ error: "请先选择要提交的决定。" }, 400);
    const placeholders = ids.map(() => "?").join(",");
    const result = await env.DB.prepare(
      "SELECT d.item_id,d.action,d.new_cp,d.note,i.id,i.link,i.title,i.current_cp,i.candidate_cps FROM review_decisions d JOIN review_items i ON i.id=d.item_id WHERE d.state IN ('draft','confirmed') AND d.action IN ('keep','change','exclude') AND i.active=1 AND i.kind='required' AND d.item_id IN (" + placeholders + ")",
    ).bind(...ids).all();
    const decisions = result.results || [];
    if (!decisions.length) return json({ error: "没有可提交的决定，请刷新后重试。" }, 400);
    const items = decisions.map((row) => row);
    const publish = await applyConfirmedDecisions(env, decisions, items, identity.email);
    const now = nowIso();
    try {
      await triggerMonthlyWorkflow(env);
    } catch (workflowError) {
      // 保持草稿状态，用户可以在任务恢复后重新提交。
      return json({ published_to_repo: publish.changed, workflow_started: false, warning: workflowError.message }, 502);
    }
    for (const decision of decisions) {
      await env.DB.prepare("UPDATE review_decisions SET state='submitted',confirmed_at=?,published_at=NULL,updated_at=?,user_email=? WHERE item_id=?")
        .bind(now, now, identity.email, decision.item_id).run();
      await env.DB.prepare("INSERT INTO review_history(item_id,event,action,new_cp,note,user_email,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(decision.item_id, "submitted", decision.action, decision.new_cp, decision.note, identity.email, now).run();
    }
    return json({ published_to_repo: publish.changed, workflow_started: true, submitted: decisions.length, updated_at: now });
  } catch (error) {
    return error instanceof Response ? error : json({ error: error.message || "发布失败。" }, error.status || 500);
  }
}
