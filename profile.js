(async function () {
  const {
    initIdentityForm,
    toHandle,
    profileLink,
    buildMemberStats,
    escapeHtml,
    formatDate,
    hasModeratorSession
  } = window.PollyCommon;

  const api = window.PollyApi.createApi();

  initIdentityForm();

  if (window.PollyCommon && window.PollyCommon.refreshSessionNav) {
    await window.PollyCommon.refreshSessionNav();
  }

  const profileName = document.getElementById("profileName");
  const profileMeta = document.getElementById("profileMeta");
  const profileCard = document.getElementById("profileCard");
  const recentThreads = document.getElementById("recentThreads");
  const recentReplies = document.getElementById("recentReplies");
  const memberSearch = document.getElementById("memberSearch");
  const memberDirectory = document.getElementById("memberDirectory");
  const accountStatus = document.getElementById("accountStatus");
  const accountForm = document.getElementById("accountForm");
  const accountDisplayName = document.getElementById("accountDisplayName");

  const query = new URLSearchParams(window.location.search);
  const targetHandle = toHandle(query.get("user") || "");

  let allMembers = [];
  let canModerate = false;

  async function loadAccountSettings() {
    const user = await window.PollyCommon.getAuthUser();
    if (!user) {
      accountStatus.textContent = "You are not logged in. Login first, then set your display name.";
      accountForm.style.display = "none";
      return;
    }

    accountForm.style.display = "grid";
    const profile = await window.PollyCommon.fetchMyProfile();
    if (profile && profile.display_name) {
      accountDisplayName.value = profile.display_name;
      try {
        const banned = await api.isNicknameBanned(profile.display_name);
        accountStatus.textContent = banned
          ? "Your display name is set, but this account is currently banned from posting, replying, and reporting."
          : "Your display name is set. You can update it here.";
      } catch {
        accountStatus.textContent = "Your display name is set. You can update it here.";
      }
    } else {
      accountStatus.textContent = "Please set your display name. Posting is blocked until you do.";
    }
  }

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
    const karma = member.score;
    const karmaLevel = karma >= 25 ? "⭐⭐⭐" : karma >= 10 ? "⭐⭐" : karma >= 5 ? "⭐" : "";
    profileCard.innerHTML = `
      <div class="profile-kpis">
        <article><strong>${member.rank}</strong><small>Rank</small></article>
        <article><strong>${member.threads}</strong><small>Threads</small></article>
        <article><strong>${member.replies}</strong><small>Replies</small></article>
        <article><strong>${karma}</strong><small>Karma ${karmaLevel}</small></article>
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
    canModerate = await hasModeratorSession();
    const [postsRaw, comments] = await Promise.all([api.getPosts(), api.getComments()]);
    const posts = canModerate ? postsRaw : postsRaw.filter((p) => !p.is_hidden);
    const statsMap = buildMemberStats(posts, comments);
    allMembers = [...statsMap.values()].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

    renderDirectory(allMembers);
    const selected = targetHandle ? statsMap.get(targetHandle) : allMembers[0];
    renderProfile(selected);
  } catch (error) {
    profileMeta.textContent = `Could not load member data: ${escapeHtml(error.message || String(error))}`;
  }

  try {
    await loadAccountSettings();
  } catch {
    accountStatus.textContent = "Could not load account settings.";
  }

  memberSearch.addEventListener("input", () => {
    const queryText = memberSearch.value.trim().toLowerCase();
    const filtered = allMembers.filter((member) => member.displayName.toLowerCase().includes(queryText));
    renderDirectory(filtered);
  });

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = String(accountDisplayName.value || "").trim();
    if (!value) return;

    try {
      await window.PollyCommon.saveMyDisplayName(value);
      await window.PollyCommon.refreshIdentity();
      accountStatus.textContent = "Display name saved successfully.";
      const [postsRaw, comments] = await Promise.all([api.getPosts(), api.getComments()]);
      const posts = canModerate ? postsRaw : postsRaw.filter((p) => !p.is_hidden);
      const statsMap = buildMemberStats(posts, comments);
      allMembers = [...statsMap.values()].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
      renderDirectory(allMembers);
      const selected = statsMap.get(toHandle(value));
      if (selected) {
        renderProfile(selected);
      }
    } catch (error) {
      accountStatus.textContent = `Could not save display name: ${escapeHtml(error.message || String(error))}`;
    }
  });

  const exportDataBtn = document.getElementById("exportDataBtn");
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");

  if (exportDataBtn) {
    exportDataBtn.addEventListener("click", async () => {
      const user = await window.PollyCommon.getAuthUser();
      const profile = await window.PollyCommon.fetchMyProfile();
      
      if (!user && !profile) {
        alert("Please login or set a display name first.");
        return;
      }

      try {
        const [allPosts, allComments] = await Promise.all([api.getPosts(), api.getComments()]);
        const displayName = profile?.display_name || "";
        const myPosts = allPosts.filter((p) => 
          (user && p.author_user_id === user.id) || 
          (!user && p.author_name === displayName)
        );
        const myComments = allComments.filter((c) => 
          (user && c.author_user_id === user.id) || 
          (!user && c.author_name === displayName)
        );

        const exportData = {
          exportedAt: new Date().toISOString(),
          userId: user?.id || null,
          email: user?.email || null,
          displayName: displayName,
          profile: profile,
          threads: myPosts,
          replies: myComments
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `polly-fourms-data-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert("Your data has been exported successfully.");
      } catch (error) {
        alert(`Export failed: ${error.message}`);
      }
    });
  }

  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", async () => {
      const user = await window.PollyCommon.getAuthUser();
      const profile = await window.PollyCommon.fetchMyProfile();
      
      if (!user && !profile) {
        alert("Please login or set a display name first.");
        return;
      }

      const confirmed = confirm("Are you sure you want to delete your account? This will remove all your posts, comments, and profile data. This action cannot be undone.");
      if (!confirmed) return;

      const doubleConfirm = prompt("Type DELETE to confirm account deletion:");
      if (doubleConfirm !== "DELETE") {
        alert("Account deletion cancelled.");
        return;
      }

      try {
        const displayName = profile?.display_name || "";
        const [allPosts, allComments] = await Promise.all([api.getPosts(), api.getComments()]);
        const myPosts = allPosts.filter((p) => 
          (user && p.author_user_id === user.id) || 
          (!user && p.author_name === displayName)
        );
        const myComments = allComments.filter((c) => 
          (user && c.author_user_id === user.id) || 
          (!user && c.author_name === displayName)
        );

        for (const post of myPosts) {
          await api.deletePost(post.id);
        }
        for (const comment of myComments) {
          await api.deleteComment(comment.id);
        }

        const client = window.PollyCommon.createAuthClient();
        if (client) {
          await client.auth.signOut();
        }

        alert("Your account has been deleted. We're sorry to see you go!");
        window.location.href = "index.html";
      } catch (error) {
        alert(`Account deletion failed: ${error.message}`);
      }
    });
  }
})();
