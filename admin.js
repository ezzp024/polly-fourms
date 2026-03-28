(async function () {
  const {
    initIdentityForm,
    getNickname,
    formatDate,
    profileLink,
    escapeHtml,
    buildMemberStats,
    hasAdminSession,
    showPageNotice,
    threadLink,
    routePath
  } = window.PollyCommon;

  initIdentityForm();

  const allowed = await hasAdminSession();
  if (!allowed) {
    window.location.replace(routePath("auth", `next=${encodeURIComponent(routePath("admin"))}`));
    return;
  }

  document.body.classList.add("is-admin");

  const api = window.PollyApi.createApi();
  const adminStatus = document.getElementById("adminStatus");
  const adminContent = document.getElementById("adminContent");
  const adminStats = document.getElementById("adminStats");
  const reportRows = document.getElementById("reportRows");
  const downloadReviewRows = document.getElementById("downloadReviewRows");
  const controlRows = document.getElementById("controlRows");
  const userRows = document.getElementById("userRows");
  const banRows = document.getElementById("banRows");
  const userFilter = document.getElementById("userFilter");
  const banFilter = document.getElementById("banFilter");
  const reportFilter = document.getElementById("reportFilter");
  const threadFilter = document.getElementById("threadFilter");
  const banDateFrom = document.getElementById("banDateFrom");
  const banDateTo = document.getElementById("banDateTo");
  const reportDateFrom = document.getElementById("reportDateFrom");
  const reportDateTo = document.getElementById("reportDateTo");
  const userActivitySearch = document.getElementById("userActivitySearch");
  const activityLogRows = document.getElementById("activityLogRows");
  const refreshLogsBtn = document.getElementById("refreshLogs");

  adminStatus.textContent = "Admin session verified.";
  adminContent.classList.remove("hidden-block");

  const norm = (value) => String(value || "").trim().toLowerCase();
  const includes = (value, q) => !q || norm(value).includes(q);

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function renderActivityLog() {
    if (!activityLogRows) return;

    const logs = await api.getModerationLogs();
    const qActivity = norm(userActivitySearch ? userActivitySearch.value : "");

    const filtered = (Array.isArray(logs) ? logs : []).filter((log) => {
      if (!qActivity) return true;
      const details = JSON.stringify(log.details || {}).toLowerCase();
      const actor = String(log.actor_email || "").toLowerCase();
      return actor.includes(qActivity) || details.includes(qActivity);
    });

    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    activityLogRows.innerHTML = filtered.length
      ? filtered.slice(0, 100).map((log) => {
          const details = log.details ? JSON.stringify(log.details).slice(0, 60) : "";
          return `
            <tr>
              <td>${formatDate(log.created_at)}</td>
              <td>${escapeHtml(String(log.actor_email || "system").slice(0, 30))}</td>
              <td>${escapeHtml(String(log.action).slice(0, 20))}</td>
              <td>${escapeHtml(details)}</td>
            </tr>
          `;
        }).join("")
      : '<tr><td colspan="4" class="muted">No activity logs found.</td></tr>';
  }

  async function renderAdmin() {
    const [posts, comments, reports, bans, pendingDownloads] = await Promise.all([
      api.getPosts(),
      api.getComments(),
      api.getReports(),
      api.getBannedUsers(),
      api.getPendingDownloadLinks()
    ]);

    const memberStats = buildMemberStats(posts, comments);
    const members = [...memberStats.values()].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

    const openReports = reports.filter((r) => r.status !== "resolved");
    const activeBans = bans.filter((b) => b.active !== false);
    const hiddenThreads = posts.filter((p) => p.is_hidden);

    const qUser = norm(userFilter ? userFilter.value : "");
    const qBan = norm(banFilter ? banFilter.value : "");
    const qReport = norm(reportFilter ? reportFilter.value : "");
    const qThread = norm(threadFilter ? threadFilter.value : "");

    const fromBanDate = banDateFrom ? new Date(banDateFrom.value) : null;
    const toBanDate = banDateTo ? new Date(banDateTo.value) : null;
    const fromReportDate = reportDateFrom ? new Date(reportDateFrom.value) : null;
    const toReportDate = reportDateTo ? new Date(reportDateTo.value) : null;

    const filteredMembers = members.filter((member) => includes(member.displayName, qUser));
    const filteredBans = activeBans.filter((ban) => {
      const textMatch = includes(ban.nickname, qBan) || includes(ban.reason, qBan);
      if (!textMatch) return false;
      if (fromBanDate || toBanDate) {
        const banDate = new Date(ban.created_at);
        if (fromBanDate && banDate < fromBanDate) return false;
        if (toBanDate && banDate > toBanDate) return false;
      }
      return true;
    });

    const byPostId = new Map(posts.map((p) => [p.id, p]));
    const filteredReports = openReports.filter((report) => {
      const textMatch = includes(report.reason, qReport) || includes(report.reporter_name, qReport) || includes(byPostId.get(report.post_id) ? byPostId.get(report.post_id).title : "", qReport);
      if (!textMatch) return false;
      if (fromReportDate || toReportDate) {
        const reportDate = new Date(report.created_at);
        if (fromReportDate && reportDate < fromReportDate) return false;
        if (toReportDate && reportDate > toReportDate) return false;
      }
      return true;
    });

    const sortedPosts = [...posts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 200);
    const filteredPosts = sortedPosts.filter((post) => {
      const flags = [
        post.is_pinned ? "pinned" : "",
        post.is_sticky ? "sticky" : "",
        post.is_locked ? "locked" : "",
        post.is_solved ? "solved" : "",
        post.is_hidden ? "hidden" : ""
      ].join(" ");
      return includes(post.title, qThread) || includes(post.author_name, qThread) || includes(flags, qThread);
    });

    adminStats.innerHTML = `
      <article><strong>${posts.length}</strong><small>Total Threads</small></article>
      <article><strong>${comments.length}</strong><small>Total Replies</small></article>
      <article><strong>${members.length}</strong><small>Registered Users</small></article>
      <article><strong>${openReports.length}</strong><small>Open Reports</small></article>
      <article><strong>${pendingDownloads.length}</strong><small>Pending Link Reviews</small></article>
      <article><strong>${activeBans.length}</strong><small>Active Bans</small></article>
      <article><strong>${hiddenThreads.length}</strong><small>Hidden Threads</small></article>
    `;

    userRows.innerHTML = filteredMembers.length
      ? filteredMembers
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
      : '<tr><td colspan="5" class="muted">No users match this filter.</td></tr>';

    banRows.innerHTML = filteredBans.length
      ? filteredBans
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
      : '<tr><td colspan="5" class="muted">No bans match this filter.</td></tr>';

    reportRows.innerHTML = filteredReports.length
      ? filteredReports
          .map((report) => {
            const post = byPostId.get(report.post_id);
            return `
              <tr>
                <td>${post ? `<a href="${threadLink(post.id)}">${escapeHtml(post.title)}</a>` : "Deleted thread"}</td>
                <td>${escapeHtml(report.reason || "No reason")}</td>
                <td><a href="${profileLink(report.reporter_name)}">${escapeHtml(report.reporter_name)}</a></td>
                <td>${formatDate(report.created_at)}</td>
                <td><button type="button" data-action="resolve-report" data-id="${report.id}">Resolve</button></td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="5" class="muted">No reports match this filter.</td></tr>';

    if (downloadReviewRows) {
      downloadReviewRows.innerHTML = (pendingDownloads || []).length
        ? pendingDownloads
            .map((item) => {
              const safeUrl = escapeHtml(String(item.submitted_url || ""));
              const encodedUrl = encodeURIComponent(String(item.submitted_url || ""));
              return `
                <tr>
                  <td><a href="${threadLink(item.post_id)}">${escapeHtml(String(item.post_title || "Unknown thread"))}</a></td>
                  <td><a href="${profileLink(item.submitted_by_name)}">${escapeHtml(String(item.submitted_by_name || "member"))}</a></td>
                  <td><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl.slice(0, 60)}${safeUrl.length > 60 ? "..." : ""}</a></td>
                  <td>${formatDate(item.created_at)}</td>
                  <td>
                    <button type="button" data-action="approve-download" data-id="${item.id}">Approve</button>
                    <button type="button" data-action="reject-download" data-id="${item.id}">Reject</button>
                    <button type="button" data-action="ban-domain" data-url="${encodedUrl}">Ban Domain</button>
                  </td>
                </tr>
              `;
            })
            .join("")
        : '<tr><td colspan="5" class="muted">No pending download links.</td></tr>';
    }

    controlRows.innerHTML = filteredPosts.length
      ? filteredPosts
          .map((post) => {
            const flags = [post.is_pinned ? "Pinned" : null, post.is_sticky ? "Sticky" : null, post.is_locked ? "Locked" : null, post.is_solved ? "Solved" : null, post.is_hidden ? "Hidden" : null]
              .filter(Boolean)
              .join(", ");
            return `
              <tr>
                <td><input type="checkbox" class="bulk-checkbox" data-id="${post.id}" ${selectedThreadIds.has(post.id) ? "checked" : ""} /></td>
                <td><a href="${threadLink(post.id)}">${escapeHtml(post.title)}</a></td>
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
      : '<tr><td colspan="3" class="muted">No threads match this filter.</td></tr>';

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

  async function runAction(action, id, state, rawUser, rawUrl) {
    const nickname = getNickname() || "admin";

    if (action === "resolve-report") {
      await api.resolveReport(id, nickname);
      await safeLog("resolve_report", "report", id, { actor: nickname });
      return;
    }
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
      return;
    }
    if (action === "approve-download") {
      const notes = prompt("Manual antivirus/security check notes (required):", "VirusTotal checked, no detections.");
      if (!notes || !String(notes).trim()) return;
      await api.reviewDownloadLink(id, "approved", nickname, notes);
      await safeLog("approve_download_link", "download_link_submission", id, { actor: nickname, notes });
      return;
    }
    if (action === "reject-download") {
      const notes = prompt("Manual antivirus/security rejection notes (required):", "Security review failed.");
      if (!notes || !String(notes).trim()) return;
      await api.reviewDownloadLink(id, "rejected", nickname, notes);
      await safeLog("reject_download_link", "download_link_submission", id, { actor: nickname, notes });
      return;
    }
    if (action === "ban-domain") {
      const raw = rawUrl;
      if (!raw) return;
      let hostname = "";
      try {
        hostname = new URL(raw).hostname;
      } catch {
        hostname = String(raw || "").replace(/^https?:\/\//i, "").split("/")[0];
      }
      if (!hostname) return;
      const confirmed = confirm(`Ban domain ${hostname} from future downloads?`);
      if (!confirmed) return;
      await api.banDownloadDomain(hostname);
      await safeLog("ban_download_domain", "domain", hostname, { actor: nickname });
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
    const rawUrl = decodeURIComponent(button.getAttribute("data-url") || "");
    if (!action) return;

    try {
      await runAction(action, id, state, rawUser, rawUrl);
      await renderAdmin();
    } catch (error) {
      showPageNotice(`Action failed: ${error.message || String(error)}`, "error", 5200);
    }
  }

  reportRows.addEventListener("click", handleTableActions);
  if (downloadReviewRows) downloadReviewRows.addEventListener("click", handleTableActions);
  controlRows.addEventListener("click", handleTableActions);
  userRows.addEventListener("click", handleTableActions);
  banRows.addEventListener("click", handleTableActions);

  [userFilter, banFilter, reportFilter, threadFilter].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", () => {
      void renderAdmin();
    });
  });

  [banDateFrom, banDateTo, reportDateFrom, reportDateTo].forEach((input) => {
    if (!input) return;
    input.addEventListener("change", () => {
      void renderAdmin();
    });
  });

  const bulkActionsBar = document.getElementById("bulkActionsBar");
  const bulkSelectedCount = document.getElementById("bulkSelectedCount");
  const selectedThreadIds = new Set();

  const selectAllCheckbox = document.getElementById("selectAllThreads");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", (e) => {
      const checkboxes = controlRows.querySelectorAll(".bulk-checkbox");
      checkboxes.forEach((cb) => {
        const id = cb.getAttribute("data-id");
        if (id) {
          cb.checked = e.target.checked;
          if (e.target.checked) {
            selectedThreadIds.add(id);
          } else {
            selectedThreadIds.delete(id);
          }
        }
      });
      updateBulkBar();
    });
  }

  function updateBulkBar() {
    if (!bulkActionsBar || !bulkSelectedCount) return;
    const count = selectedThreadIds.size;
    bulkSelectedCount.textContent = String(count);
    if (count > 0) {
      bulkActionsBar.classList.remove("hidden-block");
    } else {
      bulkActionsBar.classList.add("hidden-block");
    }
  }

  controlRows.addEventListener("change", (e) => {
    if (e.target.classList.contains("bulk-checkbox")) {
      const id = e.target.getAttribute("data-id");
      if (id) {
        if (e.target.checked) {
          selectedThreadIds.add(id);
        } else {
          selectedThreadIds.delete(id);
        }
        updateBulkBar();
      }
    }
  });

  controlRows.addEventListener("click", (e) => {
    if (e.target.tagName === "INPUT" && e.target.classList.contains("bulk-checkbox")) {
      return;
    }
  });

  const downloadCsvBtn = document.getElementById("downloadCsv");
  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener("click", async () => {
      try {
        const [posts, comments] = await Promise.all([api.getPosts(), api.getComments()]);

        const rows = [
          ["ID", "Title", "Body", "Category", "Author", "Created At", "Replies"],
          ...posts.map((p) => [
            p.id,
            `"${(p.title || "").replace(/"/g, '""')}"`,
            `"${(p.body || "").replace(/"/g, '""')}"`,
            p.category || "",
            p.author_name || "",
            p.created_at || "",
            String(comments.filter((c) => c.post_id === p.id).length)
          ])
        ];

        const csv = rows.map((r) => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `polly-fourms-threads-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showPageNotice("CSV exported successfully.", "success", 3000);
      } catch (err) {
        showPageNotice(`Export failed: ${err.message}`, "error", 5000);
      }
    });
  }

  if (bulkActionsBar) {
    bulkActionsBar.addEventListener("click", async (e) => {
      if (e.target.tagName !== "BUTTON") return;
      const action = e.target.getAttribute("data-bulk-action");
      if (!action || selectedThreadIds.size === 0) return;

      const ids = [...selectedThreadIds];
      const confirmed = confirm(`Apply "${action}" to ${ids.length} selected thread(s)?`);
      if (!confirmed) return;

      try {
        for (const id of ids) {
          if (action === "delete") {
            await api.deletePost(id);
            await safeLog("bulk_delete", "post", id, {});
          } else if (action === "hide") {
            await api.updatePost(id, { is_hidden: true, hidden_reason: "Bulk hidden by admin" });
            await safeLog("bulk_hide", "post", id, {});
          }
        }
        selectedThreadIds.clear();
        updateBulkBar();
        await renderAdmin();
        showPageNotice(`Bulk ${action} completed for ${ids.length} threads.`, "success", 3000);
      } catch (err) {
        showPageNotice(`Bulk action failed: ${err.message}`, "error", 5000);
      }
    });
  }

  try {
    await renderAdmin();
    await renderActivityLog();
  } catch (error) {
    adminStatus.textContent = `Admin backend not ready: ${error.message || String(error)}`;
    adminContent.classList.add("hidden-block");
  }

  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener("click", () => {
      void renderActivityLog();
    });
  }

  if (userActivitySearch) {
    userActivitySearch.addEventListener("input", () => {
      void renderActivityLog();
    });
  }

  const autoRefreshToggle = document.getElementById("autoRefreshToggle");
  const manualRefreshBtn = document.getElementById("manualRefresh");
  let autoRefreshInterval = null;

  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener("change", (e) => {
      if (e.target.checked) {
        autoRefreshInterval = setInterval(async () => {
          await renderAdmin();
          await renderActivityLog();
        }, 30000);
        showPageNotice("Auto-refresh enabled (every 30s).", "info", 2000);
      } else if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        showPageNotice("Auto-refresh disabled.", "info", 2000);
      }
    });
  }

  if (manualRefreshBtn) {
    manualRefreshBtn.addEventListener("click", async () => {
      await renderAdmin();
      await renderActivityLog();
      showPageNotice("Data refreshed.", "success", 1500);
    });
  }
})();
