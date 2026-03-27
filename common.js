(function () {
  const CONFIG = window.POLLY_CONFIG || {};

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
    return localStorage.getItem("polly_nickname") || "";
  }

  function setNickname(value) {
    localStorage.setItem("polly_nickname", value);
  }

  function initIdentityForm() {
    const form = document.getElementById("identityForm");
    const input = document.getElementById("nickname");
    if (!form || !input) return;

    input.value = getNickname();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim().slice(0, 24);
      if (!value) return;
      setNickname(value);
      input.value = value;
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
    return `profile.html?user=${handle}`;
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

  window.PollyCommon = {
    SECTION_META,
    escapeHtml,
    formatDate,
    formatRelative,
    toHandle,
    profileLink,
    rankFromScore,
    buildMemberStats,
    getRoleByNickname,
    getCurrentRole,
    isModerator,
    getNickname,
    setNickname,
    initIdentityForm,
    normalizeTags,
    getSection,
    renderPager,
    updateTopMetrics
  };
})();
