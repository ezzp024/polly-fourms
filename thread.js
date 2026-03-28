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
    ensureActionAccess,
    showPageNotice,
    clearPageNotice,
    normalizeTags,
    canPerform,
    markPerformed,
    formatWaitMs,
    isBookmarked,
    addBookmark,
    removeBookmark
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
  const shareThread = document.getElementById("shareThread");
  const bookmarkThread = document.getElementById("bookmarkThread");
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
  let cachedComments = [];
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

    const replyBox = replyForm.querySelector("textarea[name='body']");
    const replyBtn = replyForm.querySelector("button[type='submit']");
    if (replyBox && replyBtn) {
      const canReply = Boolean(currentUser) && Boolean(!post.is_locked || canModerate);
      replyBox.disabled = !canReply;
      replyBtn.disabled = !canReply;
      replyBox.placeholder = canReply
        ? "Write your reply"
        : post.is_locked
          ? "Thread is locked"
          : "Login and set profile to reply";
    }

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

    cachedComments = allComments.filter((item) => item.post_id === id);
    commentsList.innerHTML = cachedComments.length
      ? cachedComments
          .map(
            (comment) => `
              <article class="comment-item">
                <strong><a href="${profileLink(comment.author_name)}">${escapeHtml(comment.author_name)}</a></strong> <small class="muted">${formatDate(comment.created_at)}</small>
                <p>${escapeHtml(comment.body)}</p>
                ${(canModerate || (currentUser && comment.author_user_id && comment.author_user_id === currentUser.id)) ? `<p><button type="button" data-action="edit-comment" data-id="${comment.id}" data-owner="${comment.author_user_id || ""}">Edit</button> <button type="button" data-action="delete-comment" data-id="${comment.id}" data-owner="${comment.author_user_id || ""}">Delete</button></p>` : ""}
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
    const access = await ensureActionAccess(api, {
      actionLabel: "reply to this thread",
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

    if (cachedPost && cachedPost.is_locked && !canModerate) {
      showPageNotice("This thread is locked.", "warning", 4200);
      return;
    }

    const gate = canPerform("create_comment", 8000);
    if (!gate.ok) {
      showPageNotice(`Please wait ${formatWaitMs(gate.nextAllowedIn)} before replying again.`, "warning", 4200);
      return;
    }

    const form = new FormData(replyForm);
    const body = String(form.get("body") || "").trim();
    if (!body) return;

    try {
      await api.createComment({ post_id: id, author_name: nickname, body });
      markPerformed("create_comment");
      replyForm.reset();
      showPageNotice("Reply posted successfully.", "success", 2200);
      await load();
    } catch (error) {
      showPageNotice(`Could not submit reply: ${error.message || String(error)}`, "error", 5200);
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
      showPageNotice("Could not copy link. Please copy URL from address bar.", "warning", 4200);
    }
  });

  if (shareThread) {
    shareThread.addEventListener("click", async () => {
      if (!cachedPost) return;
      const shareData = {
        title: cachedPost.title || "Polly Fourms Thread",
        text: "Check out this thread on Polly Fourms",
        url: window.location.href
      };
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
        } catch (err) {
          if (err.name !== "AbortError") {
            showPageNotice("Could not share. Copy link instead.", "warning", 3000);
          }
        }
      } else {
        try {
          await navigator.clipboard.writeText(window.location.href);
          showPageNotice("Link copied to clipboard!", "success", 2000);
        } catch {
          showPageNotice("Could not copy link.", "warning", 3000);
        }
      }
    });
  }

  if (bookmarkThread && cachedPost && cachedPost.id) {
    const isSaved = isBookmarked(cachedPost.id);
    bookmarkThread.textContent = isSaved ? "Remove Bookmark" : "Bookmark";
  }

  bookmarkThread.addEventListener("click", () => {
    if (!cachedPost || !cachedPost.id) return;
    const saved = isBookmarked(cachedPost.id);
    if (saved) {
      removeBookmark(cachedPost.id);
      bookmarkThread.textContent = "Bookmark";
      showPageNotice("Bookmark removed.", "success", 2000);
    } else {
      addBookmark(cachedPost.id);
      bookmarkThread.textContent = "Remove Bookmark";
      showPageNotice("Thread bookmarked.", "success", 2000);
    }
  });

  reportThread.addEventListener("click", async () => {
    if (!cachedPost) return;
    const access = await ensureActionAccess(api, {
      actionLabel: "report this thread",
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
      await api.createReport({ post_id: cachedPost.id, reason, reporter_name: nickname });
      markPerformed("create_report");
      showPageNotice("Report submitted successfully.", "success", 2200);
      reportThread.textContent = "Reported";
      setTimeout(() => {
        reportThread.textContent = "Report Thread";
      }, 1400);
    } catch (error) {
      showPageNotice(`Could not submit report: ${error.message || String(error)}`, "error", 5200);
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
      showPageNotice(`Moderation action failed: ${error.message || String(error)}`, "error", 5200);
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
    const isOwner = Boolean(currentUser && cachedPost.author_user_id && currentUser.id === cachedPost.author_user_id);
    if (!isOwner && !canModerate) {
      showPageNotice("You do not have permission to edit this thread.", "warning", 4200);
      return;
    }
    const title = prompt("Edit title", cachedPost.title);
    if (!title || !title.trim()) return;
    const body = prompt("Edit body", cachedPost.body);
    if (!body || !body.trim()) return;
    const tags = prompt("Edit tags (comma separated)", Array.isArray(cachedPost.tags) ? cachedPost.tags.join(", ") : "");

    try {
      await api.updatePost(cachedPost.id, {
        title: title.trim().slice(0, 120),
        body: body.trim().slice(0, 4000),
        tags: normalizeTags(String(tags || ""))
      });
      await safeLog("edit_thread", "post", cachedPost.id, { title: title.trim().slice(0, 120) });
      showPageNotice("Thread updated.", "success", 2200);
      await load();
    } catch (error) {
      showPageNotice(`Could not edit thread: ${error.message || String(error)}`, "error", 5200);
    }
  });

  deleteThread.addEventListener("click", async () => {
    if (!cachedPost) return;
    const isOwner = Boolean(currentUser && cachedPost.author_user_id && currentUser.id === cachedPost.author_user_id);
    if (!isOwner && !canModerate) {
      showPageNotice("You do not have permission to delete this thread.", "warning", 4200);
      return;
    }
    if (!confirm("Delete this thread permanently?")) return;
    try {
      await api.deletePost(cachedPost.id);
      await safeLog("delete_thread", "post", cachedPost.id, {});
      window.location.href = `forum.html?section=${encodeURIComponent(cachedPost.category || "general")}`;
    } catch (error) {
      showPageNotice(`Could not delete thread: ${error.message || String(error)}`, "error", 5200);
    }
  });

  commentsList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName !== "BUTTON") return;
    const action = target.getAttribute("data-action");
    const commentId = target.getAttribute("data-id");
    const commentOwner = target.getAttribute("data-owner") || "";
    if (!commentId) return;

    const canDelete = canModerate || Boolean(currentUser && commentOwner && currentUser.id === commentOwner);
    if (!canDelete) {
      showPageNotice("You do not have permission to modify this comment.", "warning", 4200);
      return;
    }

    const commentExists = cachedComments.some((comment) => comment.id === commentId);
    if (!commentExists) return;

    if (action === "edit-comment") {
      const current = cachedComments.find((comment) => comment.id === commentId);
      if (!current) return;
      const nextBody = prompt("Edit comment", current.body);
      if (!nextBody || !nextBody.trim()) return;

      try {
        await api.updateComment(commentId, nextBody.trim().slice(0, 500));
        await safeLog("edit_comment", "comment", commentId, {});
        showPageNotice("Comment updated.", "success", 2200);
        await load();
      } catch (error) {
        showPageNotice(`Could not edit comment: ${error.message || String(error)}`, "error", 5200);
      }
      return;
    }

    if (action !== "delete-comment") return;

    if (!confirm("Delete this comment?")) return;

    try {
      await api.deleteComment(commentId);
      await safeLog("delete_comment", "comment", commentId, {});
      showPageNotice("Comment deleted.", "success", 2200);
      await load();
    } catch (error) {
      showPageNotice(`Could not delete comment: ${error.message || String(error)}`, "error", 5200);
    }
  });
})();
