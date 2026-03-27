(async function () {
  const {
    initIdentityForm,
    getNickname,
    getSection,
    escapeHtml,
    formatDate,
    isModerator,
    buildMemberStats,
    toHandle,
    profileLink
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
  const togglePin = document.getElementById("togglePin");
  const toggleSticky = document.getElementById("toggleSticky");
  const toggleHide = document.getElementById("toggleHide");

  let cachedPost = null;
  const canModerate = isModerator();
  if (canModerate) {
    document.body.classList.add("is-moderator");
  }

  if (!id) {
    threadTitle.textContent = "Thread not found";
    threadPost.innerHTML = '<p class="muted">Missing thread id in URL.</p>';
    replyForm.style.display = "none";
    return;
  }

  async function load() {
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
      post.is_hidden ? '<span class="badge badge-hidden">Hidden</span>' : ""
    ].join(" ");

    togglePin.textContent = post.is_pinned ? "Unpin" : "Pin";
    toggleSticky.textContent = post.is_sticky ? "Unsticky" : "Sticky";
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
    await load();
  } catch (error) {
    threadPost.innerHTML = `<p class="muted">Could not load thread: ${escapeHtml(error.message || String(error))}</p>`;
    replyForm.style.display = "none";
    return;
  }

  replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = getNickname();
    if (!nickname) {
      alert("Set your nickname first in the top bar.");
      return;
    }

    const form = new FormData(replyForm);
    const body = String(form.get("body") || "").trim();
    if (!body) return;

    try {
      await api.createComment({ post_id: id, author_name: nickname, body });
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
    const nickname = getNickname();
    if (!nickname) {
      alert("Set your nickname first in the top bar.");
      return;
    }

    const reason = prompt("Reason for report:", "Spam, abuse, malware, or unsafe link");
    if (!reason) return;

    try {
      await api.createReport({ post_id: cachedPost.id, reason, reporter_name: nickname });
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
      }
      if (action === "sticky") {
        await api.updatePost(cachedPost.id, { is_sticky: !cachedPost.is_sticky });
      }
      if (action === "hide") {
        const nextHidden = !cachedPost.is_hidden;
        let reason = cachedPost.hidden_reason || "";
        if (nextHidden) {
          reason = prompt("Reason for hiding this thread:", "Needs moderator review") || "Needs moderator review";
        }
        await api.updatePost(cachedPost.id, { is_hidden: nextHidden, hidden_reason: nextHidden ? reason : "" });
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
})();
