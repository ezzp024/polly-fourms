(async function () {
  const {
    initIdentityForm,
    getCurrentRole,
    getNickname,
    formatDate,
    profileLink,
    escapeHtml
  } = window.PollyCommon;

  const api = window.PollyApi.createApi();

  initIdentityForm();

  const adminStatus = document.getElementById("adminStatus");
  const adminDenied = document.getElementById("adminDenied");
  const adminContent = document.getElementById("adminContent");
  const reportRows = document.getElementById("reportRows");
  const hiddenRows = document.getElementById("hiddenRows");
  const controlRows = document.getElementById("controlRows");

  const role = getCurrentRole();
  const canModerate = role === "admin" || role === "moderator";

  adminStatus.textContent = canModerate
    ? `Signed in as ${role} (${getNickname()}).`
    : "You do not have moderator permission.";

  if (!canModerate) {
    adminDenied.classList.remove("hidden-block");
    adminContent.classList.add("hidden-block");
    return;
  }

  adminDenied.classList.add("hidden-block");
  adminContent.classList.remove("hidden-block");

  async function load() {
    const [posts, reports] = await Promise.all([api.getPosts(), api.getReports()]);
    const byId = new Map(posts.map((post) => [post.id, post]));

    const openReports = reports.filter((r) => r.status !== "resolved");
    reportRows.innerHTML = openReports.length
      ? openReports
          .map((report) => {
            const post = byId.get(report.post_id);
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

    const hiddenPosts = posts.filter((p) => p.is_hidden);
    hiddenRows.innerHTML = hiddenPosts.length
      ? hiddenPosts
          .map(
            (post) => `
              <tr>
                <td><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></td>
                <td>${escapeHtml(post.hidden_reason || "No reason")}</td>
                <td><button type="button" data-action="unhide" data-id="${post.id}">Unhide</button></td>
              </tr>
            `
          )
          .join("")
      : '<tr><td colspan="3" class="muted">No hidden threads.</td></tr>';

    const latestPosts = posts.slice(0, 60);
    controlRows.innerHTML = latestPosts.length
      ? latestPosts
          .map((post) => {
            const flags = [post.is_pinned ? "Pinned" : null, post.is_sticky ? "Sticky" : null, post.is_hidden ? "Hidden" : null]
              .filter(Boolean)
              .join(", ");
            return `
              <tr>
                <td><a href="thread.html?id=${post.id}">${escapeHtml(post.title)}</a></td>
                <td>${flags || "None"}</td>
                <td>
                  <button type="button" data-action="pin" data-id="${post.id}" data-state="${post.is_pinned ? "1" : "0"}">${post.is_pinned ? "Unpin" : "Pin"}</button>
                  <button type="button" data-action="sticky" data-id="${post.id}" data-state="${post.is_sticky ? "1" : "0"}">${post.is_sticky ? "Unsticky" : "Sticky"}</button>
                  <button type="button" data-action="hide" data-id="${post.id}" data-state="${post.is_hidden ? "1" : "0"}">${post.is_hidden ? "Unhide" : "Hide"}</button>
                </td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="3" class="muted">No threads yet.</td></tr>';
  }

  function findButton(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;
    if (target.tagName !== "BUTTON") return null;
    return target;
  }

  async function handleAction(event) {
    const button = findButton(event);
    if (!button) return;

    const id = button.getAttribute("data-id");
    const action = button.getAttribute("data-action");
    const state = button.getAttribute("data-state") === "1";
    if (!id || !action) return;

    try {
      if (action === "resolve-report") {
        await api.resolveReport(id, getNickname() || "moderator");
      }

      if (action === "unhide") {
        await api.updatePost(id, { is_hidden: false, hidden_reason: "" });
      }

      if (action === "pin") {
        await api.updatePost(id, { is_pinned: !state });
      }

      if (action === "sticky") {
        await api.updatePost(id, { is_sticky: !state });
      }

      if (action === "hide") {
        const hideNow = !state;
        let reason = "";
        if (hideNow) {
          reason = prompt("Reason for hiding this thread:", "Needs moderator review") || "Needs moderator review";
        }
        await api.updatePost(id, { is_hidden: hideNow, hidden_reason: hideNow ? reason : "" });
      }

      await load();
    } catch (error) {
      alert(`Moderation action failed: ${error.message || String(error)}`);
    }
  }

  reportRows.addEventListener("click", handleAction);
  hiddenRows.addEventListener("click", handleAction);
  controlRows.addEventListener("click", handleAction);

  try {
    await load();
  } catch (error) {
    adminStatus.textContent = `Could not load moderation data: ${escapeHtml(error.message || String(error))}`;
  }
})();
