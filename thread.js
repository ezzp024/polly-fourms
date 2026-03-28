(async function () {
  const {
    initIdentityForm,
    getSection,
    escapeHtml,
    formatDate,
    hasModeratorSession,
    buildMemberStats,
    toHandle,
    profileLink,
    normalizeTags,
    canPerform,
    markPerformed,
    formatWaitMs
  } = window.PollyCommon;
  const api = window.PollyApi.createApi();

  initIdentityForm();

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  const breadcrumb = document.getElementById("breadcrumb");
  const threadTitle = document.getElementById("threadTitle");
  const threadPost = document.getElementById("threadPost");
  const commentsList = document.getElementById("commentsList");
  const replyForm = document.getElementById("replyForm");
  const backToSection = document.getElementById("backToSection");
  const relatedThreads = document.getElementById("relatedThreads");
  const quoteReply = document.getElementById("quoteReply");
  const copyThreadLink = document.getElementById("copyThreadLink");
  const reportThread = document.getElementById("reportThread");
  const editThread = document.getElementById("editThread");
  const deleteThread = document.getElementById("deleteThread");
  const togglePin = document.getElementById("togglePin");
  const toggleSticky = document.getElementById("toggleSticky");
  const toggleLock = document.getElementById("toggleLock");
  const toggleSolved = document.getElementById("toggleSolved");
  const toggleHide = document.getElementById("toggleHide");

  let cachedPost = null;
  let currentUser = null;
  let canModerate = false;

  async function safeLog(action, targetType, targetId, details) {
    try {
      await api.createModerationLog(action, targetType, targetId, details || {});
    } catch {
      // ignore logging issues if table not migrated yet
    }
  }

  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

  if (!id || !isUuid(id)) {
    threadTitle.textContent = "Thread not found";
    threadPost.innerHTML = '<p class="muted">Invalid or missing thread id in URL.</p>';
    replyForm.style.display = "none";
    return;
  }

  async function load() {
    currentUser = await window.PollyCommon.getAuthUser();
    const [post, allPostsRaw, allComments] = await Promise.all([api.getPostById(id), api.getPosts(), api.getComments()]);
    if (!post) {
      threadTitle.textContent = "Thread not found";
      threadPost.innerHTML = '<p class="muted">This thread does not exist.</p>';
      replyForm.style.display = "none";
      return;
    }

    cachedPost = post;
    const allPosts = canModerate ? allPostsRaw : allPostsRaw.filter((item) => !item.is_hidden);
    if (post.is_hidden && !canModerate) {
      threadTitle.textContent = "Thread is hidden";
      threadPost.innerHTML = '<p class="muted">This thread is currently hidden by moderators.</p>';
      commentsList.innerHTML = "";
      replyForm.style.display = "none";
      return;
    }

    const memberStats = buildMemberStats(allPostsRaw, allComments);

    const section = getSection(post.category);
    breadcrumb.textContent = `Forum Index > ${section.name} > ${post.title}`;
    backToSection.href = `forum.html?section=${section.key}`;
    threadTitle.textContent = post.title;

    const tags = Array.isArray(post.tags) ? post.tags : [];
    const member = memberStats.get(toHandle(post.author_name));
    const rank = member ? member.rank : "Newbie";
    const rankClass = `badge-rank-${rank.toLowerCase()}`;
    const modBadges = [
      post.is_pinned ? '<span class="badge badge-pin">Pinned</span>' : "",
      post.is_sticky ? '<span class="badge badge-sticky">Sticky</span>' : "",
      post.is_locked ? '<span class="badge badge-hidden">Locked</span>' : "",
      post.is_solved ? '<span class="badge badge-sticky">Solved</span>' : "",
      post.is_hidden ? '<span class="badge badge-hidden">Hidden</span>' : ""
    ].join(" ");

    const isOwner = Boolean(currentUser && post.author_user_id && currentUser.id === post.author_user_id);
    document.body.classList.toggle("is-owner", isOwner);

    togglePin.textContent = post.is_pinned ? "Unpin" : "Pin";
    toggleSticky.textContent = post.is_sticky ? "Unsticky" : "Sticky";
    toggleLock.textContent = post.is_locked ? "Unlock" : "Lock";
    toggleSolved.textContent = post.is_solved ? "Unsolve" : "Solved";
    toggleHide.textContent = post.is_hidden ? "Unhide" : "Hide";

    threadPost.innerHTML = `
      <h2>${escapeHtml(post.title)} ${modBadges}</h2>
      <p class="post-meta">Posted by <a href="${profileLink(post.author_name)}">${escapeHtml(post.author_name)}</a> <span class="badge ${rankClass}">${rank}</span> - ${formatDate(post.created_at)}</p>
      <p>${escapeHtml(post.body)}</p>
      ${post.software_url ? `<p><a href="${escapeHtml(post.software_url)}" target="_blank" rel="noopener noreferrer">Open download / repo link</a></p>` : ""}
      <div class="tags">${tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
    `;

    const comments = allComments.filter((item) => item.post_id === id);
    commentsList.innerHTML = comments.length
      ? comments
          .map(
            (comment) => `
              <article class="comment-item">
                <strong><a href="${profileLink(comment.author_name)}">${escapeHtml(comment.author_name)}</a></strong> <small class="muted">${formatDate(comment.created_at)}</small>
                <p>${escapeHtml(comment.body)}</p>
                ${(canModerate || (currentUser && comment.author_user_id && comment.author_user_id === currentUser.id)) ? `<p><button type="button" data-action="delete-comment" data-id="${comment.id}">Delete Comment</button></p>` : ""}
              </article>
            `
          )
          .join("")
      : '<p class="muted">No replies yet.</p>';

    const related = allPosts
      .filter((item) => item.id !== post.id && item.category === post.category)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 6);

    relatedThreads.innerHTML = related.length
      ? related
          .map(
            (item) => `
              <article class="stack-item">
                <strong><a href="thread.html?id=${item.id}">${escapeHtml(item.title)}</a></strong>
                <small>${formatDate(item.created_at)}</small>
              </article>
            `
          )
          .join("")
      : '<p class="muted">No related threads yet.</p>';
  }

  try {
    canModerate = await hasModeratorSession();
    if (canModerate) {
      document.body.classList.add("is-moderator");
    }
    await load();
  } catch (error) {
    threadPost.innerHTML = `<p class="muted">Could not load thread: ${escapeHtml(error.message || String(error))}</p>`;
    replyForm.style.display = "none";
    return;
  }

  replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = await window.PollyCommon.getAuthUser();
    if (!user) {
      alert("Please login first.");
      window.location.href = `auth.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }

    const profile = await window.PollyCommon.fetchMyProfile();
    if (!profile || !profile.display_name) {
      alert("Set your display name in Profile settings first.");
      window.location.href = "profile.html?setup=1";
      return;
    }

    const nickname = profile.display_name;

    if (cachedPost && cachedPost.is_locked && !canModerate) {
      alert("This thread is locked.");
      return;
    }

    const gate = canPerform("create_comment", 8000);
    if (!gate.ok) {
      alert(`Please wait ${formatWaitMs(gate.nextAllowedIn)} before replying again.`);
      return;
    }

    if (await api.isNicknameBanned(nickname)) {
      alert("Your account is currently banned from replying.");
      return;
    }

    const form = new FormData(replyForm);
    const body = String(form.get("body") || "").trim();
    if (!body) return;

    try {
      await api.createComment({ post_id: id, author_name: nickname, body });
      markPerformed("create_comment");
      replyForm.reset();
      await load();
    } catch (error) {
      alert(`Could not submit reply: ${error.message || String(error)}`);
    }
  });

  quoteReply.addEventListener("click", () => {
    const textArea = replyForm.querySelector("textarea[name='body']");
    if (!cachedPost || !textArea) return;
    const quote = `> ${cachedPost.author_name} wrote:\n> ${cachedPost.body.replace(/\n/g, "\n> ")}\n\n`;
    textArea.value = `${quote}${textArea.value}`;
    textArea.focus();
  });

  copyThreadLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyThreadLink.textContent = "Copied";
      setTimeout(() => {
        copyThreadLink.textContent = "Copy Thread Link";
      }, 1200);
    } catch {
      alert("Could not copy link. Please copy URL from address bar.");
    }
  });

  reportThread.addEventListener("click", async () => {
    if (!cachedPost) return;
    const user = await window.PollyCommon.getAuthUser();
    if (!user) {
      alert("Please login first.");
      window.location.href = `auth.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }

    const profile = await window.PollyCommon.fetchMyProfile();
    if (!profile || !profile.display_name) {
      alert("Set your display name in Profile settings first.");
      window.location.href = "profile.html?setup=1";
      return;
    }

    const nickname = profile.display_name;

    const gate = canPerform("create_report", 20000);
    if (!gate.ok) {
      alert(`Please wait ${formatWaitMs(gate.nextAllowedIn)} before sending another report.`);
      return;
    }

    if (await api.isNicknameBanned(nickname)) {
      alert("Your account is currently banned from reporting.");
      return;
    }

    const reason = prompt("Reason for report:", "Spam, abuse, malware, or unsafe link");
    if (!reason) return;

    try {
      await api.createReport({ post_id: cachedPost.id, reason, reporter_name: nickname });
      markPerformed("create_report");
      reportThread.textContent = "Reported";
      setTimeout(() => {
        reportThread.textContent = "Report Thread";
      }, 1400);
    } catch (error) {
      alert(`Could not submit report: ${error.message || String(error)}`);
    }
  });

  async function moderate(action) {
    if (!canModerate || !cachedPost) return;
    try {
      if (action === "pin") {
        await api.updatePost(cachedPost.id, { is_pinned: !cachedPost.is_pinned });
        await safeLog("toggle_pin", "post", cachedPost.id, { value: !cachedPost.is_pinned });
      }
      if (action === "sticky") {
        await api.updatePost(cachedPost.id, { is_sticky: !cachedPost.is_sticky });
        await safeLog("toggle_sticky", "post", cachedPost.id, { value: !cachedPost.is_sticky });
      }
      if (action === "lock") {
        await api.updatePost(cachedPost.id, { is_locked: !cachedPost.is_locked });
        await safeLog("toggle_lock", "post", cachedPost.id, { value: !cachedPost.is_locked });
      }
      if (action === "solved") {
        await api.updatePost(cachedPost.id, { is_solved: !cachedPost.is_solved });
        await safeLog("toggle_solved", "post", cachedPost.id, { value: !cachedPost.is_solved });
      }
      if (action === "hide") {
        const nextHidden = !cachedPost.is_hidden;
        let reason = cachedPost.hidden_reason || "";
        if (nextHidden) {
          reason = prompt("Reason for hiding this thread:", "Needs moderator review") || "Needs moderator review";
        }
        await api.updatePost(cachedPost.id, { is_hidden: nextHidden, hidden_reason: nextHidden ? reason : "" });
        await safeLog("toggle_hidden", "post", cachedPost.id, { value: nextHidden, reason });
      }
      await load();
    } catch (error) {
      alert(`Moderation action failed: ${error.message || String(error)}`);
    }
  }

  togglePin.addEventListener("click", () => {
    void moderate("pin");
  });
  toggleSticky.addEventListener("click", () => {
    void moderate("sticky");
  });
  toggleHide.addEventListener("click", () => {
    void moderate("hide");
  });
  toggleLock.addEventListener("click", () => {
    void moderate("lock");
  });
  toggleSolved.addEventListener("click", () => {
    void moderate("solved");
  });

  editThread.addEventListener("click", async () => {
    if (!cachedPost) return;
    const title = prompt("Edit title", cachedPost.title);
    if (!title) return;
    const body = prompt("Edit body", cachedPost.body);
    if (!body) return;
    const tags = prompt("Edit tags (comma separated)", Array.isArray(cachedPost.tags) ? cachedPost.tags.join(", ") : "");

    try {
      await api.updatePost(cachedPost.id, {
        title: title.trim().slice(0, 120),
        body: body.trim(),
        tags: normalizeTags(String(tags || ""))
      });
      await safeLog("edit_thread", "post", cachedPost.id, { title: title.trim().slice(0, 120) });
      await load();
    } catch (error) {
      alert(`Could not edit thread: ${error.message || String(error)}`);
    }
  });

  deleteThread.addEventListener("click", async () => {
    if (!cachedPost) return;
    if (!confirm("Delete this thread permanently?")) return;
    try {
      await api.deletePost(cachedPost.id);
      await safeLog("delete_thread", "post", cachedPost.id, {});
      window.location.href = `forum.html?section=${encodeURIComponent(cachedPost.category || "general")}`;
    } catch (error) {
      alert(`Could not delete thread: ${error.message || String(error)}`);
    }
  });

  commentsList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName !== "BUTTON") return;
    const action = target.getAttribute("data-action");
    const commentId = target.getAttribute("data-id");
    if (action !== "delete-comment" || !commentId) return;
    if (!confirm("Delete this comment?")) return;

    try {
      await api.deleteComment(commentId);
      await safeLog("delete_comment", "comment", commentId, {});
      await load();
    } catch (error) {
      alert(`Could not delete comment: ${error.message || String(error)}`);
    }
  });
})();
