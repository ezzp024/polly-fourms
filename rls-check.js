#!/usr/bin/env node

const fs = require("fs");

function parseConfig() {
  const text = fs.readFileSync("config.js", "utf8");
  const url = (text.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1] || "";
  const anonKey = (text.match(/supabaseAnonKey:\s*"([^"]+)"/) || [])[1] || "";
  if (!url || !anonKey) {
    throw new Error("Missing supabaseUrl/supabaseAnonKey in config.js");
  }
  return { url, anonKey };
}

async function request(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, ok: res.ok, text, json };
}

function makeHeaders(anonKey, token, extra) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token || anonKey}`,
    "Content-Type": "application/json",
    ...(extra || {})
  };
}

function isNoRowsResponse(res) {
  if (Array.isArray(res.json)) return res.json.length === 0;
  return String(res.text || "").trim() === "[]";
}

function logStep(name, pass, details) {
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${details ? ` -> ${details}` : ""}`);
}

async function getLatestPostId(baseUrl, headers) {
  const rows = await request(`${baseUrl}/rest/v1/posts?select=id,title,author_user_id&order=created_at.desc&limit=1`, {
    headers
  });
  if (!Array.isArray(rows.json) || rows.json.length === 0) return null;
  return rows.json[0];
}

async function login(baseUrl, anonKey, email, password) {
  const loginRes = await request(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  if (!loginRes.json || !loginRes.json.access_token) {
    throw new Error(
      `Login failed (${loginRes.status}): ${
        (loginRes.json && (loginRes.json.error_description || loginRes.json.msg || loginRes.json.error)) || loginRes.text || "unknown"
      }`
    );
  }

  return loginRes.json;
}

async function runAnonChecks(baseUrl, anonKey) {
  const headers = makeHeaders(anonKey, null, { Prefer: "return=representation" });
  let passed = true;

  const probe = await getLatestPostId(baseUrl, headers);
  const hasPost = Boolean(probe && probe.id);

  const insertPost = await request(`${baseUrl}/rest/v1/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `Anon probe ${Date.now()}`,
      body: "Should be blocked for anon",
      category: "general",
      tags: [],
      author_name: "anon",
      author_user_id: null
    })
  });
  const insertBlocked = insertPost.status >= 400 || isNoRowsResponse(insertPost);
  passed = passed && insertBlocked;
  logStep("Anon cannot create post", insertBlocked, `status=${insertPost.status}`);

  if (hasPost) {
    const beforeTitle = probe.title;
    const patch = await request(`${baseUrl}/rest/v1/posts?id=eq.${probe.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: `ANON_PATCH_${Date.now()}` })
    });
    const afterRows = await request(`${baseUrl}/rest/v1/posts?id=eq.${probe.id}&select=title`, { headers });
    const unchanged = Array.isArray(afterRows.json) && afterRows.json[0] && afterRows.json[0].title === beforeTitle;
    const blocked = patch.status >= 400 || isNoRowsResponse(patch) || patch.status === 204;
    const ok = blocked && unchanged;
    passed = passed && ok;
    logStep("Anon cannot update post", ok, `status=${patch.status}`);
  }

  const reportsRead = await request(`${baseUrl}/rest/v1/reports?select=id&limit=1`, { headers });
  const reportsBlocked = reportsRead.status >= 400 || reportsRead.text === "[]";
  passed = passed && reportsBlocked;
  logStep("Anon cannot read reports", reportsBlocked, `status=${reportsRead.status}`);

  return passed;
}

async function ensureProfile(baseUrl, anonKey, token, userId, displayName) {
  const headers = makeHeaders(anonKey, token, { Prefer: "resolution=merge-duplicates,return=representation" });
  const res = await request(`${baseUrl}/rest/v1/profiles`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ user_id: userId, display_name: displayName }])
  });
  if (res.status >= 300) {
    throw new Error(`Profile upsert failed (${res.status}): ${res.text}`);
  }
}

async function runNonAdminChecks(baseUrl, anonKey, creds) {
  const session = await login(baseUrl, anonKey, creds.email, creds.password);
  const token = session.access_token;
  const userId = session.user && session.user.id;
  if (!userId) throw new Error("Missing user id in login response");

  const authedHeaders = makeHeaders(anonKey, token, { Prefer: "return=representation" });
  let passed = true;

  const adminCheck = await request(`${baseUrl}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: authedHeaders,
    body: "{}"
  });
  const isAdminFalse = adminCheck.status === 200 && String(adminCheck.text).trim() === "false";
  passed = passed && isAdminFalse;
  logStep("Non-admin is_admin() is false", isAdminFalse, `status=${adminCheck.status}`);

  await ensureProfile(baseUrl, anonKey, token, userId, creds.displayName);

  const createPost = await request(`${baseUrl}/rest/v1/posts`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify([
      {
        title: `RLS ownership probe ${Date.now()}`,
        body: "Owned post for boundary checks",
        category: "general",
        software_url: null,
        tags: ["rls"],
        author_name: creds.displayName,
        author_user_id: userId
      }
    ])
  });

  const ownCreated = Array.isArray(createPost.json) && createPost.json[0] && createPost.json[0].id;
  const ownPostId = ownCreated ? createPost.json[0].id : null;
  const ownCreateOk = createPost.status < 300 && Boolean(ownPostId);
  passed = passed && ownCreateOk;
  logStep("Non-admin can create own post", ownCreateOk, `status=${createPost.status}`);

  if (!ownPostId) {
    return false;
  }

  const ownModeratePatch = await request(`${baseUrl}/rest/v1/posts?id=eq.${ownPostId}`, {
    method: "PATCH",
    headers: authedHeaders,
    body: JSON.stringify({ is_pinned: true })
  });
  const ownModerateBlocked = ownModeratePatch.status >= 400 || isNoRowsResponse(ownModeratePatch) || ownModeratePatch.status === 204;
  passed = passed && ownModerateBlocked;
  logStep("Non-admin cannot change moderation fields", ownModerateBlocked, `status=${ownModeratePatch.status}`);
  if (!ownModerateBlocked) {
    console.log("  note: run latest supabase-setup.sql to install owner-update guard triggers.");
  }

  const ownEditTitle = `Owner edit ok ${Date.now()}`;
  const ownEdit = await request(`${baseUrl}/rest/v1/posts?id=eq.${ownPostId}`, {
    method: "PATCH",
    headers: authedHeaders,
    body: JSON.stringify({ title: ownEditTitle })
  });
  const ownReadBack = await request(`${baseUrl}/rest/v1/posts?id=eq.${ownPostId}&select=title`, { headers: authedHeaders });
  const ownEditApplied = Array.isArray(ownReadBack.json) && ownReadBack.json[0] && ownReadBack.json[0].title === ownEditTitle;
  const ownEditOk = ownEdit.status < 300 && ownEditApplied;
  passed = passed && ownEditOk;
  logStep("Non-admin can edit own post content", ownEditOk, `status=${ownEdit.status}`);

  const ownComment = await request(`${baseUrl}/rest/v1/comments`, {
    method: "POST",
    headers: authedHeaders,
    body: JSON.stringify([
      {
        post_id: ownPostId,
        author_name: creds.displayName,
        author_user_id: userId,
        body: `Ownership comment probe ${Date.now()}`
      }
    ])
  });
  const ownCommentId = Array.isArray(ownComment.json) && ownComment.json[0] ? ownComment.json[0].id : null;
  const ownCommentOk = ownComment.status < 300 && Boolean(ownCommentId);
  passed = passed && ownCommentOk;
  logStep("Non-admin can create own comment", ownCommentOk, `status=${ownComment.status}`);

  if (ownCommentId) {
    const mutateCommentIdentity = await request(`${baseUrl}/rest/v1/comments?id=eq.${ownCommentId}`, {
      method: "PATCH",
      headers: authedHeaders,
      body: JSON.stringify({ author_name: "hijacked-owner" })
    });
    const identityBlocked =
      mutateCommentIdentity.status >= 400 || isNoRowsResponse(mutateCommentIdentity) || mutateCommentIdentity.status === 204;
    passed = passed && identityBlocked;
    logStep("Non-admin cannot mutate comment identity", identityBlocked, `status=${mutateCommentIdentity.status}`);
  }

  const publicRows = await request(`${baseUrl}/rest/v1/posts?select=id,author_user_id&order=created_at.desc&limit=20`, {
    headers: makeHeaders(anonKey)
  });
  const other = Array.isArray(publicRows.json)
    ? publicRows.json.find((row) => row.id && row.id !== ownPostId && row.author_user_id && row.author_user_id !== userId)
    : null;

  if (other) {
    const before = await request(`${baseUrl}/rest/v1/posts?id=eq.${other.id}&select=title`, { headers: makeHeaders(anonKey) });
    const oldTitle = Array.isArray(before.json) && before.json[0] ? before.json[0].title : "";
    const patchOther = await request(`${baseUrl}/rest/v1/posts?id=eq.${other.id}`, {
      method: "PATCH",
      headers: authedHeaders,
      body: JSON.stringify({ title: `SHOULD_NOT_APPLY_${Date.now()}` })
    });
    const after = await request(`${baseUrl}/rest/v1/posts?id=eq.${other.id}&select=title`, { headers: makeHeaders(anonKey) });
    const unchanged = Array.isArray(after.json) && after.json[0] && after.json[0].title === oldTitle;
    const blocked = patchOther.status >= 400 || isNoRowsResponse(patchOther) || patchOther.status === 204;
    const ok = blocked && unchanged;
    passed = passed && ok;
    logStep("Non-admin cannot edit other user post", ok, `status=${patchOther.status}`);
  } else {
    logStep("Non-admin cannot edit other user post", true, "skipped (no suitable post found)");
  }

  const reportsRead = await request(`${baseUrl}/rest/v1/reports?select=id&limit=1`, { headers: authedHeaders });
  const reportsBlocked = reportsRead.status >= 400 || reportsRead.text === "[]";
  passed = passed && reportsBlocked;
  logStep("Non-admin cannot read reports", reportsBlocked, `status=${reportsRead.status}`);

  const commentsVisible = await request(`${baseUrl}/rest/v1/comments?select=id,author_user_id&order=created_at.desc&limit=50`, {
    headers: makeHeaders(anonKey)
  });
  const foreignComment = Array.isArray(commentsVisible.json)
    ? commentsVisible.json.find((row) => row.id && row.author_user_id && row.author_user_id !== userId)
    : null;
  if (foreignComment) {
    const beforeComment = await request(`${baseUrl}/rest/v1/comments?id=eq.${foreignComment.id}&select=id`, {
      headers: makeHeaders(anonKey)
    });
    const deleteForeignComment = await request(`${baseUrl}/rest/v1/comments?id=eq.${foreignComment.id}`, {
      method: "DELETE",
      headers: authedHeaders
    });
    const afterComment = await request(`${baseUrl}/rest/v1/comments?id=eq.${foreignComment.id}&select=id`, {
      headers: makeHeaders(anonKey)
    });
    const existedBefore = Array.isArray(beforeComment.json) && beforeComment.json.length > 0;
    const stillExists = Array.isArray(afterComment.json) && afterComment.json.length > 0;
    const blockedDelete =
      deleteForeignComment.status >= 400 || isNoRowsResponse(deleteForeignComment) || deleteForeignComment.status === 204;
    const foreignDeleteOk = !existedBefore || (blockedDelete && stillExists);
    passed = passed && foreignDeleteOk;
    logStep("Non-admin cannot delete other user comment", foreignDeleteOk, `status=${deleteForeignComment.status}`);
  } else {
    logStep("Non-admin cannot delete other user comment", true, "skipped (no suitable comment found)");
  }

  if (ownCommentId) {
    await request(`${baseUrl}/rest/v1/comments?id=eq.${ownCommentId}`, {
      method: "DELETE",
      headers: authedHeaders
    });
  }

  await request(`${baseUrl}/rest/v1/posts?id=eq.${ownPostId}`, {
    method: "DELETE",
    headers: authedHeaders
  });

  return passed;
}

async function main() {
  const { url, anonKey } = parseConfig();
  const nonAdminEmail = process.env.NON_ADMIN_EMAIL || "";
  const nonAdminPassword = process.env.NON_ADMIN_PASSWORD || "";
  const nonAdminDisplayName = process.env.NON_ADMIN_DISPLAY_NAME || `rls-user-${Date.now().toString().slice(-6)}`;

  console.log(`Project: ${url}`);
  console.log("Running anonymous checks...");
  const anonPass = await runAnonChecks(url, anonKey);

  let nonAdminPass = null;
  if (nonAdminEmail && nonAdminPassword) {
    console.log("Running non-admin authenticated checks...");
    nonAdminPass = await runNonAdminChecks(url, anonKey, {
      email: nonAdminEmail,
      password: nonAdminPassword,
      displayName: nonAdminDisplayName
    });
  } else {
    console.log("Skipping non-admin checks (set NON_ADMIN_EMAIL and NON_ADMIN_PASSWORD).");
  }

  const overall = anonPass && (nonAdminPass === null || nonAdminPass === true);
  console.log(`\nOverall: ${overall ? "PASS" : "FAIL"}`);

  if (!overall) process.exit(1);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message || String(error)}`);
  process.exit(1);
});
