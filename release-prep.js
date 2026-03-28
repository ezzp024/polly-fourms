#!/usr/bin/env node

const fs = require("fs");

const DISCORD_URL = "https://discord.gg/4wZAZC8Za";
const TELEGRAM_HANDLE = "@zeseret";
const OWNER_DISPLAY_NAME = "Opon";

function parseConfig() {
  const text = fs.readFileSync("config.js", "utf8");
  const supabaseUrl = (text.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1] || "";
  const supabaseAnonKey = (text.match(/supabaseAnonKey:\s*"([^"]+)"/) || [])[1] || "";
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase config in config.js");
  }
  return { supabaseUrl, supabaseAnonKey };
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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
  return { status: res.status, text, json };
}

function authHeaders(anonKey, token, extra) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
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

function onboardingBody(sectionName) {
  return [
    `Welcome to Polly Fourms ${sectionName} section. This official thread is your quick start guide for using the forum safely and effectively.`,
    "",
    "What this forum is for:",
    "- Share real software releases, development progress, troubleshooting questions, and practical project updates.",
    "- Build a clean and helpful community around coding, tools, and collaboration.",
    "",
    "What you are allowed to do:",
    "- Create threads with clear titles and useful details.",
    "- Reply with fixes, suggestions, and constructive feedback.",
    "- Share safe HTTPS download links for your own releases.",
    "",
    "How to create a thread:",
    "1) Open the target section and use Create Thread.",
    "2) Write a clear title and complete description.",
    "3) Add tags so others can find it quickly.",
    "4) For download links: submit only trusted HTTPS links. Links stay hidden until an admin manually approves after a manual security/antivirus review.",
    "",
    "How replies and moderation work:",
    "- Keep replies on-topic, technical, and respectful.",
    "- Reports are reviewed by admins.",
    "- Spam, scams, unsafe links, harassment, and evasion will result in moderation action or bans.",
    "",
    "Quick rules:",
    "- No malware, cracked software, or harmful payloads.",
    "- No impersonation, hate speech, or abuse.",
    "- No fake release claims or misleading download posts.",
    "",
    "Owner/Admin contact:",
    `- Telegram: ${TELEGRAM_HANDLE}`,
    `- Discord: ${DISCORD_URL}`,
    "",
    "If you are new, introduce yourself and read this thread before posting."
  ].join("\n");
}

async function safeDelete(baseUrl, anonKey, token, table, filter) {
  const path = `/rest/v1/${table}${filter ? `?${filter}` : ""}`;
  const res = await apiRequest(baseUrl, path, {
    method: "DELETE",
    headers: authHeaders(anonKey, token)
  });
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { supabaseUrl, supabaseAnonKey } = parseConfig();
  const adminEmail = requiredEnv("ADMIN_EMAIL");
  const adminPassword = requiredEnv("ADMIN_PASSWORD");

  const loginRes = await login(supabaseUrl, supabaseAnonKey, adminEmail, adminPassword);
  const token = loginRes.json?.access_token || "";
  const userId = loginRes.json?.user?.id || "";
  if (!token || !userId) {
    throw new Error(`Admin login failed: ${loginRes.text || loginRes.status}`);
  }

  const profileBio = "Founder and primary administrator of Polly Fourms. I keep this board focused on high-quality releases, clean technical discussion, and safe collaboration for builders.";

  const profileRes = await apiRequest(supabaseUrl, "/rest/v1/profiles", {
    method: "POST",
    headers: authHeaders(supabaseAnonKey, token, { Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify([{ user_id: userId, display_name: OWNER_DISPLAY_NAME, bio: profileBio }])
  });
  if (profileRes.status >= 400) {
    throw new Error(`Could not upsert owner profile: ${profileRes.text}`);
  }

  const adminGrant = await apiRequest(supabaseUrl, "/rest/v1/admin_users", {
    method: "POST",
    headers: authHeaders(supabaseAnonKey, token, { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify([{ user_id: userId, granted_by: OWNER_DISPLAY_NAME, note: "primary-owner-admin" }])
  });
  if (adminGrant.status >= 400) {
    throw new Error(`Could not grant/confirm admin ownership: ${adminGrant.text}`);
  }

  const cleanupPlan = [
    ["download_link_submissions", "id=not.is.null"],
    ["comments", "id=not.is.null"],
    ["reports", "id=not.is.null"],
    ["friendships", "id=not.is.null"],
    ["banned_users", "id=not.is.null"],
    ["posts", "id=not.is.null"],
    ["moderation_logs", "id=not.is.null"],
    ["profiles", `user_id=not.is.null&user_id=neq.${userId}`]
  ];

  for (const [table, filter] of cleanupPlan) {
    const res = await safeDelete(supabaseUrl, supabaseAnonKey, token, table, filter);
    if (res.status >= 400) {
      throw new Error(`Cleanup failed on ${table}: ${res.text}`);
    }
  }

  const sections = [
    { key: "general", name: "General Tech Chat" },
    { key: "software", name: "Software Releases" },
    { key: "help", name: "Coding Help" },
    { key: "showcase", name: "Project Showcase" }
  ];

  for (const section of sections) {
    const title = `Official Start Here (${section.name}) - Read Before Posting`;
    const body = onboardingBody(section.name);

    const createRes = await apiRequest(supabaseUrl, "/rest/v1/posts", {
      method: "POST",
      headers: authHeaders(supabaseAnonKey, token, { Prefer: "return=representation" }),
      body: JSON.stringify([
        {
          title,
          body,
          category: section.key,
          software_url: null,
          tags: ["official", "guide", "rules", "start-here"],
          author_name: OWNER_DISPLAY_NAME,
          author_user_id: userId,
          is_pinned: true,
          is_sticky: true,
          is_locked: false,
          is_hidden: false,
          is_solved: false,
          hidden_reason: null
        }
      ])
    });

    if (createRes.status >= 400) {
      throw new Error(`Could not create official thread for ${section.key}: ${createRes.text}`);
    }

    await sleep(15500);
  }

  console.log("Release prep completed.");
  console.log("- Fake/test/demo data removed");
  console.log("- Opon profile set as primary owner/admin");
  console.log("- Official pinned onboarding threads created for all sections");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
