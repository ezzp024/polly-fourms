(async function () {
  const {
    initIdentityForm,
    escapeHtml,
    formatDate,
    renderPager,
    isModerator,
    profileLink,
    buildMemberStats,
    toHandle,
    getNickname
  } = window.PollyCommon;
  const api = window.PollyApi.createApi();

  initIdentityForm();

  const searchInput = document.getElementById("releaseSearch");
  const releaseSort = document.getElementById("releaseSort");
  const releaseGrid = document.getElementById("releaseGrid");
  const releasePager = document.getElementById("releasePager");

  const PAGE_SIZE = 10;
  let currentPage = 1;

  let posts = [];
  let comments = [];
  let memberStats = new Map();
  const canModerate = isModerator();
  if (canModerate) {
    document.body.classList.add("is-moderator");
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
              post.is_hidden ? '<span class="badge badge-hidden">Hidden</span>' : ""
            ].join(" ");
            return `
              <article class="release-card">
                <h3><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a> ${flags}</h3>
                <p class="post-meta">by <a href="${profileLink(post.author_name)}">${escapeHtml(post.author_name)}</a> <span class="badge ${rankClass}">${rank}</span> - ${formatDate(post.created_at)}</p>
                <p>${escapeHtml(post.body.slice(0, 170))}${post.body.length > 170 ? "..." : ""}</p>
                <div class="tags">${tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
                <p class="post-meta">Replies: ${countByPost.get(post.id) || 0}</p>
                ${post.software_url ? `<p><a href="${escapeHtml(post.software_url)}" target="_blank" rel="noopener noreferrer">Download / Repository</a></p>` : ""}
                <p class="release-actions"><button type="button" data-action="report" data-id="${post.id}">Report</button></p>
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
    if (action !== "report" || !postId) return;

    const nickname = getNickname();
    if (!nickname) {
      alert("Set your nickname first in the top bar.");
      return;
    }

    const reason = prompt("Reason for report:", "Spam, abuse, malware, or unsafe link");
    if (!reason) return;

    try {
      await api.createReport({ post_id: postId, reason, reporter_name: nickname });
      target.textContent = "Reported";
      setTimeout(() => {
        target.textContent = "Report";
      }, 1300);
    } catch (error) {
      alert(`Could not submit report: ${error.message || String(error)}`);
    }
  });
})();
