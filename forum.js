(async function () {
  const {
    SECTION_META,
    getSection,
    initIdentityForm,
    getNickname,
    normalizeTags,
    escapeHtml,
    formatDate,
    formatRelative,
    renderPager,
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

    const filtered = posts.filter((post) => {
      if (!query) return true;
      const tags = Array.isArray(post.tags) ? post.tags.join(" ") : "";
      return `${post.title} ${post.body} ${tags}`.toLowerCase().includes(query);
    });

    filtered.sort((a, b) => {
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
    [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    updateTopMetrics(posts, comments);
    posts = posts.filter((p) => p.category === section.key);
    renderRows();
  } catch (error) {
    threadRows.innerHTML = `<tr><td colspan="4" class="muted">Could not load section: ${escapeHtml(error.message || String(error))}</td></tr>`;
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
      currentPage = 1;
      [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
      updateTopMetrics(posts, comments);
      posts = posts.filter((p) => p.category === section.key);
      renderRows();
    } catch (error) {
      alert(`Could not create thread: ${error.message || String(error)}`);
    }
  });
})();
