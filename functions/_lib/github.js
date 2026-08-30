import { parseCsv, stringifyCsv } from "./csv.js";

function repoConfig(env) {
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH || "main").trim();
  if (!owner || !repo || !env.GITHUB_REVIEW_TOKEN) throw new Error("管理台尚未配置私有仓库连接。");
  return { owner, repo, branch };
}

async function githubRequest(env, path, options = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer " + env.GITHUB_REVIEW_TOKEN,
      "User-Agent": "raw-thaigl-review-desk",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.message || ("GitHub 请求失败（" + response.status + "）。"));
    error.status = response.status;
    throw error;
  }
  return body;
}

function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function readRepoFile(env, path) {
  const { owner, repo, branch } = repoConfig(env);
  const body = await githubRequest(env, "/repos/" + owner + "/" + repo + "/contents/" + path + "?ref=" + encodeURIComponent(branch));
  return { sha: body.sha, text: decodeBase64(body.content) };
}

export async function writeRepoFile(env, path, text, sha, message) {
  const { owner, repo, branch } = repoConfig(env);
  return githubRequest(env, "/repos/" + owner + "/" + repo + "/contents/" + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: encodeBase64(text), sha, branch }),
  });
}

export async function triggerMonthlyWorkflow(env) {
  const { owner, repo, branch } = repoConfig(env);
  const response = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/actions/workflows/monthly-update.yml/dispatches", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer " + env.GITHUB_REVIEW_TOKEN,
      "User-Agent": "raw-thaigl-review-desk",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: branch, inputs: { refresh_source: "false", publish: "true" } }),
  });
  if (!response.ok) {
    let body = {};
    try { body = await response.json(); } catch {}
    const error = new Error(body.message || ("无法启动月度更新（" + response.status + "）。"));
    error.status = response.status;
    throw error;
  }
}

export async function applyConfirmedDecisions(env, decisions, items, email) {
  const current = await readRepoFile(env, "config/manual_overrides.csv");
  const headers = ["link", "cp", "status", "note", "updated_at"];
  const rows = parseCsv(current.text);
  const byLink = new Map(rows.map((row) => [String(row.link || "").replace(/\/$/, ""), row]));
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  for (const decision of decisions) {
    const item = itemById.get(String(decision.item_id));
    if (!item) throw new Error("校对记录已过期，请先刷新管理台。");
    const action = decision.action;
    const link = String(item.link || "").replace(/\/$/, "");
    const currentCp = String(item.current_cp || "").trim();
    const candidates = String(item.candidate_cps || "").split("|").map((value) => value.trim()).filter(Boolean);
    const row = byLink.get(link) || { link, cp: "", status: "", note: "", updated_at: timestamp };
    const note = String(decision.note || row.note || "").trim();
    if (action === "keep") {
      if (!currentCp) throw new Error("缺少当前 CP，无法保存保留决定。");
      row.cp = currentCp;
      row.status = "";
    } else if (action === "change") {
      const newCp = String(decision.new_cp || "").trim();
      if (!newCp || (!candidates.includes(newCp) && newCp !== currentCp)) throw new Error("新的 CP 不在候选范围内：" + newCp);
      row.cp = newCp;
      row.status = "";
    } else if (action === "exclude") {
      row.cp = "";
      row.status = "手动排除";
    } else {
      continue;
    }
    row.note = note;
    row.updated_at = timestamp;
    byLink.set(link, row);
  }

  const nextRows = [...byLink.values()].sort((a, b) => String(a.link).localeCompare(String(b.link)));
  const nextText = stringifyCsv(nextRows, headers);
  if (nextText !== current.text) {
    await writeRepoFile(env, "config/manual_overrides.csv", nextText, current.sha, "Review decisions from " + email);
  }
  return { changed: nextText !== current.text };
}
