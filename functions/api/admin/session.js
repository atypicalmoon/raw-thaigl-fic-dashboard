import { getAdminIdentity, json } from "../../_lib/admin.js";

export async function onRequestGet({ request, env }) {
  const identity = await getAdminIdentity(request, env);
  if (!identity) return json({ authenticated: false }, 401);
  return json({ authenticated: true, email: identity.email, source: identity.source });
}
