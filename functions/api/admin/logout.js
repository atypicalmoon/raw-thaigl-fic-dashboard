import { clearSessionCookie, json } from "../../_lib/admin.js";

export async function onRequestPost() {
  return json({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
}
