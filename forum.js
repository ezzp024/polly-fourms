(async function () {
  const {
    getSection,
    initIdentityForm,
    getNickname,
    normalizeTags,
    escapeHtml,
    formatDate,
    updateTopMetrics
  } = window.PollyCommon;

  const api = window.PollyApi.createApi();

  initIdentityForm();

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

  sectionTitle.textContent = section.name;
  sectionDescription.textContent = section.description;
  breadcrumb.textContent = `Forum Index > ${section.name}`;

  let posts = [];
  let comments = [];

  function renderRows() {
    const query = searchInput.value.trim().toLowerCase();
    const commentsByPost = comments.reduce((map, row) => {
      const total = map.get(row.post_id) || 0;
      map.set(row.post_id, total + 1);
      return map;
    }, new Map());

    const filtered = posts.filter((post) => {
      if (!query) return true;
      const tags = Array.isArray(post.tags) ? post.tags.join(" ") : "";
      return `${post.title} ${post.body} ${tags}`.toLowerCase().includes(query);
    });

    filtered.sort((a, b) => {
      if (sortBy.value === "oldest") return Date.parse(a.created_at) - Date.parse(b.created_at);
      if (sortBy.value === "replies") return (commentsByPost.get(b.id) || 0) - (commentsByPost.get(a.id) || 0);
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });

    threadRows.innerHTML = filtered.length
      ? filtered
          .map((post) => {
            const replies = commentsByPost.get(post.id) || 0;
            return `
              <tr>
                <td>
                  <div class="thread-row-title">
                    <strong><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></strong>
                    <small>${escapeHtml(post.body.slice(0, 110))}${post.body.length > 110 ? "..." : ""}</small>
                  </div>
                </td>
                <td>${escapeHtml(post.author_name)}</td>
                <td><span class="stat-pill">${replies}</span></td>
                <td>${formatDate(post.created_at)}</td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="4" class="muted">No threads in this section yet.</td></tr>';
  }

  try {
    [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    updateTopMetrics(posts, comments);
    posts = posts.filter((p) => p.category === section.key);
    renderRows();
  } catch (error) {
    threadRows.innerHTML = `<tr><td colspan="4" class="muted">Could not load section: ${escapeHtml(error.message || String(error))}</td></tr>`;
  }

  searchInput.addEventListener("input", renderRows);
  sortBy.addEventListener("change", renderRows);

  newThreadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = getNickname();
    if (!nickname) {
      alert("Set your nickname first in the top bar.");
      return;
    }

    const form = new FormData(newThreadForm);
    const title = String(form.get("title") || "").trim();
    const body = String(form.get("body") || "").trim();
    const softwareUrl = String(form.get("softwareUrl") || "").trim();
    const tags = normalizeTags(String(form.get("tags") || ""));

    if (!title || !body) return;

    try {
      await api.createPost({
        title,
        body,
        category: section.key,
        software_url: softwareUrl,
        tags,
        author_name: nickname
      });
      newThreadForm.reset();
      [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
      updateTopMetrics(posts, comments);
      posts = posts.filter((p) => p.category === section.key);
      renderRows();
    } catch (error) {
      alert(`Could not create thread: ${error.message || String(error)}`);
    }
  });
})();
