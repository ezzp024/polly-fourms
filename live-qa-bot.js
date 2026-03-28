#!/usr/bin/env node

const fs = require("fs");
const { spawnSync } = require("child_process");

function parseConfig() {
  const text = fs.readFileSync("config.js", "utf8");
  const supabaseUrl = (text.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1] || "";
  const supabaseAnonKey = (text.match(/supabaseAnonKey:\s*"([^"]+)"/) || [])[1] || "";
  return { supabaseUrl, supabaseAnonKey };
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

function runScript(file, extraEnv) {
  const res = spawnSync(process.execPath, [file], {
    encoding: "utf8",
    env: { ...process.env, ...(extraEnv || {}) }
  });
  const output = `${res.stdout || ""}${res.stderr || ""}`.trim();
  return {
    name: `script:${file}`,
    ok: res.status === 0,
    code: res.status,
    output
  };
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

async function main() {
  const startedAt = new Date().toISOString();
  const { supabaseUrl } = parseConfig();
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

  const scriptChecks = [
    runScript("test-security.js"),
    runScript("test-detailed.js"),
    runScript("test-final.js"),
    runScript("rls-check.js")
  ];

  const normalizedScripts = scriptChecks.map((item) => ({
    ...item,
    ok: summarizeScriptResult(item)
  }));

  const allChecks = [...pageChecks, ...syntaxChecks, ...normalizedScripts];
  const failed = allChecks.filter((c) => !c.ok);

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    supabaseConfigured: Boolean(supabaseUrl),
    liveBaseUrl: pagesBase,
    totalChecks: allChecks.length,
    passedChecks: allChecks.length - failed.length,
    failedChecks: failed.length,
    overall: failed.length === 0 ? "PASS" : "FAIL",
    checks: allChecks
  };

  fs.writeFileSync("qa-live-report.json", JSON.stringify(report, null, 2));

  const lines = [];
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
