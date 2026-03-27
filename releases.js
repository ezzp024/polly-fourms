(async function () {
  const { initIdentityForm, escapeHtml, formatDate, renderPager } = window.PollyCommon;
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

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const countByPost = comments.reduce((map, row) => {
      map.set(row.post_id, (map.get(row.post_id) || 0) + 1);
      return map;
    }, new Map());

    const filtered = posts.filter((post) => {
      const tags = Array.isArray(post.tags) ? post.tags.join(" ") : "";
      const text = `${post.title} ${post.body} ${tags}`.toLowerCase();
      return !query || text.includes(query);
    });

    filtered.sort((a, b) => {
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
            return `
              <article class="release-card">
                <h3><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></h3>
                <p class="post-meta">by ${escapeHtml(post.author_name)} - ${formatDate(post.created_at)}</p>
                <p>${escapeHtml(post.body.slice(0, 170))}${post.body.length > 170 ? "..." : ""}</p>
                <div class="tags">${tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
                <p class="post-meta">Replies: ${countByPost.get(post.id) || 0}</p>
                ${post.software_url ? `<p><a href="${escapeHtml(post.software_url)}" target="_blank" rel="noopener noreferrer">Download / Repository</a></p>` : ""}
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
})();
