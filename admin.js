(async function () {
  const {
    initIdentityForm,
    getNickname,
    formatDate,
    profileLink,
    escapeHtml,
    buildMemberStats,
    hasAdminSession
  } = window.PollyCommon;

  initIdentityForm();

  const allowed = await hasAdminSession();
  if (!allowed) {
    window.location.replace("auth.html?next=admin.html");
    return;
  }

  document.body.classList.add("is-admin");

  const api = window.PollyApi.createApi();
  const adminStatus = document.getElementById("adminStatus");
  const adminContent = document.getElementById("adminContent");
  const adminStats = document.getElementById("adminStats");
  const reportRows = document.getElementById("reportRows");
  const controlRows = document.getElementById("controlRows");
  const userRows = document.getElementById("userRows");
  const banRows = document.getElementById("banRows");

  adminStatus.textContent = "Admin session verified.";
  adminContent.classList.remove("hidden-block");

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function renderAdmin() {
    const [posts, comments, reports, bans] = await Promise.all([
      api.getPosts(),
      api.getComments(),
      api.getReports(),
      api.getBannedUsers()
    ]);

    const memberStats = buildMemberStats(posts, comments);
    const members = [...memberStats.values()].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

    const openReports = reports.filter((r) => r.status !== "resolved");
    const activeBans = bans.filter((b) => b.active !== false);
    const hiddenThreads = posts.filter((p) => p.is_hidden);

    adminStats.innerHTML = `
      <article><strong>${posts.length}</strong><small>Total Threads</small></article>
      <article><strong>${comments.length}</strong><small>Total Replies</small></article>
      <article><strong>${members.length}</strong><small>Registered Users</small></article>
      <article><strong>${openReports.length}</strong><small>Open Reports</small></article>
      <article><strong>${activeBans.length}</strong><small>Active Bans</small></article>
      <article><strong>${hiddenThreads.length}</strong><small>Hidden Threads</small></article>
    `;

    userRows.innerHTML = members.length
      ? members
          .map((member) => {
            const rankClass = `badge-rank-${member.rank.toLowerCase()}`;
            return `
              <tr>
                <td><a href="${profileLink(member.displayName)}">${escapeHtml(member.displayName)}</a></td>
                <td><span class="badge ${rankClass}">${member.rank}</span></td>
                <td>${member.threads}</td>
                <td>${member.replies}</td>
                <td>
                  <button type="button" data-action="ban-user" data-user="${escapeHtml(member.displayName)}">Ban</button>
                  <button type="button" data-action="remove-user-content" data-user="${escapeHtml(member.displayName)}">Remove User</button>
                </td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="5" class="muted">No users found.</td></tr>';

    banRows.innerHTML = activeBans.length
      ? activeBans
          .map(
            (ban) => `
              <tr>
                <td>${escapeHtml(ban.nickname)}</td>
                <td>${escapeHtml(ban.reason || "Policy violation")}</td>
                <td>${escapeHtml(ban.banned_by || "admin")}</td>
                <td>${formatDate(ban.created_at)}</td>
                <td><button type="button" data-action="unban" data-id="${ban.id}">Unban</button></td>
              </tr>
            `
          )
          .join("")
      : '<tr><td colspan="5" class="muted">No active bans.</td></tr>';

    const byPostId = new Map(posts.map((p) => [p.id, p]));
    reportRows.innerHTML = openReports.length
      ? openReports
          .map((report) => {
            const post = byPostId.get(report.post_id);
            return `
              <tr>
                <td>${post ? `<a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a>` : "Deleted thread"}</td>
                <td>${escapeHtml(report.reason || "No reason")}</td>
                <td><a href="${profileLink(report.reporter_name)}">${escapeHtml(report.reporter_name)}</a></td>
                <td>${formatDate(report.created_at)}</td>
                <td><button type="button" data-action="resolve-report" data-id="${report.id}">Resolve</button></td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="5" class="muted">No open reports.</td></tr>';

    const sortedPosts = [...posts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 200);
    controlRows.innerHTML = sortedPosts.length
      ? sortedPosts
          .map((post) => {
            const flags = [post.is_pinned ? "Pinned" : null, post.is_sticky ? "Sticky" : null, post.is_locked ? "Locked" : null, post.is_solved ? "Solved" : null, post.is_hidden ? "Hidden" : null]
              .filter(Boolean)
              .join(", ");
            return `
              <tr>
                <td><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></td>
                <td>${flags || "None"}</td>
                <td>
                  <button type="button" data-action="pin" data-id="${post.id}" data-state="${post.is_pinned ? "1" : "0"}">${post.is_pinned ? "Unpin" : "Pin"}</button>
                  <button type="button" data-action="sticky" data-id="${post.id}" data-state="${post.is_sticky ? "1" : "0"}">${post.is_sticky ? "Unsticky" : "Sticky"}</button>
                  <button type="button" data-action="lock" data-id="${post.id}" data-state="${post.is_locked ? "1" : "0"}">${post.is_locked ? "Unlock" : "Lock"}</button>
                  <button type="button" data-action="solve" data-id="${post.id}" data-state="${post.is_solved ? "1" : "0"}">${post.is_solved ? "Unsolve" : "Solved"}</button>
                  <button type="button" data-action="hide" data-id="${post.id}" data-state="${post.is_hidden ? "1" : "0"}">${post.is_hidden ? "Unhide" : "Hide"}</button>
                  <button type="button" data-action="remove-link" data-id="${post.id}">Remove Link</button>
                  <button type="button" data-action="delete-thread" data-id="${post.id}">Delete</button>
                </td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="3" class="muted">No threads yet.</td></tr>';

    document.getElementById("downloadData").onclick = () => {
      downloadJson(`polly-fourms-export-${Date.now()}.json`, {
        exported_at: new Date().toISOString(),
        stats: {
          threads: posts.length,
          replies: comments.length,
          users: members.length,
          openReports: openReports.length,
          activeBans: activeBans.length
        },
        users: members,
        banned_users: bans,
        posts,
        comments,
        reports
      });
    };
  }

  async function runAction(action, id, state, rawUser) {
    const nickname = getNickname() || "admin";

    if (action === "resolve-report") return api.resolveReport(id, nickname);
    if (action === "pin") {
      await api.updatePost(id, { is_pinned: !state });
      await safeLog("toggle_pin", "post", id, { value: !state, actor: nickname });
      return;
    }
    if (action === "sticky") {
      await api.updatePost(id, { is_sticky: !state });
      await safeLog("toggle_sticky", "post", id, { value: !state, actor: nickname });
      return;
    }
    if (action === "lock") {
      await api.updatePost(id, { is_locked: !state });
      await safeLog("toggle_lock", "post", id, { value: !state, actor: nickname });
      return;
    }
    if (action === "solve") {
      await api.updatePost(id, { is_solved: !state });
      await safeLog("toggle_solved", "post", id, { value: !state, actor: nickname });
      return;
    }
    if (action === "hide") {
      const nextHidden = !state;
      let reason = "";
      if (nextHidden) {
        reason = prompt("Reason for hiding thread:", "Needs moderator review") || "Needs moderator review";
      }
      await api.updatePost(id, { is_hidden: nextHidden, hidden_reason: nextHidden ? reason : "" });
      await safeLog("toggle_hidden", "post", id, { value: nextHidden, reason, actor: nickname });
      return;
    }
    if (action === "remove-link") {
      await api.clearPostLink(id);
      await safeLog("remove_link", "post", id, { actor: nickname });
      return;
    }
    if (action === "delete-thread") {
      if (!confirm("Delete this thread permanently?")) return;
      await api.deletePost(id);
      await safeLog("delete_thread", "post", id, { actor: nickname });
      return;
    }
    if (action === "ban-user") {
      const reason = prompt("Ban reason:", "Policy violation") || "Policy violation";
      await api.banUser(rawUser, reason, nickname);
      await safeLog("ban_user", "user", rawUser, { reason, actor: nickname });
      return;
    }
    if (action === "remove-user-content") {
      if (!confirm(`Remove all posts/comments by ${rawUser}?`)) return;
      await api.deletePostsByAuthor(rawUser);
      await api.deleteCommentsByAuthor(rawUser);
      await api.banUser(rawUser, "Removed by administrator", nickname);
      await safeLog("remove_user_content", "user", rawUser, { actor: nickname });
      return;
    }
    if (action === "unban") {
      await api.unbanUser(id);
      await safeLog("unban_user", "ban", id, { actor: nickname });
    }
  }

  function getButton(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;
    if (target.tagName !== "BUTTON") return null;
    return target;
  }

  async function safeLog(action, targetType, targetId, details) {
    try {
      await api.createModerationLog(action, targetType, targetId, details);
    } catch {
      // ignore missing moderation log table during transitional setups
    }
  }

  async function handleTableActions(event) {
    const button = getButton(event);
    if (!button) return;
    const action = button.getAttribute("data-action");
    const id = button.getAttribute("data-id") || "";
    const state = button.getAttribute("data-state") === "1";
    const rawUser = button.getAttribute("data-user") || "";
    if (!action) return;

    try {
      await runAction(action, id, state, rawUser);
      await renderAdmin();
    } catch (error) {
      alert(`Action failed: ${error.message || String(error)}`);
    }
  }

  reportRows.addEventListener("click", handleTableActions);
  controlRows.addEventListener("click", handleTableActions);
  userRows.addEventListener("click", handleTableActions);
  banRows.addEventListener("click", handleTableActions);

  try {
    await renderAdmin();
  } catch (error) {
    adminStatus.textContent = `Admin backend not ready: ${error.message || String(error)}`;
    adminContent.classList.add("hidden-block");
  }
})();
