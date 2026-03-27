(async function () {
  const { initIdentityForm, getNickname, getSection, escapeHtml, formatDate } = window.PollyCommon;
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

  let cachedPost = null;

  if (!id) {
    threadTitle.textContent = "Thread not found";
    threadPost.innerHTML = '<p class="muted">Missing thread id in URL.</p>';
    replyForm.style.display = "none";
    return;
  }

  async function load() {
    const [post, allPosts, allComments] = await Promise.all([api.getPostById(id), api.getPosts(), api.getComments()]);
    if (!post) {
      threadTitle.textContent = "Thread not found";
      threadPost.innerHTML = '<p class="muted">This thread does not exist.</p>';
      replyForm.style.display = "none";
      return;
    }

    cachedPost = post;

    const section = getSection(post.category);
    breadcrumb.textContent = `Forum Index > ${section.name} > ${post.title}`;
    backToSection.href = `forum.html?section=${section.key}`;
    threadTitle.textContent = post.title;

    const tags = Array.isArray(post.tags) ? post.tags : [];
    threadPost.innerHTML = `
      <h2>${escapeHtml(post.title)}</h2>
      <p class="post-meta">Posted by ${escapeHtml(post.author_name)} - ${formatDate(post.created_at)}</p>
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
                <strong>${escapeHtml(comment.author_name)}</strong> <small class="muted">${formatDate(comment.created_at)}</small>
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
})();
