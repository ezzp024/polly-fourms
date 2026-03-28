(async function () {
  const {
    initIdentityForm,
    escapeHtml,
    formatDate,
    renderPager,
    hasModeratorSession,
    ensureActionAccess,
    showPageNotice,
    clearPageNotice,
    profileLink,
    buildMemberStats,
    toHandle,
    canPerform,
    markPerformed,
    formatWaitMs,
    threadLink
  } = window.PollyCommon;
  const api = window.PollyApi.createApi();

  initIdentityForm();

  if (window.PollyCommon && window.PollyCommon.refreshSessionNav) {
    await window.PollyCommon.refreshSessionNav();
  }

  const searchInput = document.getElementById("releaseSearch");
  const releaseSort = document.getElementById("releaseSort");
  const releaseGrid = document.getElementById("releaseGrid");
  const releasePager = document.getElementById("releasePager");

  const PAGE_SIZE = 10;
  let currentPage = 1;

  let posts = [];
  let comments = [];
  let memberStats = new Map();
  let canModerate = false;

  async function safeLog(action, targetType, targetId, details) {
    try {
      await api.createModerationLog(action, targetType, targetId, details || {});
    } catch {
      // ignore logging issues if table not migrated yet
    }
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const countByPost = comments.reduce((map, row) => {
      map.set(row.post_id, (map.get(row.post_id) || 0) + 1);
      return map;
    }, new Map());

    const visible = canModerate ? posts : posts.filter((post) => !post.is_hidden);

    const filtered = visible.filter((post) => {
      const tags = Array.isArray(post.tags) ? post.tags.join(" ") : "";
      const text = `${post.title} ${post.body} ${tags}`.toLowerCase();
      return !query || text.includes(query);
    });

    filtered.sort((a, b) => {
      const pin = (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
      if (pin !== 0) return pin;
      const sticky = (b.is_sticky ? 1 : 0) - (a.is_sticky ? 1 : 0);
      if (sticky !== 0) return sticky;
      if (releaseSort.value === "oldest") return Date.parse(a.created_at) - Date.parse(b.created_at);
      if (releaseSort.value === "replies") return (countByPost.get(b.id) || 0) - (countByPost.get(a.id) || 0);
      if (releaseSort.value === "title") return a.title.localeCompare(b.title);
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    releaseGrid.innerHTML = pageRows.length
      ? pageRows
          .map((post) => {
            const tags = Array.isArray(post.tags) ? post.tags : [];
            const member = memberStats.get(toHandle(post.author_name));
            const rank = member ? member.rank : "Newbie";
            const rankClass = `badge-rank-${rank.toLowerCase()}`;
            const flags = [
              post.is_pinned ? '<span class="badge badge-pin">Pinned</span>' : "",
              post.is_sticky ? '<span class="badge badge-sticky">Sticky</span>' : "",
              post.is_locked ? '<span class="badge badge-hidden">Locked</span>' : "",
              post.is_solved ? '<span class="badge badge-sticky">Solved</span>' : "",
              post.is_hidden ? '<span class="badge badge-hidden">Hidden</span>' : ""
            ].join(" ");
            return `
              <article class="release-card">
                <h3><a href="${threadLink(post.id)}">${escapeHtml(post.title)}</a> ${flags}</h3>
                <p class="post-meta">by <a href="${profileLink(post.author_name)}">${escapeHtml(post.author_name)}</a> <span class="badge ${rankClass}">${rank}</span> - ${formatDate(post.created_at)}</p>
                <p>${escapeHtml(post.body.slice(0, 170))}${post.body.length > 170 ? "..." : ""}</p>
                <div class="tags">${tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
                <p class="post-meta">Replies: ${countByPost.get(post.id) || 0}</p>
                ${post.software_url ? `<p><a href="${escapeHtml(post.software_url)}" target="_blank" rel="noopener noreferrer">Download / Repository</a></p>` : ""}
                <p class="release-actions"><button type="button" data-action="report" data-id="${post.id}">Report</button></p>
                ${canModerate ? `<div class="mod-tools"><button type="button" data-action="pin" data-id="${post.id}" data-state="${post.is_pinned ? "1" : "0"}">${post.is_pinned ? "Unpin" : "Pin"}</button><button type="button" data-action="sticky" data-id="${post.id}" data-state="${post.is_sticky ? "1" : "0"}">${post.is_sticky ? "Unsticky" : "Sticky"}</button><button type="button" data-action="lock" data-id="${post.id}" data-state="${post.is_locked ? "1" : "0"}">${post.is_locked ? "Unlock" : "Lock"}</button><button type="button" data-action="solve" data-id="${post.id}" data-state="${post.is_solved ? "1" : "0"}">${post.is_solved ? "Unsolve" : "Solved"}</button><button type="button" data-action="hide" data-id="${post.id}" data-state="${post.is_hidden ? "1" : "0"}">${post.is_hidden ? "Unhide" : "Hide"}</button><button type="button" data-action="remove-link" data-id="${post.id}">Remove Link</button></div>` : ""}
              </article>
            `;
          })
          .join("")
      : '<p class="muted">No releases found.</p>';

    renderPager(releasePager, currentPage, totalPages, (next) => {
      currentPage = next;
      render();
    });
  }

  try {
    canModerate = await hasModeratorSession();
    if (canModerate) {
      document.body.classList.add("is-moderator");
    }
    [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    memberStats = buildMemberStats(posts, comments);
    posts = posts.filter((p) => p.category === "software");
    render();
  } catch (error) {
    releaseGrid.innerHTML = `<p class="muted">Could not load releases: ${escapeHtml(error.message || String(error))}</p>`;
    return;
  }

  searchInput.addEventListener("input", () => {
    currentPage = 1;
    render();
  });
  releaseSort.addEventListener("change", () => {
    currentPage = 1;
    render();
  });

  releaseGrid.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName !== "BUTTON") return;
    const action = target.getAttribute("data-action");
    const postId = target.getAttribute("data-id");
    if (!action || !postId) return;

    if (canModerate && ["pin", "sticky", "lock", "solve", "hide", "remove-link"].includes(action)) {
      const current = posts.find((p) => p.id === postId);
      if (!current) return;

      try {
        if (action === "pin") {
          await api.updatePost(postId, { is_pinned: !current.is_pinned });
          await safeLog("toggle_pin", "post", postId, { value: !current.is_pinned, view: "releases" });
        }
        if (action === "sticky") {
          await api.updatePost(postId, { is_sticky: !current.is_sticky });
          await safeLog("toggle_sticky", "post", postId, { value: !current.is_sticky, view: "releases" });
        }
        if (action === "lock") {
          await api.updatePost(postId, { is_locked: !current.is_locked });
          await safeLog("toggle_lock", "post", postId, { value: !current.is_locked, view: "releases" });
        }
        if (action === "solve") {
          await api.updatePost(postId, { is_solved: !current.is_solved });
          await safeLog("toggle_solved", "post", postId, { value: !current.is_solved, view: "releases" });
        }
        if (action === "hide") {
          const nextHidden = !current.is_hidden;
          let reason = current.hidden_reason || "";
          if (nextHidden) {
            reason = prompt("Reason for hiding this release thread:", "Needs moderator review") || "Needs moderator review";
          }
          await api.updatePost(postId, { is_hidden: nextHidden, hidden_reason: nextHidden ? reason : "" });
          await safeLog("toggle_hidden", "post", postId, { value: nextHidden, reason, view: "releases" });
        }
        if (action === "remove-link") {
          await api.clearPostLink(postId);
          await safeLog("remove_link", "post", postId, { view: "releases" });
        }

        [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
        memberStats = buildMemberStats(posts, comments);
        posts = posts.filter((p) => p.category === "software");
        render();
      } catch (error) {
        showPageNotice(`Moderation action failed: ${error.message || String(error)}`, "error", 5200);
      }
      return;
    }

    if (action !== "report") return;

    const access = await ensureActionAccess(api, {
      actionLabel: "report this release",
      nextPath: `${window.location.pathname.split("/").pop()}${window.location.search}`,
      requireProfile: true,
      checkBan: true
    });
    if (!access.ok) {
      showPageNotice(access.message, "warning", 4600);
      if (access.redirect) {
        window.location.href = access.redirect;
      }
      return;
    }

    clearPageNotice();

    const nickname = access.displayName;

    const gate = canPerform("create_report", 20000);
    if (!gate.ok) {
      showPageNotice(`Please wait ${formatWaitMs(gate.nextAllowedIn)} before sending another report.`, "warning", 4200);
      return;
    }

    const reason = prompt("Reason for report:", "Spam, abuse, malware, or unsafe link");
    if (!reason || !String(reason).trim()) return;

    try {
      await api.createReport({ post_id: postId, reason, reporter_name: nickname });
      markPerformed("create_report");
      showPageNotice("Report submitted successfully.", "success", 2400);
      target.textContent = "Reported";
      setTimeout(() => {
        target.textContent = "Report";
      }, 1300);
    } catch (error) {
      showPageNotice(`Could not submit report: ${error.message || String(error)}`, "error", 5200);
    }
  });
})();
