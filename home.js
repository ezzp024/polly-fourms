(async function () {
  const { SECTION_META, formatDate, formatRelative, escapeHtml, initIdentityForm, updateTopMetrics } = window.PollyCommon;
  const api = window.PollyApi.createApi();

  initIdentityForm();

  const boardRows = document.getElementById("boardRows");
  const latestReleases = document.getElementById("latestReleases");
  const recentActivity = document.getElementById("recentActivity");
  const topContributors = document.getElementById("topContributors");
  const forumStats = document.getElementById("forumStats");

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

    const activity = [];
    for (const post of posts.slice(0, 8)) {
      activity.push({
        kind: "thread",
        created_at: post.created_at,
        text: `${post.author_name} opened thread: ${post.title}`,
        link: `thread.html?id=${post.id}`
      });
    }
    for (const comment of comments.slice(-20)) {
      activity.push({
        kind: "reply",
        created_at: comment.created_at,
        text: `${comment.author_name} replied on a thread`,
        link: `thread.html?id=${comment.post_id}`
      });
    }
    activity.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

    recentActivity.innerHTML = activity.length
      ? activity
          .slice(0, 8)
          .map(
            (item) => `
              <article class="stack-item">
                <strong><a href="${item.link}">${escapeHtml(item.text)}</a></strong>
                <small>${formatRelative(item.created_at)} - ${formatDate(item.created_at)}</small>
              </article>
            `
          )
          .join("")
      : '<p class="muted">No recent activity yet.</p>';

    const authorScore = new Map();
    for (const post of posts) {
      authorScore.set(post.author_name, (authorScore.get(post.author_name) || 0) + 3);
    }
    for (const comment of comments) {
      authorScore.set(comment.author_name, (authorScore.get(comment.author_name) || 0) + 1);
    }
    const leaders = [...authorScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    topContributors.innerHTML = leaders.length
      ? leaders
          .map(
            ([name, score], idx) => `
              <article class="stack-item">
                <strong>#${idx + 1} ${escapeHtml(name)}</strong>
                <small>activity score: ${score}</small>
              </article>
            `
          )
          .join("")
      : '<p class="muted">No contributors yet.</p>';

    const uniqueAuthors = new Set([...posts.map((p) => p.author_name), ...comments.map((c) => c.author_name)]);
    forumStats.innerHTML = `
      <article class="stack-item"><strong>${posts.length}</strong><small>Total Threads</small></article>
      <article class="stack-item"><strong>${comments.length}</strong><small>Total Replies</small></article>
      <article class="stack-item"><strong>${uniqueAuthors.size}</strong><small>Unique Members</small></article>
      <article class="stack-item"><strong>${releasePosts.length}</strong><small>Latest Releases Listed</small></article>
    `;
  } catch (error) {
    boardRows.innerHTML = `<tr><td colspan="4" class="muted">Could not load forum data: ${escapeHtml(error.message || String(error))}</td></tr>`;
  }
})();
