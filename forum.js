(async function () {
  const {
    SECTION_META,
    getSection,
    initIdentityForm,
    normalizeTags,
    escapeHtml,
    formatDate,
    formatRelative,
    renderPager,
    updateTopMetrics,
    hasModeratorSession,
    ensureActionAccess,
    showPageNotice,
    clearPageNotice,
    buildMemberStats,
    profileLink,
    toHandle,
    canPerform,
    markPerformed,
    formatWaitMs
  } = window.PollyCommon;

  const api = window.PollyApi.createApi();

  initIdentityForm();

  if (window.PollyCommon && window.PollyCommon.refreshSessionNav) {
    await window.PollyCommon.refreshSessionNav();
  }

  if (window.PollyCommon.initEmojiPickers) {
    window.PollyCommon.initEmojiPickers();
  }

  if (window.PollyCommon.initMentionAutocomplete) {
    window.PollyCommon.initMentionAutocomplete(api);
  }

  const params = new URLSearchParams(window.location.search);
  const sectionKey = params.get("section") || "general";
  const section = getSection(sectionKey);

  const sectionTitle = document.getElementById("sectionTitle");
  const sectionDescription = document.getElementById("sectionDescription");
  const breadcrumb = document.getElementById("breadcrumb");
  const threadRows = document.getElementById("threadRows");
  const searchInput = document.getElementById("threadSearch");
  const sortBy = document.getElementById("sortBy");
  const newThreadForm = document.getElementById("newThreadForm");
  const threadPager = document.getElementById("threadPager");
  const sectionTabs = document.getElementById("sectionTabs");

  const PAGE_SIZE = 15;
  let currentPage = 1;

  sectionTitle.textContent = section.name;
  sectionDescription.textContent = section.description;
  breadcrumb.textContent = `Forum Index > ${section.name}`;

  sectionTabs.innerHTML = Object.values(SECTION_META)
    .map((entry) => {
      const isActive = entry.key === section.key ? "is-active" : "";
      return `<a class="section-tab ${isActive}" href="forum.html?section=${entry.key}">${escapeHtml(entry.name)}</a>`;
    })
    .join("");

  let posts = [];
  let comments = [];
  let memberStats = new Map();
  let canPost = false;

  async function safeLog(action, targetType, targetId, details) {
    try {
      await api.createModerationLog(action, targetType, targetId, details || {});
    } catch {
      // ignore logging issues if table not migrated yet
    }
  }

  function setComposerEnabled(enabled, message) {
    canPost = enabled;
    const controls = newThreadForm.querySelectorAll("input, textarea, button");
    controls.forEach((node) => {
      node.disabled = !enabled;
    });
    newThreadForm.setAttribute("data-status", message || "");
    const old = newThreadForm.querySelector(".muted");
    if (old) old.remove();
    if (message) {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = message;
      newThreadForm.append(note);
    }
  }

  async function refreshComposerState() {
    const user = await window.PollyCommon.getAuthUser();
    if (!user) {
      setComposerEnabled(false, "Login required to create a thread.");
      return;
    }

    const profile = await window.PollyCommon.fetchMyProfile();
    if (!profile || !profile.display_name) {
      setComposerEnabled(false, "Set your display name in Profile settings first.");
      return;
    }

    setComposerEnabled(true, "");
  }

  let canModerate = false;

  function renderRows() {
    const query = searchInput.value.trim().toLowerCase();
    const commentsByPost = comments.reduce((map, row) => {
      const total = map.get(row.post_id) || 0;
      map.set(row.post_id, total + 1);
      return map;
    }, new Map());

    const lastActivityByPost = comments.reduce((map, row) => {
      const existing = map.get(row.post_id);
      if (!existing || Date.parse(row.created_at) > Date.parse(existing)) {
        map.set(row.post_id, row.created_at);
      }
      return map;
    }, new Map());

    const visiblePosts = canModerate ? posts : posts.filter((post) => !post.is_hidden);

    const filtered = visiblePosts.filter((post) => {
      if (!query) return true;
      const tags = Array.isArray(post.tags) ? post.tags.join(" ") : "";
      return `${post.title} ${post.body} ${tags}`.toLowerCase().includes(query);
    });

    filtered.sort((a, b) => {
      const pin = (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
      if (pin !== 0) return pin;
      const sticky = (b.is_sticky ? 1 : 0) - (a.is_sticky ? 1 : 0);
      if (sticky !== 0) return sticky;
      if (sortBy.value === "oldest") return Date.parse(a.created_at) - Date.parse(b.created_at);
      if (sortBy.value === "replies") return (commentsByPost.get(b.id) || 0) - (commentsByPost.get(a.id) || 0);
      if (sortBy.value === "title") return a.title.localeCompare(b.title);
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    threadRows.innerHTML = pageRows.length
      ? pageRows
          .map((post) => {
            const replies = commentsByPost.get(post.id) || 0;
            const lastActivityAt = lastActivityByPost.get(post.id) || post.created_at;
            const member = memberStats.get(toHandle(post.author_name));
            const rank = member ? member.rank : "Newbie";
            const rankClass = `badge-rank-${rank.toLowerCase()}`;
            const titleBadges = [
              post.is_pinned ? '<span class="badge badge-pin">Pinned</span>' : "",
              post.is_sticky ? '<span class="badge badge-sticky">Sticky</span>' : "",
              post.is_locked ? '<span class="badge badge-hidden">Locked</span>' : "",
              post.is_solved ? '<span class="badge badge-sticky">Solved</span>' : "",
              post.is_hidden ? '<span class="badge badge-hidden">Hidden</span>' : ""
            ].join(" ");

            return `
              <tr>
                <td>
                  <div class="thread-row-title">
                    <div class="thread-title-row"><strong><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></strong>${titleBadges}</div>
                    <small>${escapeHtml(post.body.slice(0, 110))}${post.body.length > 110 ? "..." : ""}</small>
                    ${canModerate ? `<div class="mod-tools"><button type="button" data-post="${post.id}" data-action="pin">${post.is_pinned ? "Unpin" : "Pin"}</button><button type="button" data-post="${post.id}" data-action="sticky">${post.is_sticky ? "Unsticky" : "Sticky"}</button><button type="button" data-post="${post.id}" data-action="lock">${post.is_locked ? "Unlock" : "Lock"}</button><button type="button" data-post="${post.id}" data-action="solve">${post.is_solved ? "Unsolve" : "Solved"}</button><button type="button" data-post="${post.id}" data-action="hide">${post.is_hidden ? "Unhide" : "Hide"}</button></div>` : ""}
                  </div>
                </td>
                <td><a href="${profileLink(post.author_name)}">${escapeHtml(post.author_name)}</a> <span class="badge ${rankClass}">${rank}</span></td>
                <td><span class="stat-pill">${replies}</span></td>
                <td>${formatDate(lastActivityAt)} <span class="muted">(${formatRelative(lastActivityAt)})</span></td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="4" class="muted">No threads in this section yet.</td></tr>';

    renderPager(threadPager, currentPage, totalPages, (next) => {
      currentPage = next;
      renderRows();
    });
  }

  try {
    canModerate = await hasModeratorSession();
    if (canModerate) {
      document.body.classList.add("is-moderator");
    }
    [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    await refreshComposerState();
    memberStats = buildMemberStats(posts, comments);
    updateTopMetrics(posts, comments);
    posts = posts.filter((p) => p.category === section.key);
    renderRows();
  } catch (error) {
    threadRows.innerHTML = `<tr><td colspan="4" class="muted">Could not load section: ${escapeHtml(error.message || String(error))}</td></tr>`;
    setComposerEnabled(false, "Could not load account state.");
  }

  searchInput.addEventListener("input", () => {
    currentPage = 1;
    renderRows();
  });
  sortBy.addEventListener("change", () => {
    currentPage = 1;
    renderRows();
  });

  newThreadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = newThreadForm.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating...";
    }

    const access = await ensureActionAccess(api, {
      actionLabel: "create a thread",
      nextPath: `forum.html?section=${section.key}`,
      requireProfile: true,
      checkBan: true
    });
    if (!access.ok) {
      showPageNotice(access.message, "warning", 4600);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      if (access.redirect) {
        window.location.href = access.redirect;
      }
      return;
    }

    clearPageNotice();

    const nickname = access.displayName;

    if (!canPost) {
      showPageNotice("Posting is currently unavailable. Check account/profile status.", "warning", 4600);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    const form = new FormData(newThreadForm);
    const title = String(form.get("title") || "").trim();
    const body = String(form.get("body") || "").trim();
    const softwareUrl = String(form.get("softwareUrl") || "").trim();
    const tags = normalizeTags(String(form.get("tags") || ""));

    if (!title || !body) {
      showPageNotice("Title and body are required.", "warning", 3200);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    const gate = canPerform("create_thread", 15000);
    if (!gate.ok) {
      showPageNotice(`Please wait ${formatWaitMs(gate.nextAllowedIn)} before creating another thread.`, "warning", 4200);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    try {
      await api.createPost({
        title,
        body,
        category: section.key,
        software_url: softwareUrl,
        tags,
        author_name: nickname
      });
      markPerformed("create_thread");
      newThreadForm.reset();
      showPageNotice("Thread created successfully.", "success", 2500);
      currentPage = 1;
      [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
      memberStats = buildMemberStats(posts, comments);
      updateTopMetrics(posts, comments);
      posts = posts.filter((p) => p.category === section.key);
      renderRows();
    } catch (error) {
      showPageNotice(`Could not create thread: ${error.message || String(error)}`, "error", 5200);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  });

  threadRows.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName !== "BUTTON" || !canModerate) return;
    const postId = target.getAttribute("data-post");
    const action = target.getAttribute("data-action");
    if (!postId || !action) return;

    const current = posts.find((p) => p.id === postId);
    if (!current) return;

    try {
      if (action === "pin") {
        await api.updatePost(postId, { is_pinned: !current.is_pinned });
        await safeLog("toggle_pin", "post", postId, { value: !current.is_pinned, view: "forum" });
      }
      if (action === "sticky") {
        await api.updatePost(postId, { is_sticky: !current.is_sticky });
        await safeLog("toggle_sticky", "post", postId, { value: !current.is_sticky, view: "forum" });
      }
      if (action === "lock") {
        await api.updatePost(postId, { is_locked: !current.is_locked });
        await safeLog("toggle_lock", "post", postId, { value: !current.is_locked, view: "forum" });
      }
      if (action === "solve") {
        await api.updatePost(postId, { is_solved: !current.is_solved });
        await safeLog("toggle_solved", "post", postId, { value: !current.is_solved, view: "forum" });
      }
      if (action === "hide") {
        const nextHidden = !current.is_hidden;
        let reason = current.hidden_reason || "";
        if (nextHidden) {
          reason = prompt("Reason for hiding this thread:", "Needs moderator review") || "Needs moderator review";
        }
        await api.updatePost(postId, { is_hidden: nextHidden, hidden_reason: nextHidden ? reason : "" });
        await safeLog("toggle_hidden", "post", postId, { value: nextHidden, reason, view: "forum" });
      }

      [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
      memberStats = buildMemberStats(posts, comments);
      updateTopMetrics(posts, comments);
      posts = posts.filter((p) => p.category === section.key);
      renderRows();
    } catch (error) {
      showPageNotice(`Moderation action failed: ${error.message || String(error)}`, "error", 5200);
    }
  });
})();
