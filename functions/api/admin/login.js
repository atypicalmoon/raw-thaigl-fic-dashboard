import { createSessionCookie, getAdminIdentity, json, readJson } from "../../_lib/admin.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ error: "当前站点使用 Cloudflare Access 登录。" }, 404);
  const existing = await getAdminIdentity(request, env);
  if (existing) return json({ authenticated: true, email: existing.email });
  let body;
  try { body = await readJson(request); } catch (error) { return error; }
  if (String(body.password || "") !== String(env.ADMIN_PASSWORD)) return json({ error: "密码不正确。" }, 401);
  const email = String(env.ADMIN_EMAIL || "").split(",")[0].trim().toLowerCase();
  if (!email) return json({ error: "密码登录缺少管理者邮箱配置。" }, 503);
  return json({ authenticated: true, email }, 200, { "Set-Cookie": await createSessionCookie(request, env, email) });
}
