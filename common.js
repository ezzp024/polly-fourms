(function () {
  const CONFIG = window.POLLY_CONFIG || {};
  const AUTH_STORAGE_KEY = "polly_auth_main";
  const RATE_LIMIT_KEY = "polly_rate_limit";
  const SESSION_CHECK_KEY = "polly_session_verified";
  let authClient = null;
  let sessionVerified = false;
  let storageListenerInitialized = false;
  let navRefreshToken = 0;
  let lastKnownUser = null;
  let lastKnownUserAt = 0;
  const identityState = {
    loaded: false,
    user: null,
    profile: null
  };

  function setupStorageListener() {
    if (storageListenerInitialized) return;
    storageListenerInitialized = true;
    
    window.addEventListener("storage", (event) => {
      if (event.key === AUTH_STORAGE_KEY || event.key === SESSION_CHECK_KEY) {
        identityState.loaded = false;
        identityState.user = null;
        identityState.profile = null;
        sessionVerified = false;
        void refreshSessionNav();
      }
    });
  }

  function hasSupabaseConfig() {
    return (
      typeof CONFIG.supabaseUrl === "string" &&
      CONFIG.supabaseUrl.length > 0 &&
      typeof CONFIG.supabaseAnonKey === "string" &&
      CONFIG.supabaseAnonKey.length > 0
    );
  }

  const SECTION_META = {
    software: {
      key: "software",
      name: "Software Releases",
      description: "Publish programs, updates, changelogs, and download links."
    },
    help: {
      key: "help",
      name: "Coding Help",
      description: "Ask technical questions and help others solve bugs."
    },
    showcase: {
      key: "showcase",
      name: "Project Showcase",
      description: "Show your apps, scripts, bots, and experiments."
    },
    general: {
      key: "general",
      name: "General Tech Chat",
      description: "General discussion about coding, tech news, and tools."
    }
  };

  function escapeHtml(input) {
    return String(input)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function parseMarkdown(text) {
    if (!text) return "";
    const escaped = escapeHtml(text);
    let html = escaped;
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
    html = html.replace(/`(.+?)`/g, "<code>$1</code>");
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  const EMOJI_PICKER_EMOJIS = [
    "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊",
    "😇", "🙂", "😉", "😍", "🤔", "😌", "😔", "😴", "🤯", "😎",
    "👍", "👎", "👏", "🙌", "🤝", "💪", "✌️", "🤞", "❤️", "💔",
    "🎉", "🔥", "⭐", "✨", "💡", "⚠️", "✅", "❌", "➡️", "⬇️"
  ];

  function initEmojiPickers() {
    document.querySelectorAll(".emoji-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute("data-target");
        const textarea = document.getElementById(targetId);
        if (!textarea) return;

        let picker = btn.nextElementSibling;
        if (!picker || !picker.classList.contains("emoji-picker")) {
          picker = document.createElement("div");
          picker.className = "emoji-picker";
          picker.style.cssText =
            "position:absolute;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:0.4rem;display:grid;grid-template-columns:repeat(8,1fr);gap:0.2rem;z-index:1000;max-width:280px;box-shadow:var(--shadow);";
          EMOJI_PICKER_EMOJIS.forEach((emoji) => {
            const span = document.createElement("button");
            span.type = "button";
            span.textContent = emoji;
            span.style.cssText = "background:transparent;border:none;font-size:1.2rem;cursor:pointer;padding:0.1rem;";
            span.addEventListener("click", (ev) => {
              ev.preventDefault();
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const text = textarea.value;
              textarea.value = text.slice(0, start) + emoji + text.slice(end);
              textarea.focus();
              textarea.setSelectionRange(start + emoji.length, start + emoji.length);
              picker.remove();
            });
            picker.appendChild(span);
          });
          btn.parentElement.style.position = "relative";
          btn.parentElement.appendChild(picker);
        } else {
          picker.remove();
        }
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.classList.contains("emoji-btn")) {
        document.querySelectorAll(".emoji-picker").forEach((p) => p.remove());
      }
    });
  }

  function initMentionAutocomplete(api) {
    let cachedNames = null;
    let cacheTime = 0;
    const CACHE_TTL = 30000;

    async function getUsernames() {
      const now = Date.now();
      if (!cachedNames || now - cacheTime > CACHE_TTL) {
        try {
          const [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
          const names = new Set();
          posts.forEach((p) => { if (p.author_name) names.add(p.author_name); });
          comments.forEach((c) => { if (c.author_name) names.add(c.author_name); });
          cachedNames = [...names];
          cacheTime = now;
        } catch (err) {
          cachedNames = [];
        }
      }
      return cachedNames;
    }

    document.querySelectorAll("textarea").forEach((textarea) => {
      if (textarea.dataset.mentionInitialized) return;
      textarea.dataset.mentionInitialized = "true";

      textarea.addEventListener("input", async (e) => {
        const text = textarea.value;
        const cursorPos = textarea.selectionStart;
        const lastAt = text.lastIndexOf("@", cursorPos - 1);

        if (lastAt === -1) {
          document.querySelectorAll(".mention-dropdown").forEach((d) => d.remove());
          return;
        }

        const searchText = text.slice(lastAt + 1, cursorPos);
        if (searchText.includes(" ") || searchText.length < 1) {
          document.querySelectorAll(".mention-dropdown").forEach((d) => d.remove());
          return;
        }

        try {
          const names = await getUsernames();
          const matches = names
            .filter((n) => n.toLowerCase().includes(searchText.toLowerCase()))
            .slice(0, 5);

          if (matches.length === 0) {
            document.querySelectorAll(".mention-dropdown").forEach((d) => d.remove());
            return;
          }

          let dropdown = document.querySelector(".mention-dropdown");
          if (!dropdown) {
            dropdown = document.createElement("div");
            dropdown.className = "mention-dropdown";
            dropdown.style.cssText = "position:absolute;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:0.3rem;z-index:1000;max-height:150px;overflow-y:auto;box-shadow:var(--shadow);";
            textarea.parentElement.style.position = "relative";
            textarea.parentElement.appendChild(dropdown);
          }

          dropdown.innerHTML = matches.map((name) =>
            `<div class="mention-item" data-name="${escapeHtml(name)}">${escapeHtml(name)}</div>`
          ).join("");

          dropdown.querySelectorAll(".mention-item").forEach((item) => {
            item.addEventListener("click", () => {
              const before = text.slice(0, lastAt);
              const after = text.slice(cursorPos);
              textarea.value = before + "@" + item.textContent + " " + after;
              textarea.focus();
              textarea.setSelectionRange(before.length + item.textContent.length + 2, before.length + item.textContent.length + 2);
              dropdown.remove();
            });
          });
        } catch (err) {
          console.warn("Mention fetch failed:", err);
        }
      });

      textarea.addEventListener("blur", () => {
        setTimeout(() => {
          document.querySelectorAll(".mention-dropdown").forEach((d) => d.remove());
        }, 200);
      });
    });
  }

  function formatDate(iso) {
    if (!iso) return "-";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(iso));
  }

  function formatRelative(iso) {
    if (!iso) return "";
    const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return "just now";
    if (abs < 3600) return `${Math.floor(abs / 60)}m ago`;
    if (abs < 86400) return `${Math.floor(abs / 3600)}h ago`;
    return `${Math.floor(abs / 86400)}d ago`;
  }

  function getNickname() {
    if (hasSupabaseConfig()) {
      if (identityState.profile && identityState.profile.display_name) {
        return identityState.profile.display_name;
      }
      return "";
    }

    if (identityState.profile && identityState.profile.display_name) {
      return identityState.profile.display_name;
    }
    return localStorage.getItem("polly_nickname") || "";
  }

  function setNickname(value) {
    if (hasSupabaseConfig()) return;
    localStorage.setItem("polly_nickname", value);
  }

  async function fetchMyProfile() {
    const client = createAuthClient();
    const user = await getAuthUser();
    if (!client || !user) return null;

    const { data, error } = await client
      .from("profiles")
      .select("user_id, display_name, bio, created_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return null;
    return data || null;
  }

  async function ensureIdentityLoaded() {
    if (identityState.loaded) return identityState;
    identityState.user = await getAuthUser();
    identityState.profile = await fetchMyProfile();
    if (identityState.profile && identityState.profile.display_name) {
      setNickname(identityState.profile.display_name);
    }
    identityState.loaded = true;
    return identityState;
  }

  async function refreshIdentity() {
    identityState.loaded = false;
    identityState.user = null;
    identityState.profile = null;
    return ensureIdentityLoaded();
  }

  async function saveMyDisplayName(displayName) {
    const client = createAuthClient();
    const user = await getAuthUser();
    if (!client || !user) throw new Error("Login required");

    const clean = String(displayName || "").trim().slice(0, 24);
    if (!clean) throw new Error("Display name is required");

    const { error } = await client.from("profiles").upsert(
      {
        user_id: user.id,
        display_name: clean
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;

    identityState.profile = {
      ...(identityState.profile || {}),
      user_id: user.id,
      display_name: clean
    };
    identityState.user = user;
    identityState.loaded = true;
    setNickname(clean);
    return clean;
  }

  function initIdentityForm() {
    const form = document.getElementById("identityForm");
    const input = document.getElementById("nickname");
    if (!form || !input) return;

    void ensureIdentityLoaded().then((state) => {
      if (state.profile && state.profile.display_name) {
        input.value = state.profile.display_name;
      } else {
        input.value = getNickname();
      }
      if (!state.user) {
        input.placeholder = hasSupabaseConfig() ? "Login to set display name" : "Your nickname";
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = input.value.trim().slice(0, 24);
      if (!value) return;
      try {
        const user = await getAuthUser();
        if (user) {
          const saved = await saveMyDisplayName(value);
          input.value = saved;
        } else if (!hasSupabaseConfig()) {
          setNickname(value);
          input.value = value;
        } else {
          window.location.href = routePath("auth");
        }
      } catch {
        if (!hasSupabaseConfig()) {
          setNickname(value);
          input.value = value;
        }
      }
    });
  }

  function normalizeTags(raw) {
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((value, index, arr) => value && arr.indexOf(value) === index)
      .slice(0, 10);
  }

  function getSection(key) {
    return SECTION_META[key] || SECTION_META.general;
  }

  function toHandle(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 32);
  }

  function profileLink(name) {
    const handle = encodeURIComponent(toHandle(name));
    return routePath("profile", `user=${handle}`);
  }

  function rankFromScore(score) {
    if (score >= 25) return "Veteran";
    if (score >= 8) return "Contributor";
    return "Newbie";
  }

  function buildMemberStats(posts, comments) {
    const byHandle = new Map();
    const ensure = (name) => {
      const handle = toHandle(name);
      if (!byHandle.has(handle)) {
        byHandle.set(handle, {
          handle,
          displayName: name,
          threads: 0,
          replies: 0,
          score: 0,
          rank: "Newbie",
          recentThreads: [],
          recentReplies: []
        });
      }
      return byHandle.get(handle);
    };

    posts.forEach((post) => {
      const item = ensure(post.author_name);
      item.threads += 1;
      item.score += 3;
      item.recentThreads.push(post);
    });

    comments.forEach((comment) => {
      const item = ensure(comment.author_name);
      item.replies += 1;
      item.score += 1;
      item.recentReplies.push(comment);
    });

    byHandle.forEach((item) => {
      item.rank = rankFromScore(item.score);
      item.recentThreads.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      item.recentReplies.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    });

    return byHandle;
  }

  function getRoleByNickname(name) {
    const normalized = toHandle(name);
    const admins = (CONFIG.adminNames || []).map((n) => toHandle(n));
    const mods = (CONFIG.moderatorNames || []).map((n) => toHandle(n));
    if (admins.includes(normalized)) return "admin";
    if (mods.includes(normalized)) return "moderator";
    return "member";
  }

  function getCurrentRole() {
    return getRoleByNickname(getNickname());
  }

  function isModerator() {
    const supabaseEnabled =
      typeof CONFIG.supabaseUrl === "string" &&
      CONFIG.supabaseUrl.length > 0 &&
      typeof CONFIG.supabaseAnonKey === "string" &&
      CONFIG.supabaseAnonKey.length > 0;
    if (supabaseEnabled) return false;
    const role = getCurrentRole();
    return role === "admin" || role === "moderator";
  }

  function createAuthClient() {
    const hasSupabase = hasSupabaseConfig() && window.supabase;
    if (!hasSupabase) return null;
    if (!authClient) {
      authClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
        auth: { 
          storageKey: AUTH_STORAGE_KEY,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        }
      });
      
      setupStorageListener();
    }
    return authClient;
  }

  function readRateStore() {
    try {
      return JSON.parse(localStorage.getItem(RATE_LIMIT_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeRateStore(store) {
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(store));
  }

  function canPerform(action, minMs) {
    const now = Date.now();
    const store = readRateStore();
    const last = Number(store[action] || 0);
    const nextAllowedIn = Math.max(0, minMs - (now - last));
    return { ok: nextAllowedIn === 0, nextAllowedIn };
  }

  function markPerformed(action) {
    const store = readRateStore();
    store[action] = Date.now();
    writeRateStore(store);
  }

  function formatWaitMs(ms) {
    const sec = Math.ceil(ms / 1000);
    return `${sec}s`;
  }

  function sanitizeNextPath(rawNext) {
    const fallback = routePath("index");
    const next = String(rawNext || "").trim();
    if (!next) return fallback;
    if (next.startsWith("http://") || next.startsWith("https://") || next.startsWith("//")) {
      return fallback;
    }

    const clean = toCleanPathAndQuery(next);
    const parsed = new URL(clean, window.location.href);
    const allowed = new Set(Object.values(ROUTE_SEGMENTS));
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    const canonical = APP_BASE_PATH && pathname.startsWith(APP_BASE_PATH)
      ? pathname.slice(APP_BASE_PATH.length)
      : pathname;
    if (!allowed.has(canonical)) return fallback;
    return `${pathname}${parsed.search}${parsed.hash}`;
  }

  function ensurePageNoticeNode() {
    let node = document.getElementById("pageNotice");
    if (node) return node;

    const main = document.querySelector("main");
    if (!main || !main.parentElement) return null;

    node = document.createElement("div");
    node.id = "pageNotice";
    node.className = "page-notice hidden-block";
    main.parentElement.insertBefore(node, main);
    return node;
  }

  function showPageNotice(message, type, timeoutMs) {
    const node = ensurePageNoticeNode();
    if (!node) return;

    const kind = type === "error" || type === "success" || type === "warning" ? type : "info";
    node.className = `page-notice page-notice-${kind}`;
    node.textContent = String(message || "");

    const ms = Number(timeoutMs || 0);
    if (ms > 0) {
      setTimeout(() => {
        if (node.textContent === String(message || "")) {
          node.className = "page-notice hidden-block";
          node.textContent = "";
        }
      }, ms);
    }
  }

  function clearPageNotice() {
    const node = document.getElementById("pageNotice");
    if (!node) return;
    node.className = "page-notice hidden-block";
    node.textContent = "";
  }

  function getCurrentRelativePath() {
    const path = String(window.location.pathname || "") || routePath("index");
    const search = String(window.location.search || "");
    return `${path}${search}`;
  }

  async function ensureActionAccess(api, options) {
    const opts = options || {};
    const actionLabel = String(opts.actionLabel || "perform this action");
    const nextPath = opts.nextPath || getCurrentRelativePath();
    const requireProfile = opts.requireProfile !== false;
    const checkBan = opts.checkBan !== false;

    const user = await getAuthUser();
    if (!user) {
      return {
        ok: false,
        user: null,
        profile: null,
        displayName: "",
        message: `Please login to ${actionLabel}.`,
        redirect: routePath("auth", `next=${encodeURIComponent(nextPath)}`)
      };
    }

    if (hasSupabaseConfig() && !user.email_confirmed_at) {
      return {
        ok: false,
        user,
        profile: null,
        displayName: "",
        message: "Please verify your email before continuing.",
        redirect: routePath("auth")
      };
    }

    const profile = requireProfile ? await fetchMyProfile() : null;
    const displayName = profile && profile.display_name ? String(profile.display_name) : "";

    if (requireProfile && !displayName) {
      return {
        ok: false,
        user,
        profile,
        displayName: "",
        message: "Set your display name in Profile settings first.",
        redirect: routePath("profile", "setup=1")
      };
    }

    if (checkBan && api && typeof api.isNicknameBanned === "function") {
      const banned = await api.isNicknameBanned(displayName);
      if (banned) {
        return {
          ok: false,
          user,
          profile,
          displayName,
          message: "Your account is currently banned from this action.",
          redirect: routePath("profile")
        };
      }
    }

    return {
      ok: true,
      user,
      profile,
      displayName,
      message: "",
      redirect: ""
    };
  }

  async function initSessionNav() {
    const refreshId = ++navRefreshToken;
    const nav = document.querySelector("nav.main-nav .nav-inner");
    if (!nav) return;

    const loginLink = nav.querySelector('a[data-session-link="account"]')
      || nav.querySelector('a[href="auth.html"]')
      || nav.querySelector('a[href$="/auth/"]');
    if (!loginLink) return;
    loginLink.dataset.sessionLink = "account";

    const user = await getAuthUser();
    if (refreshId !== navRefreshToken) return;
    const isLoggedIn = Boolean(user);
    const logoutNode = nav.querySelector('[data-session-link="logout"]');
    const adminLinks = [...nav.querySelectorAll('a[href="admin.html"], a[href$="/admin/"]')];

    if (!isLoggedIn) {
      loginLink.textContent = "Login";
      loginLink.href = routePath("auth");
      if (logoutNode) logoutNode.remove();
      adminLinks.forEach((link) => link.remove());
      document.body.classList.remove("is-admin");
      return;
    }

    loginLink.textContent = "Account";
    loginLink.href = routePath("auth");

    if (!logoutNode) {
      const logout = document.createElement("a");
      logout.href = "#";
      logout.dataset.sessionLink = "logout";
      logout.textContent = "Logout";
      logout.addEventListener("click", async (event) => {
        event.preventDefault();
        const client = createAuthClient();
        if (client) {
          await client.auth.signOut();
        }
        lastKnownUser = null;
        lastKnownUserAt = 0;
        localStorage.removeItem(SESSION_CHECK_KEY);
        window.location.href = routePath("index");
      });
      nav.appendChild(logout);
    }

    const isAdmin = await hasAdminSession();
    if (refreshId !== navRefreshToken) return;
    document.body.classList.toggle("is-admin", isAdmin);

    let adminLink = nav.querySelector('[data-session-link="admin"]');
    if (isAdmin && !adminLink) {
      adminLink = document.createElement("a");
      adminLink.href = routePath("admin");
      adminLink.dataset.sessionLink = "admin";
      adminLink.className = "admin-only";
      adminLink.textContent = "Admin Panel";
      const discordLink = nav.querySelector("a.discord-btn");
      if (discordLink && discordLink.parentNode === nav) {
        nav.insertBefore(adminLink, discordLink);
      } else {
        nav.appendChild(adminLink);
      }
    }
    if (!isAdmin) {
      adminLinks.forEach((link) => link.remove());
    }
  }

  const ROUTE_SEGMENTS = {
    index: "/",
    auth: "/auth/",
    forum: "/forum/",
    thread: "/thread/",
    releases: "/releases/",
    profile: "/profile/",
    admin: "/admin/",
    faq: "/faq/",
    privacy: "/privacy/",
    terms: "/terms/"
  };

  const FILE_ROUTE_MAP = {
    "index.html": "index",
    "auth.html": "auth",
    "forum.html": "forum",
    "thread.html": "thread",
    "releases.html": "releases",
    "profile.html": "profile",
    "admin.html": "admin",
    "faq.html": "faq",
    "privacy.html": "privacy",
    "terms.html": "terms"
  };

  function detectBasePath() {
    const path = String(window.location.pathname || "");
    const fileNames = Object.keys(FILE_ROUTE_MAP);
    for (const fileName of fileNames) {
      const marker = `/${fileName}`;
      const idx = path.indexOf(marker);
      if (idx >= 0) return path.slice(0, idx);
    }
    for (const segment of Object.values(ROUTE_SEGMENTS)) {
      const idx = path.indexOf(segment);
      if (idx > 0) return path.slice(0, idx);
    }
    if (path === "/") return "";
    if (path.endsWith("/")) return path.slice(0, -1);
    return "";
  }

  const APP_BASE_PATH = detectBasePath();

  function withBase(path) {
    const normalized = String(path || "/").startsWith("/") ? String(path) : `/${String(path)}`;
    if (!APP_BASE_PATH) return normalized;
    if (normalized === "/") return `${APP_BASE_PATH}/`;
    return `${APP_BASE_PATH}${normalized}`;
  }

  function routePath(routeName, queryLike) {
    const segment = ROUTE_SEGMENTS[routeName] || ROUTE_SEGMENTS.index;
    const query = String(queryLike || "").trim();
    if (!query) return withBase(segment);
    const suffix = query.startsWith("?") ? query : `?${query}`;
    return `${withBase(segment)}${suffix}`;
  }

  function threadLink(threadId) {
    return routePath("thread", `id=${encodeURIComponent(String(threadId || ""))}`);
  }

  function toCleanPathAndQuery(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return routePath("index");

    const parsed = new URL(value, window.location.href);
    const pathname = parsed.pathname;
    const search = parsed.search || "";
    const hash = parsed.hash || "";
    const file = pathname.split("/").pop() || "index.html";
    const routeName = FILE_ROUTE_MAP[file];

    if (routeName) return `${routePath(routeName)}${search}${hash}`;
    for (const [name, segment] of Object.entries(ROUTE_SEGMENTS)) {
      if (pathname.endsWith(segment) || pathname.includes(segment)) {
        return `${routePath(name)}${search}${hash}`;
      }
    }
    return `${withBase("/")}${search}${hash}`;
  }

  async function refreshSessionNav() {
    await initSessionNav();
  }

  async function getAuthUser() {
    const client = createAuthClient();
    if (!client) return null;
    
    try {
      const { data, error } = await client.auth.getUser();
      if (!error && data && data.user) {
        identityState.user = data.user;
        sessionVerified = true;
        lastKnownUser = data.user;
        lastKnownUserAt = Date.now();
        localStorage.setItem(SESSION_CHECK_KEY, Date.now().toString());
        return data.user;
      }

      const { data: sessionData } = await client.auth.getSession();
      if (sessionData && sessionData.session && sessionData.session.user) {
        const sessionUser = sessionData.session.user;
        identityState.user = sessionUser;
        sessionVerified = true;
        lastKnownUser = sessionUser;
        lastKnownUserAt = Date.now();
        localStorage.setItem(SESSION_CHECK_KEY, Date.now().toString());
        return sessionUser;
      }

      if (lastKnownUser && Date.now() - lastKnownUserAt < 30000) {
        return lastKnownUser;
      }

      const stored = localStorage.getItem(SESSION_CHECK_KEY);
      if (stored) {
        const storedTime = parseInt(stored, 10);
        if (Date.now() - storedTime < 5000) {
          return null;
        }
      }

      lastKnownUser = null;
      lastKnownUserAt = 0;
      return null;
    } catch (err) {
      console.warn("Auth getUser exception:", err.message);
      if (lastKnownUser && Date.now() - lastKnownUserAt < 30000) {
        return lastKnownUser;
      }
      return null;
    }
  }

  async function getAuthedEmail() {
    const user = await getAuthUser();
    return user ? String(user.email || "").toLowerCase() : "";
  }

  async function hasAdminSession() {
    const client = createAuthClient();
    if (!client) return false;

    const user = await getAuthUser();
    if (!user) return false;

    try {
      const { data, error } = await client.rpc("is_admin");
      if (error) return false;
      return Boolean(data);
    } catch {
      return false;
    }
  }

  async function hasModeratorSession() {
    if (!hasSupabaseConfig()) {
      return isModerator();
    }
    return hasAdminSession();
  }

  async function applyAdminVisibility() {
    const isAdmin = await hasAdminSession();
    document.body.classList.toggle("is-admin", isAdmin);
    return isAdmin;
  }

  function renderPager(target, currentPage, totalPages, onSelect) {
    target.textContent = "";
    if (totalPages <= 1) {
      const note = document.createElement("span");
      note.className = "muted";
      note.textContent = "1 page";
      target.append(note);
      return;
    }

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);

    const makeBtn = (label, page, disabled, isCurrent) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.disabled = disabled;
      if (isCurrent) btn.classList.add("is-current");
      btn.addEventListener("click", () => onSelect(page));
      target.append(btn);
    };

    makeBtn("Prev", Math.max(1, currentPage - 1), currentPage === 1, false);
    for (let page = start; page <= end; page += 1) {
      makeBtn(String(page), page, false, page === currentPage);
    }
    makeBtn("Next", Math.min(totalPages, currentPage + 1), currentPage === totalPages, false);

    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = `Page ${currentPage} of ${totalPages}`;
    target.append(note);
  }

  function updateTopMetrics(posts, comments) {
    const metricThreads = document.getElementById("metricThreads");
    const metricReplies = document.getElementById("metricReplies");
    const metricReleases = document.getElementById("metricReleases");

    if (metricThreads) metricThreads.textContent = String(posts.length);
    if (metricReplies) metricReplies.textContent = String(comments.length);
    if (metricReleases) {
      metricReleases.textContent = String(posts.filter((p) => p.category === "software").length);
    }
  }

  const THEME_STORAGE_KEY = "polly_theme";
  const DARK = "dark";
  const LIGHT = "light";

  function getCurrentTheme() {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === DARK || stored === LIGHT) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT;
  }

  function setTheme(theme) {
    const valid = theme === DARK || theme === LIGHT ? theme : LIGHT;
    document.documentElement.setAttribute("data-theme", valid);
    localStorage.setItem(THEME_STORAGE_KEY, valid);
    updateThemeButton();
    return valid;
  }

  function toggleTheme() {
    const current = getCurrentTheme();
    return setTheme(current === DARK ? LIGHT : DARK);
  }

  const BOOKMARKS_KEY = "polly_bookmarks";

  function getBookmarks() {
    try {
      return new Set(JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }

  function addBookmark(threadId) {
    const bookmarks = getBookmarks();
    bookmarks.add(threadId);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks]));
    return bookmarks.size;
  }

  function removeBookmark(threadId) {
    const bookmarks = getBookmarks();
    bookmarks.delete(threadId);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks]));
    return bookmarks.size;
  }

  function isBookmarked(threadId) {
    return getBookmarks().has(threadId);
  }

  function updateThemeButton() {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const isDark = getCurrentTheme() === DARK;
    btn.textContent = isDark ? "☀️" : "🌙";
    btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  }

  function initThemeToggle() {
    const nav = document.querySelector(".nav-inner");
    if (!nav) return;

    let btn = document.getElementById("themeToggle");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "themeToggle";
      btn.className = "theme-toggle";
      btn.type = "button";
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleTheme();
    });

    if (!btn.parentElement) {
      nav.appendChild(btn);
    }

    setTheme(getCurrentTheme());
  }

  function applyCleanCurrentUrl() {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const clean = toCleanPathAndQuery(current);
    if (clean !== current) {
      window.history.replaceState({}, "", clean);
    }
  }

  window.PollyCommon = {
    SECTION_META,
    escapeHtml,
    formatDate,
    formatRelative,
    toHandle,
    profileLink,
    rankFromScore,
    buildMemberStats,
    createAuthClient,
    hasSupabaseConfig,
    canPerform,
    markPerformed,
    formatWaitMs,
    sanitizeNextPath,
    ensureActionAccess,
    showPageNotice,
    clearPageNotice,
    initSessionNav,
    refreshSessionNav,
    getAuthUser,
    getAuthedEmail,
    fetchMyProfile,
    ensureIdentityLoaded,
    refreshIdentity,
    saveMyDisplayName,
    getRoleByNickname,
    getCurrentRole,
    isModerator,
    hasModeratorSession,
    hasAdminSession,
    applyAdminVisibility,
    getNickname,
    setNickname,
    initIdentityForm,
    normalizeTags,
    getSection,
    renderPager,
    updateTopMetrics,
    initThemeToggle,
    getCurrentTheme,
    setTheme,
    initKeyboardShortcuts,
    routePath,
    threadLink,
    toCleanPathAndQuery,
    parseMarkdown,
    getBookmarks,
    addBookmark,
    removeBookmark,
    isBookmarked,
    initEmojiPickers,
    initMentionAutocomplete
  };

  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      const target = e.target;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "/" && !isInput) {
        e.preventDefault();
        const firstInput = document.querySelector("input[type='search']") || document.querySelector("input:not([type])");
        if (firstInput) {
          firstInput.focus();
        }
      }

      if (e.key === "?" && !isInput) {
        e.preventDefault();
        const help = document.getElementById("shortcutsHelp");
        if (help) {
          help.classList.toggle("hidden-block");
        }
      }

      if (e.key === "Escape") {
        const help = document.getElementById("shortcutsHelp");
        if (help && !help.classList.contains("hidden-block")) {
          help.classList.add("hidden-block");
        }
        if (isInput) {
          target.blur();
        }
      }

      if (e.key === "c" && !isInput && e.altKey) {
        e.preventDefault();
        const composer = document.querySelector("#newThreadForm, #replyForm, .compose-box");
        if (composer) {
          const textarea = composer.querySelector("textarea");
          if (textarea) {
            textarea.focus();
          }
        }
      }

      if (e.key === "n" && !isInput && e.altKey) {
        e.preventDefault();
        window.location.href = routePath("forum", "section=general");
      }

      if (e.key === "h" && !isInput && e.altKey) {
        e.preventDefault();
        window.location.href = routePath("index");
      }
    });
  }

  void applyCleanCurrentUrl();
  void applyAdminVisibility();
  void initSessionNav();
  void initThemeToggle();
  void initKeyboardShortcuts();
  
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void initSessionNav();
      identityState.loaded = false;
    }
  });
})();
