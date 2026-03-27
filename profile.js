(async function () {
  const {
    initIdentityForm,
    toHandle,
    profileLink,
    buildMemberStats,
    escapeHtml,
    formatDate,
    isModerator
  } = window.PollyCommon;

  const api = window.PollyApi.createApi();

  initIdentityForm();

  const profileName = document.getElementById("profileName");
  const profileMeta = document.getElementById("profileMeta");
  const profileCard = document.getElementById("profileCard");
  const recentThreads = document.getElementById("recentThreads");
  const recentReplies = document.getElementById("recentReplies");
  const memberSearch = document.getElementById("memberSearch");
  const memberDirectory = document.getElementById("memberDirectory");

  const query = new URLSearchParams(window.location.search);
  const targetHandle = toHandle(query.get("user") || "");

  let allMembers = [];

  function renderDirectory(items) {
    memberDirectory.innerHTML = items.length
      ? items
          .map(
            (member) => `
              <article class="stack-item">
                <strong><a href="${profileLink(member.displayName)}">${escapeHtml(member.displayName)}</a></strong>
                <small>${member.rank} - ${member.threads} threads / ${member.replies} replies</small>
              </article>
            `
          )
          .join("")
      : '<p class="muted">No members found.</p>';
  }

  function renderProfile(member) {
    if (!member) {
      profileName.textContent = "Member not found";
      profileMeta.textContent = "Try selecting a member from the directory list.";
      profileCard.innerHTML = "";
      recentThreads.innerHTML = '<p class="muted">No threads.</p>';
      recentReplies.innerHTML = '<p class="muted">No replies.</p>';
      return;
    }

    const role = member.rank;
    profileName.textContent = member.displayName;
    profileMeta.textContent = `${role} profile`;
    profileCard.innerHTML = `
      <div class="profile-kpis">
        <article><strong>${member.rank}</strong><small>Rank</small></article>
        <article><strong>${member.threads}</strong><small>Threads</small></article>
        <article><strong>${member.replies}</strong><small>Replies</small></article>
        <article><strong>${member.score}</strong><small>Activity Score</small></article>
      </div>
    `;

    recentThreads.innerHTML = member.recentThreads.length
      ? member.recentThreads
          .slice(0, 8)
          .map(
            (post) => `
              <article class="stack-item">
                <strong><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></strong>
                <small>${formatDate(post.created_at)}</small>
              </article>
            `
          )
          .join("")
      : '<p class="muted">No threads yet.</p>';

    recentReplies.innerHTML = member.recentReplies.length
      ? member.recentReplies
          .slice(0, 8)
          .map(
            (reply) => `
              <article class="stack-item">
                <strong><a href="thread.html?id=${reply.post_id}">Reply on thread</a></strong>
                <small>${formatDate(reply.created_at)} - ${escapeHtml(reply.body.slice(0, 70))}${reply.body.length > 70 ? "..." : ""}</small>
              </article>
            `
          )
          .join("")
      : '<p class="muted">No replies yet.</p>';
  }

  try {
    const [postsRaw, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    const posts = isModerator() ? postsRaw : postsRaw.filter((p) => !p.is_hidden);
    const statsMap = buildMemberStats(posts, comments);
    allMembers = [...statsMap.values()].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

    renderDirectory(allMembers);
    const selected = targetHandle ? statsMap.get(targetHandle) : allMembers[0];
    renderProfile(selected);
  } catch (error) {
    profileMeta.textContent = `Could not load member data: ${escapeHtml(error.message || String(error))}`;
  }

  memberSearch.addEventListener("input", () => {
    const queryText = memberSearch.value.trim().toLowerCase();
    const filtered = allMembers.filter((member) => member.displayName.toLowerCase().includes(queryText));
    renderDirectory(filtered);
  });
})();
