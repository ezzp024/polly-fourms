(async function () {
  const { SECTION_META, formatDate, escapeHtml, initIdentityForm, updateTopMetrics } = window.PollyCommon;
  const api = window.PollyApi.createApi();

  initIdentityForm();

  const boardRows = document.getElementById("boardRows");
  const latestReleases = document.getElementById("latestReleases");

  try {
    const [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    updateTopMetrics(posts, comments);

    const repliesByPost = comments.reduce((map, comment) => {
      const count = map.get(comment.post_id) || 0;
      map.set(comment.post_id, count + 1);
      return map;
    }, new Map());

    const postsBySection = posts.reduce((map, post) => {
      const list = map.get(post.category) || [];
      list.push(post);
      map.set(post.category, list);
      return map;
    }, new Map());

    boardRows.innerHTML = Object.values(SECTION_META)
      .map((section) => {
        const sectionPosts = postsBySection.get(section.key) || [];
        const threadCount = sectionPosts.length;
        const replyCount = sectionPosts.reduce((sum, post) => sum + (repliesByPost.get(post.id) || 0), 0);
        const latest = sectionPosts[0];
        const latestText = latest
          ? `<div class="latest-meta"><a href="thread.html?id=${latest.id}">${escapeHtml(latest.title)}</a><br>by ${escapeHtml(latest.author_name)} - ${formatDate(latest.created_at)}</div>`
          : '<span class="muted">No threads yet</span>';

        return `
          <tr>
            <td>
              <div class="forum-title">
                <strong><a href="forum.html?section=${section.key}">${escapeHtml(section.name)}</a></strong>
                <span>${escapeHtml(section.description)}</span>
              </div>
            </td>
            <td><span class="stat-pill">${threadCount}</span></td>
            <td><span class="stat-pill">${replyCount}</span></td>
            <td>${latestText}</td>
          </tr>
        `;
      })
      .join("");

    const releasePosts = posts.filter((p) => p.category === "software").slice(0, 6);
    latestReleases.innerHTML = releasePosts.length
      ? releasePosts
          .map(
            (post) => `
              <article class="stack-item">
                <strong><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></strong>
                <small>by ${escapeHtml(post.author_name)} - ${formatDate(post.created_at)}</small>
              </article>
            `
          )
          .join("")
      : '<p class="muted">No software releases yet.</p>';
  } catch (error) {
    boardRows.innerHTML = `<tr><td colspan="4" class="muted">Could not load forum data: ${escapeHtml(error.message || String(error))}</td></tr>`;
  }
})();
