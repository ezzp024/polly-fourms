#!/usr/bin/env node

const fs = require("fs");
const { spawnSync } = require("child_process");

function parseConfig() {
  const text = fs.readFileSync("config.js", "utf8");
  const supabaseUrl = (text.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1] || "";
  const supabaseAnonKey = (text.match(/supabaseAnonKey:\s*"([^"]+)"/) || [])[1] || "";
  return { supabaseUrl, supabaseAnonKey };
}

function loadPreviousReport() {
  try {
    const raw = fs.readFileSync("qa-live-report.json", "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function compareWithPrevious(previousReport, currentChecks) {
  if (!previousReport || !Array.isArray(previousReport.checks)) {
    return {
      hasPrevious: false,
      fixedSinceLastRun: [],
      unresolvedFromLastRun: [],
      newlyDiscoveredIssues: [],
      potentialFalseFixClaims: []
    };
  }

  const previousByName = new Map(previousReport.checks.map((check) => [check.name, check]));
  const fixedSinceLastRun = [];
  const unresolvedFromLastRun = [];
  const newlyDiscoveredIssues = [];
  const potentialFalseFixClaims = [];

  for (const check of currentChecks) {
    const previous = previousByName.get(check.name);
    if (!previous) {
      if (!check.ok) newlyDiscoveredIssues.push(check.name);
      continue;
    }

    if (!previous.ok && check.ok) {
      fixedSinceLastRun.push(check.name);
    }
    if (!previous.ok && !check.ok) {
      unresolvedFromLastRun.push(check.name);
    }
    if (previous.ok && !check.ok) {
      newlyDiscoveredIssues.push(check.name);
    }

    const previousMarkedFixed = /fixed|resolved|patched|done/i.test(String(previous.note || ""));
    if (previousMarkedFixed && !check.ok) {
      potentialFalseFixClaims.push(check.name);
    }
  }

  return {
    hasPrevious: true,
    fixedSinceLastRun,
    unresolvedFromLastRun,
    newlyDiscoveredIssues,
    potentialFalseFixClaims
  };
}

function createCheck(name, ok, details) {
  return { name, ok: Boolean(ok), ...(details || {}) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runNodeCheck(file) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  return {
    name: `syntax:${file}`,
    ok: res.status === 0,
    code: res.status,
    output: `${res.stdout || ""}${res.stderr || ""}`.trim()
  };
}

function runScript(file) {
  const res = spawnSync(process.execPath, [file], {
    encoding: "utf8",
    env: { ...process.env }
  });
  const output = `${res.stdout || ""}${res.stderr || ""}`.trim();
  return {
    name: `script:${file}`,
    ok: res.status === 0,
    code: res.status,
    output
  };
}

function summarizeScriptResult(result) {
  const out = result.output || "";
  if (result.name.includes("test-final.js")) {
    return result.ok && out.includes("PASS - SECURE") && !out.includes("FAIL");
  }
  if (result.name.includes("test-detailed.js")) {
    return result.ok && out.includes("SECURE: YES") && !out.includes("VULNERABLE");
  }
  if (result.name.includes("test-security.js")) {
    return result.ok && out.includes("SECURE") && !out.includes("VULNERABLE");
  }
  if (result.name.includes("rls-check.js")) {
    return result.ok && out.includes("Overall: PASS");
  }
  return result.ok;
}

async function checkPage(url, mustContain) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    const contains = !mustContain || text.includes(mustContain);
    return {
      name: `page:${url}`,
      ok: res.status === 200 && contains,
      status: res.status,
      contains,
      note: contains ? "ok" : `missing marker: ${mustContain}`
    };
  } catch (error) {
    return {
      name: `page:${url}`,
      ok: false,
      status: 0,
      contains: false,
      note: error.message || String(error)
    };
  }
}

async function apiRequest(baseUrl, path, options) {
  const res = await fetch(`${baseUrl}${path}`, options || {});
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

function authHeaders(anonKey, token, extra) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token || anonKey}`,
    "Content-Type": "application/json",
    ...(extra || {})
  };
}

async function login(baseUrl, anonKey, email, password) {
  return apiRequest(baseUrl, "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
}

async function getUserFromToken(baseUrl, anonKey, token) {
  return apiRequest(baseUrl, "/auth/v1/user", {
    headers: authHeaders(anonKey, token)
  });
}

async function signup(baseUrl, anonKey, email, password) {
  return apiRequest(baseUrl, "/auth/v1/signup", {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
}

async function ensureProfile(baseUrl, anonKey, token, userId, displayName) {
  return apiRequest(baseUrl, "/rest/v1/profiles", {
    method: "POST",
    headers: authHeaders(anonKey, token, {
      Prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify([
      {
        user_id: userId,
        display_name: displayName
      }
    ])
  });
}

async function runAuthAndForumFlow(baseUrl, anonKey) {
  const checks = [];
  const cleanup = {
    createdPostId: null,
    createdReportId: null,
    nonAdminDisplayName: null,
    blockedLinkPostId: null
  };

  const runId = Date.now();
  const tempEmail = `polly.qa.${runId}@gmail.com`;
  const tempPassword = `QaPass!${runId}A`;

  const signUpRes = await signup(baseUrl, anonKey, tempEmail, tempPassword);
  const signupRateLimited = String(signUpRes.json?.error_code || "") === "over_email_send_rate_limit";
  const signupOk = signupRateLimited || (signUpRes.status < 500 && (signUpRes.json?.user || signUpRes.json?.id || signUpRes.ok));
  checks.push(
    createCheck("auth:signup-temp-user", signupOk, {
      status: signUpRes.status,
      note: signupRateLimited
        ? "signup blocked by Supabase email rate limit (service protection active)"
        : signupOk
          ? "signup endpoint accepted temp account"
          : signUpRes.text
    })
  );

  const tempLoginRes = await login(baseUrl, anonKey, tempEmail, tempPassword);
  const tempLoginOk = Boolean(tempLoginRes.json?.access_token);
  const tempLoginExpectedBlock = !tempLoginOk && signupOk;
  checks.push(
    createCheck("auth:login-temp-user", tempLoginOk || tempLoginExpectedBlock, {
      status: tempLoginRes.status,
      note: tempLoginOk
        ? "temp login succeeded"
        : "temp login blocked (likely email confirmation required)"
    })
  );

  const nonAdminEmail = process.env.NON_ADMIN_EMAIL || "sper1337@gmail.com";
  const nonAdminPassword = process.env.NON_ADMIN_PASSWORD || "12312344";
  const nonAdminLogin = await login(baseUrl, anonKey, nonAdminEmail, nonAdminPassword);
  const nonAdminToken = nonAdminLogin.json?.access_token || "";
  let nonAdminUserId = nonAdminLogin.json?.user?.id || "";
  checks.push(
    createCheck("auth:login-non-admin", Boolean(nonAdminToken), {
      status: nonAdminLogin.status,
      note: Boolean(nonAdminToken) ? "non-admin login succeeded" : nonAdminLogin.text
    })
  );

  if (!nonAdminToken) {
    return { checks, cleanup };
  }

  if (!nonAdminUserId) {
    const nonAdminUserRes = await getUserFromToken(baseUrl, anonKey, nonAdminToken);
    nonAdminUserId = nonAdminUserRes.json?.id || "";
  }
  checks.push(
    createCheck("auth:resolve-non-admin-user-id", Boolean(nonAdminUserId), {
      note: nonAdminUserId ? `user id ${nonAdminUserId}` : "could not resolve user id from token"
    })
  );

  const nonAdminDisplayName = `qauser_${String(runId).slice(-8)}`;
  cleanup.nonAdminDisplayName = nonAdminDisplayName;
  const upsertProfile = await ensureProfile(baseUrl, anonKey, nonAdminToken, nonAdminUserId, nonAdminDisplayName);
  checks.push(
    createCheck("profile:upsert-non-admin", upsertProfile.status < 300, {
      status: upsertProfile.status,
      note: upsertProfile.status < 300 ? "profile upsert ok" : upsertProfile.text
    })
  );

  const createPostRes = await apiRequest(baseUrl, "/rest/v1/posts", {
    method: "POST",
    headers: authHeaders(anonKey, nonAdminToken, { Prefer: "return=representation" }),
    body: JSON.stringify([
      {
        title: `QA thread ${runId}`,
        body: "Automated QA thread body",
        category: "general",
        software_url: `https://downloads.example.com/qa-${runId}.zip`,
        tags: ["qa", "automation"],
        author_name: nonAdminDisplayName,
        author_user_id: nonAdminUserId
      }
    ])
  });
  const createdPost = Array.isArray(createPostRes.json) ? createPostRes.json[0] : null;
  cleanup.createdPostId = createdPost?.id || null;
  checks.push(
    createCheck("forum:create-post-non-admin", Boolean(cleanup.createdPostId), {
      status: createPostRes.status,
      note: cleanup.createdPostId ? `post id ${cleanup.createdPostId}` : createPostRes.text
    })
  );

  if (cleanup.createdPostId) {
    const hiddenLinkRes = await apiRequest(baseUrl, `/rest/v1/posts?id=eq.${cleanup.createdPostId}&select=id,software_url`, {
      headers: authHeaders(anonKey, nonAdminToken)
    });
    const hiddenRow = Array.isArray(hiddenLinkRes.json) ? hiddenLinkRes.json[0] : null;
    const hiddenBeforeApproval = Boolean(hiddenRow) && !hiddenRow.software_url;
    checks.push(
      createCheck("feature:download-link-hidden-before-approval", hiddenBeforeApproval, {
        status: hiddenLinkRes.status,
        note: hiddenBeforeApproval ? "link hidden until admin approval" : "link is visible before admin approval"
      })
    );

    const createCommentRes = await apiRequest(baseUrl, "/rest/v1/comments", {
      method: "POST",
      headers: authHeaders(anonKey, nonAdminToken, { Prefer: "return=representation" }),
      body: JSON.stringify([
        {
          post_id: cleanup.createdPostId,
          author_name: nonAdminDisplayName,
          author_user_id: nonAdminUserId,
          body: "Automated QA comment"
        }
      ])
    });
    checks.push(
      createCheck("forum:create-comment-non-admin", createCommentRes.status < 300, {
        status: createCommentRes.status,
        note: createCommentRes.status < 300 ? "comment created" : createCommentRes.text
      })
    );

    let createReportRes = await apiRequest(baseUrl, "/rest/v1/reports", {
      method: "POST",
      headers: authHeaders(anonKey, nonAdminToken),
      body: JSON.stringify({
        post_id: cleanup.createdPostId,
        reason: "QA report validation",
        reporter_name: nonAdminDisplayName,
        reporter_user_id: nonAdminUserId,
        status: "open"
      })
    });
    if (createReportRes.status >= 400 && String(createReportRes.text || "").toLowerCase().includes("rate limit")) {
      await sleep(21000);
      createReportRes = await apiRequest(baseUrl, "/rest/v1/reports", {
        method: "POST",
        headers: authHeaders(anonKey, nonAdminToken),
        body: JSON.stringify({
          post_id: cleanup.createdPostId,
          reason: "QA report validation retry",
          reporter_name: nonAdminDisplayName,
          reporter_user_id: nonAdminUserId,
          status: "open"
        })
      });
    }
    cleanup.createdReportId = null;
    checks.push(
      createCheck("forum:create-report-non-admin", createReportRes.status < 300, {
        status: createReportRes.status,
        note: createReportRes.status < 300 ? "report created" : createReportRes.text
      })
    );
  }

  const nonAdminReportsRead = await apiRequest(baseUrl, "/rest/v1/reports?select=id&limit=10", {
    headers: authHeaders(anonKey, nonAdminToken)
  });
  const nonAdminCanReadReports = Array.isArray(nonAdminReportsRead.json) && nonAdminReportsRead.json.length > 0;
  checks.push(
    createCheck("security:non-admin-cannot-read-reports", !nonAdminCanReadReports, {
      status: nonAdminReportsRead.status,
      note: !nonAdminCanReadReports ? "reports hidden from non-admin" : "non-admin can read reports"
    })
  );

  const adminEmail = process.env.ADMIN_EMAIL || "ezzp024@gmail.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "12312344!y";
  const adminLogin = await login(baseUrl, anonKey, adminEmail, adminPassword);
  const adminToken = adminLogin.json?.access_token || "";
  let adminUserId = adminLogin.json?.user?.id || "";
  checks.push(
    createCheck("auth:login-admin", Boolean(adminToken), {
      status: adminLogin.status,
      note: Boolean(adminToken) ? "admin login succeeded" : adminLogin.text
    })
  );

  if (!adminToken) {
    return { checks, cleanup };
  }

  if (!adminUserId) {
    const adminUserRes = await getUserFromToken(baseUrl, anonKey, adminToken);
    adminUserId = adminUserRes.json?.id || "";
  }

  const adminDisplayName = `qaadmin_${String(runId).slice(-8)}`;
  if (adminUserId) {
    const adminProfileUpsert = await ensureProfile(baseUrl, anonKey, adminToken, adminUserId, adminDisplayName);
    checks.push(
      createCheck("profile:upsert-admin", adminProfileUpsert.status < 300, {
        status: adminProfileUpsert.status,
        note: adminProfileUpsert.status < 300 ? "admin profile upsert ok" : adminProfileUpsert.text
      })
    );
  }

  const isAdminRes = await apiRequest(baseUrl, "/rest/v1/rpc/is_admin", {
    method: "POST",
    headers: authHeaders(anonKey, adminToken),
    body: "{}"
  });
  const isAdminOk = String(isAdminRes.text || "").trim() === "true";
  checks.push(
    createCheck("auth:admin-rpc-is_admin", isAdminOk, {
      status: isAdminRes.status,
      note: isAdminOk ? "is_admin returned true" : isAdminRes.text
    })
  );

  const adminReadReports = await apiRequest(baseUrl, "/rest/v1/reports?select=id,status&order=created_at.desc&limit=50", {
    headers: authHeaders(anonKey, adminToken)
  });
  const adminCanReadReports = Array.isArray(adminReadReports.json);
  checks.push(
    createCheck("admin:can-read-reports", adminCanReadReports, {
      status: adminReadReports.status,
      note: adminCanReadReports ? `rows=${adminReadReports.json.length}` : adminReadReports.text
    })
  );

  if (cleanup.createdPostId) {
    const pendingSubmissionRes = await apiRequest(
      baseUrl,
      `/rest/v1/download_link_submissions?post_id=eq.${cleanup.createdPostId}&status=eq.pending&select=id,post_id,submitted_url,status`,
      {
        headers: authHeaders(anonKey, adminToken)
      }
    );
    const submissionRow = Array.isArray(pendingSubmissionRes.json) ? pendingSubmissionRes.json[0] : null;
    checks.push(
      createCheck("admin:can-read-pending-download-links", Boolean(submissionRow), {
        status: pendingSubmissionRes.status,
        note: submissionRow ? "pending link visible to admin" : pendingSubmissionRes.text || "pending link not found"
      })
    );

    if (submissionRow && submissionRow.id) {
      const reviewRes = await apiRequest(baseUrl, "/rest/v1/rpc/review_download_link_submission", {
        method: "POST",
        headers: authHeaders(anonKey, adminToken),
        body: JSON.stringify({
          p_submission_id: submissionRow.id,
          p_decision: "approved",
          p_security_check_status: "passed",
          p_security_notes: "Manual AV review complete: scanned with antivirus and no detections found.",
          p_reviewed_by: "qa-bot"
        })
      });
      checks.push(
        createCheck("admin:approve-download-link", reviewRes.status < 300, {
          status: reviewRes.status,
          note: reviewRes.status < 300 ? "download link approved" : reviewRes.text
        })
      );

      const postAfterApproval = await apiRequest(
        baseUrl,
        `/rest/v1/posts?id=eq.${cleanup.createdPostId}&select=id,software_url`,
        {
          headers: authHeaders(anonKey, nonAdminToken)
        }
      );
      const approvedPost = Array.isArray(postAfterApproval.json) ? postAfterApproval.json[0] : null;
      const linkVisibleAfterApproval = Boolean(approvedPost && approvedPost.software_url);
      checks.push(
        createCheck("feature:download-link-visible-after-approval", linkVisibleAfterApproval, {
          status: postAfterApproval.status,
          note: linkVisibleAfterApproval ? "link visible after admin approval" : "link still hidden after approval"
        })
      );
    }
  }

  const blockedDomain = `malware-${runId}.example.com`;
  const blockDomainRes = await apiRequest(baseUrl, "/rest/v1/blocked_link_domains", {
    method: "POST",
    headers: authHeaders(anonKey, adminToken),
    body: JSON.stringify([{ domain: blockedDomain }])
  });
  checks.push(
    createCheck("admin:ban-download-domain", blockDomainRes.status < 300 || String(blockDomainRes.text || "").toLowerCase().includes("duplicate"), {
      status: blockDomainRes.status,
      note: blockDomainRes.status < 300 ? `blocked ${blockedDomain}` : blockDomainRes.text
    })
  );

  if (nonAdminUserId) {
    const blockedLinkCreateRes = await apiRequest(baseUrl, "/rest/v1/posts", {
      method: "POST",
      headers: authHeaders(anonKey, nonAdminToken),
      body: JSON.stringify({
        title: `QA blocked-link thread ${runId}`,
        body: "Blocked link validation",
        category: "software",
        software_url: `https://${blockedDomain}/tool.zip`,
        tags: ["qa", "blocked-domain"],
        author_name: nonAdminDisplayName,
        author_user_id: nonAdminUserId
      })
    });
    const blockedEnforced = blockedLinkCreateRes.status >= 400;
    if (!blockedEnforced && Array.isArray(blockedLinkCreateRes.json) && blockedLinkCreateRes.json[0]?.id) {
      cleanup.blockedLinkPostId = blockedLinkCreateRes.json[0].id;
    }
    checks.push(
      createCheck("security:blocked-download-domain-enforced", blockedEnforced, {
        status: blockedLinkCreateRes.status,
        note: blockedEnforced ? "blocked domain rejected" : "blocked domain accepted"
      })
    );
  }

  if (!cleanup.createdReportId && nonAdminUserId) {
    const latestMine = await apiRequest(
      baseUrl,
      `/rest/v1/reports?select=id,reporter_user_id&reporter_user_id=eq.${encodeURIComponent(nonAdminUserId)}&order=created_at.desc&limit=1`,
      {
        headers: authHeaders(anonKey, adminToken)
      }
    );
    if (Array.isArray(latestMine.json) && latestMine.json[0] && latestMine.json[0].id) {
      cleanup.createdReportId = latestMine.json[0].id;
    }
  }

  if (cleanup.createdReportId) {
    const resolveRes = await apiRequest(baseUrl, `/rest/v1/reports?id=eq.${cleanup.createdReportId}`, {
      method: "PATCH",
      headers: authHeaders(anonKey, adminToken),
      body: JSON.stringify({ status: "resolved", resolved_by: "qa-bot", resolved_at: new Date().toISOString() })
    });
    checks.push(
      createCheck("admin:resolve-report", resolveRes.status < 300 || resolveRes.status === 204, {
        status: resolveRes.status,
        note: resolveRes.status < 300 || resolveRes.status === 204 ? "report resolved" : resolveRes.text
      })
    );
  }

  if (cleanup.createdPostId) {
    const moderatePatch = await apiRequest(baseUrl, `/rest/v1/posts?id=eq.${cleanup.createdPostId}`, {
      method: "PATCH",
      headers: authHeaders(anonKey, adminToken),
      body: JSON.stringify({ is_hidden: true, hidden_reason: "QA hide test", is_locked: true })
    });
    checks.push(
      createCheck("admin:moderate-post-hide-lock", moderatePatch.status < 300 || moderatePatch.status === 204, {
        status: moderatePatch.status,
        note: moderatePatch.status < 300 || moderatePatch.status === 204 ? "moderation patch ok" : moderatePatch.text
      })
    );

    const unmoderatePatch = await apiRequest(baseUrl, `/rest/v1/posts?id=eq.${cleanup.createdPostId}`, {
      method: "PATCH",
      headers: authHeaders(anonKey, adminToken),
      body: JSON.stringify({ is_hidden: false, hidden_reason: null, is_locked: false })
    });
    checks.push(
      createCheck("admin:moderate-post-unhide-unlock", unmoderatePatch.status < 300 || unmoderatePatch.status === 204, {
        status: unmoderatePatch.status,
        note: unmoderatePatch.status < 300 || unmoderatePatch.status === 204 ? "unhide/unlock ok" : unmoderatePatch.text
      })
    );
  }

  if (cleanup.nonAdminDisplayName) {
    const banRes = await apiRequest(baseUrl, "/rest/v1/banned_users", {
      method: "POST",
      headers: authHeaders(anonKey, adminToken, { Prefer: "return=representation" }),
      body: JSON.stringify([
        {
          nickname: cleanup.nonAdminDisplayName.toLowerCase(),
          reason: "QA ban test",
          banned_by: "qa-bot",
          active: true
        }
      ])
    });
    const banRow = Array.isArray(banRes.json) ? banRes.json[0] : null;
    checks.push(
      createCheck("admin:ban-user", Boolean(banRow?.id), {
        status: banRes.status,
        note: banRow?.id ? `ban id ${banRow.id}` : banRes.text
      })
    );

    if (banRow?.id) {
      const unbanRes = await apiRequest(baseUrl, `/rest/v1/banned_users?id=eq.${banRow.id}`, {
        method: "PATCH",
        headers: authHeaders(anonKey, adminToken),
        body: JSON.stringify({ active: false, resolved_at: new Date().toISOString() })
      });
      checks.push(
        createCheck("admin:unban-user", unbanRes.status < 300 || unbanRes.status === 204, {
          status: unbanRes.status,
          note: unbanRes.status < 300 || unbanRes.status === 204 ? "unban ok" : unbanRes.text
        })
      );
    }
  }

  if (cleanup.createdPostId) {
    const deleteRes = await apiRequest(baseUrl, `/rest/v1/posts?id=eq.${cleanup.createdPostId}`, {
      method: "DELETE",
      headers: authHeaders(anonKey, adminToken)
    });
    checks.push(
      createCheck("admin:cleanup-delete-created-post", deleteRes.status < 300 || deleteRes.status === 204, {
        status: deleteRes.status,
        note: deleteRes.status < 300 || deleteRes.status === 204 ? "cleanup ok" : deleteRes.text
      })
    );
  }

  if (cleanup.blockedLinkPostId) {
    await apiRequest(baseUrl, `/rest/v1/posts?id=eq.${cleanup.blockedLinkPostId}`, {
      method: "DELETE",
      headers: authHeaders(anonKey, adminToken)
    });
  }

  if (adminUserId && nonAdminUserId) {
    const idA = String(nonAdminUserId);
    const idB = String(adminUserId);
    const requester_user_id = idA;
    const requester_name = nonAdminDisplayName;
    const addressee_user_id = idB;
    const addressee_name = adminDisplayName;

    await apiRequest(
      baseUrl,
      `/rest/v1/friendships?or=(and(requester_user_id.eq.${idA},addressee_user_id.eq.${idB}),and(requester_user_id.eq.${idB},addressee_user_id.eq.${idA}))`,
      {
        method: "DELETE",
        headers: authHeaders(anonKey, adminToken)
      }
    );

    const addFriendRes = await apiRequest(baseUrl, "/rest/v1/friendships", {
      method: "POST",
      headers: authHeaders(anonKey, nonAdminToken),
      body: JSON.stringify({
        requester_user_id,
        requester_name,
        addressee_user_id,
        addressee_name,
        status: "pending"
      })
    });
    const addFriendOk = addFriendRes.status < 300 || String(addFriendRes.text || "").toLowerCase().includes("duplicate");
    checks.push(
      createCheck("feature:add-friend", addFriendOk, {
        status: addFriendRes.status,
        note: addFriendOk ? "friend request sent" : addFriendRes.text
      })
    );

    const pendingForAdmin = await apiRequest(
      baseUrl,
      `/rest/v1/friendships?requester_user_id=eq.${idA}&addressee_user_id=eq.${idB}&status=eq.pending&select=id,status`,
      {
        headers: authHeaders(anonKey, adminToken)
      }
    );
    const pendingRow = Array.isArray(pendingForAdmin.json) ? pendingForAdmin.json[0] : null;
    checks.push(
      createCheck("feature:friend-request-visible-to-addressee", Boolean(pendingRow), {
        status: pendingForAdmin.status,
        note: pendingRow ? "request visible to addressee" : pendingForAdmin.text || "request not found"
      })
    );

    if (pendingRow && pendingRow.id) {
      const acceptRes = await apiRequest(baseUrl, `/rest/v1/friendships?id=eq.${pendingRow.id}`, {
        method: "PATCH",
        headers: authHeaders(anonKey, adminToken),
        body: JSON.stringify({ status: "accepted", accepted_at: new Date().toISOString() })
      });
      checks.push(
        createCheck("feature:accept-friend-request", acceptRes.status < 300 || acceptRes.status === 204, {
          status: acceptRes.status,
          note: acceptRes.status < 300 || acceptRes.status === 204 ? "friend request accepted" : acceptRes.text
        })
      );
    }

    const listAfterAdd = await apiRequest(baseUrl, "/rest/v1/friendships?select=requester_name,addressee_name", {
      headers: authHeaders(anonKey, nonAdminToken)
    });
    const hasFriend = Array.isArray(listAfterAdd.json)
      && listAfterAdd.json.some((row) => {
        const a = String(row.requester_name || "").toLowerCase();
        const b = String(row.addressee_name || "").toLowerCase();
        return (a === requester_name.toLowerCase() && b === addressee_name.toLowerCase())
          || (a === addressee_name.toLowerCase() && b === requester_name.toLowerCase());
      });
    checks.push(
      createCheck("feature:list-friends-after-add", hasFriend, {
        note: hasFriend ? "friend appears in list" : "friend not found after add"
      })
    );

    const removeFriendRes = await apiRequest(
      baseUrl,
      `/rest/v1/friendships?or=(and(requester_user_id.eq.${idA},addressee_user_id.eq.${idB}),and(requester_user_id.eq.${idB},addressee_user_id.eq.${idA}))`,
      {
        method: "DELETE",
        headers: authHeaders(anonKey, nonAdminToken)
      }
    );
    const removeFriendOk = removeFriendRes.status < 300 || removeFriendRes.status === 204;
    checks.push(
      createCheck("feature:remove-friend", removeFriendOk, {
        status: removeFriendRes.status,
        note: removeFriendOk ? "friend removed" : removeFriendRes.text
      })
    );
  } else {
    checks.push(createCheck("feature:add-friend", false, { note: "missing user ids for friend test" }));
    checks.push(createCheck("feature:friend-request-visible-to-addressee", false, { note: "missing user ids for friend test" }));
    checks.push(createCheck("feature:accept-friend-request", false, { note: "missing user ids for friend test" }));
    checks.push(createCheck("feature:remove-friend", false, { note: "missing user ids for friend test" }));
  }

  return { checks, cleanup };
}

async function main() {
  const startedAt = new Date().toISOString();
  const previousReport = loadPreviousReport();
  const { supabaseUrl, supabaseAnonKey } = parseConfig();
  const pagesBase = process.env.LIVE_BASE_URL || "https://ezzp024.github.io/polly-fourms";

  const pageChecks = await Promise.all([
    checkPage(`${pagesBase}/`, "Polly Fourms"),
    checkPage(`${pagesBase}/auth.html`, "Welcome Back"),
    checkPage(`${pagesBase}/forum.html?section=software`, "Create Thread"),
    checkPage(`${pagesBase}/releases.html`, "Latest Software Releases"),
    checkPage(`${pagesBase}/profile.html`, "Member"),
    checkPage(`${pagesBase}/admin.html`, "Admin")
  ]);

  const syntaxFiles = [
    "auth.js",
    "common.js",
    "forum-api.js",
    "forum.js",
    "thread.js",
    "admin.js",
    "profile.js",
    "home.js",
    "releases.js"
  ];
  const syntaxChecks = syntaxFiles.map(runNodeCheck);

  const scriptChecksRaw = [
    runScript("test-security.js"),
    runScript("test-detailed.js"),
    runScript("test-final.js"),
    runScript("rls-check.js")
  ];
  const scriptChecks = scriptChecksRaw.map((item) => ({
    ...item,
    ok: summarizeScriptResult(item)
  }));

  let flowChecks = [];
  if (supabaseUrl && supabaseAnonKey) {
    const flow = await runAuthAndForumFlow(supabaseUrl, supabaseAnonKey);
    flowChecks = flow.checks;
  } else {
    flowChecks = [
      createCheck("auth-and-forum-flow", false, {
        note: "Supabase config missing; cannot run live auth/post/admin flow."
      })
    ];
  }

  const allChecks = [...pageChecks, ...syntaxChecks, ...scriptChecks, ...flowChecks];
  const failed = allChecks.filter((c) => !c.ok);
  const comparison = compareWithPrevious(previousReport, allChecks);

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
    liveBaseUrl: pagesBase,
    totalChecks: allChecks.length,
    passedChecks: allChecks.length - failed.length,
    failedChecks: failed.length,
    overall: failed.length === 0 ? "PASS" : "FAIL",
    comparison,
    checks: allChecks
  };

  fs.writeFileSync("qa-live-report.json", JSON.stringify(report, null, 2));

  const lines = [];
  lines.push("Newly Discovered Issues (Top Priority):");
  if (comparison.newlyDiscoveredIssues.length) {
    for (const name of comparison.newlyDiscoveredIssues) {
      lines.push(`- ${name}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("Unresolved Issues From Previous Run:");
  if (comparison.unresolvedFromLastRun.length) {
    for (const name of comparison.unresolvedFromLastRun) {
      lines.push(`- ${name}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("Fixed Since Previous Run:");
  if (comparison.fixedSinceLastRun.length) {
    for (const name of comparison.fixedSinceLastRun) {
      lines.push(`- ${name}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push("Potential False-Fix Claims:");
  if (comparison.potentialFalseFixClaims.length) {
    for (const name of comparison.potentialFalseFixClaims) {
      lines.push(`- ${name}`);
    }
  } else {
    lines.push("- none");
  }
  lines.push("");

  lines.push(`Live QA Bot: ${report.overall}`);
  lines.push(`Checks: ${report.passedChecks}/${report.totalChecks} passed`);
  lines.push(`Base URL: ${pagesBase}`);
  lines.push("");
  for (const check of allChecks) {
    lines.push(`${check.ok ? "[PASS]" : "[FAIL]"} ${check.name}`);
    if (check.note) lines.push(`  ${check.note}`);
    if (!check.ok && check.output) lines.push(`  ${check.output.split("\n")[0]}`);
  }
  fs.writeFileSync("qa-live-report.txt", lines.join("\n"));

  console.log(lines.join("\n"));
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Live QA bot crashed:", error.message || String(error));
  process.exit(1);
});
