const SESSION_COOKIE = "review_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...extraHeaders,
    },
  });
}

export function methodNotAllowed(methods) {
  return json({ error: "只支持 " + methods.join("、") + "。" }, 405, {
    Allow: methods.join(", "),
  });
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new Response(JSON.stringify({ error: "请求内容不是有效 JSON。" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

function allowedEmails(env) {
  return String(env.ADMIN_EMAILS || env.ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.get("Cookie") || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, value.join("=")]),
  );
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const text = String(value);
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signSession(payload, secret) {
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(encoded)));
  return encoded + "." + base64UrlEncode(signature);
}

async function verifySession(value, secret) {
  if (!value || !secret) return null;
  const parts = String(value).split(".");
  const encoded = parts[0];
  const signature = parts[1];
  if (!encoded || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), base64UrlDecode(signature), new TextEncoder().encode(encoded));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
    if (!payload.email || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSessionCookie(request, env, email) {
  if (!env.ADMIN_SESSION_SECRET) throw new Error("缺少 ADMIN_SESSION_SECRET");
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ email, iat: now, exp: now + SESSION_TTL_SECONDS }, env.ADMIN_SESSION_SECRET);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return SESSION_COOKIE + "=" + token + "; Path=/; Max-Age=" + SESSION_TTL_SECONDS + "; HttpOnly; SameSite=Lax" + secure;
}

export function clearSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
}

export async function getAdminIdentity(request, env) {
  const accessEmail = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").trim().toLowerCase();
  const allowlist = allowedEmails(env);
  if (accessEmail && allowlist.includes(accessEmail)) return { email: accessEmail, source: "cloudflare-access" };

  const session = await verifySession(parseCookies(request)[SESSION_COOKIE], env.ADMIN_SESSION_SECRET);
  if (session && allowlist.includes(String(session.email).toLowerCase())) return { email: session.email, source: "password-session" };
  return null;
}

export async function requireAdmin(request, env) {
  const identity = await getAdminIdentity(request, env);
  if (identity) return identity;
  throw json({ error: "需要管理台登录。" }, 401, { "WWW-Authenticate": "Bearer" });
}

export function requireSyncToken(request, env) {
  const expected = String(env.REVIEW_SYNC_TOKEN || "");
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || supplied.length !== expected.length) return false;
  let result = 0;
  for (let index = 0; index < expected.length; index += 1) result |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return result === 0;
}

export function cleanAction(value) {
  return ["keep", "exclude", "change"].includes(String(value)) ? String(value) : "";
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
