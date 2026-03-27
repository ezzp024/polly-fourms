(async function () {
  const { initIdentityForm, escapeHtml, formatDate } = window.PollyCommon;
  const api = window.PollyApi.createApi();

  initIdentityForm();

  const searchInput = document.getElementById("releaseSearch");
  const releaseGrid = document.getElementById("releaseGrid");

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

    releaseGrid.innerHTML = filtered.length
      ? filtered
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
  }

  try {
    [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    posts = posts.filter((p) => p.category === "software");
    render();
  } catch (error) {
    releaseGrid.innerHTML = `<p class="muted">Could not load releases: ${escapeHtml(error.message || String(error))}</p>`;
    return;
  }

  searchInput.addEventListener("input", render);
})();
