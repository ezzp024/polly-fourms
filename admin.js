(async function () {
  const CONFIG = window.POLLY_CONFIG || {};
  const {
    initIdentityForm,
    getNickname,
    formatDate,
    profileLink,
    escapeHtml,
    buildMemberStats,
    toHandle,
    rankFromScore
  } = window.PollyCommon;

  initIdentityForm();

  const api = window.PollyApi.createApi({ authStorageKey: "polly_admin_primary" });
  const adminStatus = document.getElementById("adminStatus");
  const authPanel = document.getElementById("authPanel");
  const adminContent = document.getElementById("adminContent");
  const adminStats = document.getElementById("adminStats");
  const reportRows = document.getElementById("reportRows");
  const controlRows = document.getElementById("controlRows");
  const userRows = document.getElementById("userRows");
  const banRows = document.getElementById("banRows");

  const adminEmailHash = String(CONFIG.adminEmailHash || "").toLowerCase();
  const secondaryEmailHash = String(CONFIG.secondaryAdminEmailHash || "").toLowerCase();

  const primaryEmail = document.getElementById("primaryEmail");
  const secondaryInput = document.getElementById("secondaryEmail");

  const PRIMARY_HASH_KEY = "polly_admin_primary_email";

  const canUseSupabaseAuth =
    window.supabase &&
    typeof CONFIG.supabaseUrl === "string" &&
    CONFIG.supabaseUrl &&
    typeof CONFIG.supabaseAnonKey === "string" &&
    CONFIG.supabaseAnonKey;

  const primaryClient = canUseSupabaseAuth
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { storageKey: "polly_admin_primary" } })
    : null;

  const secondaryClient = canUseSupabaseAuth
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { storageKey: "polly_admin_secondary" } })
    : null;

  const FACTOR_KEY = "polly_admin_factor2";

  async function sha256(input) {
    if (!window.crypto || !window.crypto.subtle) return "";
    const bytes = new TextEncoder().encode(String(input || "").trim().toLowerCase());
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function setPrimaryHash(hash) {
    if (hash) {
      sessionStorage.setItem(PRIMARY_HASH_KEY, hash);
    } else {
      sessionStorage.removeItem(PRIMARY_HASH_KEY);
    }
  }

  function getPrimaryHash() {
    return String(sessionStorage.getItem(PRIMARY_HASH_KEY) || "").toLowerCase();
  }

  function setSecondaryVerified(value) {
    if (value) {
      sessionStorage.setItem(FACTOR_KEY, String(Date.now()));
    } else {
      sessionStorage.removeItem(FACTOR_KEY);
    }
  }

  function isSecondaryVerified() {
    const raw = sessionStorage.getItem(FACTOR_KEY);
    if (!raw) return false;
    const ageMs = Date.now() - Number(raw);
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 1000 * 60 * 30;
  }

  async function getPrimaryUser() {
    if (!primaryClient) return null;
    const { data, error } = await primaryClient.auth.getUser();
    if (error) return null;
    return data.user || null;
  }

  async function isAdminSessionValid() {
    const user = await getPrimaryUser();
    if (!user) return false;
    const email = String(user.email || "").toLowerCase();
    const hash = await sha256(email);
    return hash === adminEmailHash && getPrimaryHash() === adminEmailHash && isSecondaryVerified();
  }

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

    if (action === "resolve-report") {
      await api.resolveReport(id, nickname);
      return;
    }

    if (action === "pin") {
      await api.updatePost(id, { is_pinned: !state });
      return;
    }

    if (action === "sticky") {
      await api.updatePost(id, { is_sticky: !state });
      return;
    }

    if (action === "hide") {
      const nextHidden = !state;
      let reason = "";
      if (nextHidden) {
        reason = prompt("Reason for hiding thread:", "Needs moderator review") || "Needs moderator review";
      }
      await api.updatePost(id, { is_hidden: nextHidden, hidden_reason: nextHidden ? reason : "" });
      return;
    }

    if (action === "remove-link") {
      await api.clearPostLink(id);
      return;
    }

    if (action === "delete-thread") {
      if (!confirm("Delete this thread permanently?")) return;
      await api.deletePost(id);
      return;
    }

    if (action === "ban-user") {
      const reason = prompt("Ban reason:", "Policy violation") || "Policy violation";
      await api.banUser(toHandle(rawUser), reason, nickname);
      return;
    }

    if (action === "remove-user-content") {
      if (!confirm(`Remove all posts/comments by ${rawUser}?`)) return;
      await api.deletePostsByAuthor(rawUser);
      await api.deleteCommentsByAuthor(rawUser);
      await api.banUser(toHandle(rawUser), "Removed by administrator", nickname);
      return;
    }

    if (action === "unban") {
      await api.unbanUser(id);
    }
  }

  function getButton(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;
    if (target.tagName !== "BUTTON") return null;
    return target;
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

  async function updateGate() {
    if (!canUseSupabaseAuth || !adminEmailHash || !secondaryEmailHash) {
      adminStatus.textContent = "Admin auth is not configured correctly.";
      authPanel.classList.remove("hidden-block");
      adminContent.classList.add("hidden-block");
      return;
    }

    const valid = await isAdminSessionValid();
    if (!valid) {
      adminStatus.textContent = "Admin locked. Complete both OTP steps.";
      authPanel.classList.remove("hidden-block");
      adminContent.classList.add("hidden-block");
      document.body.classList.remove("is-admin");
      return;
    }

    adminStatus.textContent = "Admin unlocked. Full control enabled.";
    authPanel.classList.add("hidden-block");
    adminContent.classList.remove("hidden-block");
    document.body.classList.add("is-admin");
    await renderAdmin();
  }

  async function sendOtp(client, email) {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true
      }
    });
    if (error) throw error;
  }

  async function verifyOtp(client, email, token) {
    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email"
    });
    if (error) throw error;
    return data.user || null;
  }

  document.getElementById("primarySendForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(primaryEmail.value || "").trim().toLowerCase();
    const hash = await sha256(email);
    if (!email || hash !== adminEmailHash) {
      alert("Access denied.");
      return;
    }
    try {
      await sendOtp(primaryClient, email);
      alert("OTP sent.");
    } catch (error) {
      alert("Could not send OTP.");
    }
  });

  document.getElementById("primaryVerifyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(primaryEmail.value || "").trim().toLowerCase();
    const emailHash = await sha256(email);
    if (!email || emailHash !== adminEmailHash) {
      alert("Access denied.");
      return;
    }
    const token = String(document.getElementById("primaryOtp").value || "").trim();
    if (!token) return;
    try {
      const user = await verifyOtp(primaryClient, email, token);
      const verifiedEmail = String((user && user.email) || "").toLowerCase();
      const verifiedHash = await sha256(verifiedEmail);
      if (verifiedHash !== adminEmailHash) {
        throw new Error("Access denied");
      }
      setPrimaryHash(verifiedHash);
      alert("Step 1 verified.");
      await updateGate();
    } catch (error) {
      alert("Could not verify primary OTP.");
    }
  });

  document.getElementById("secondarySendForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(secondaryInput.value || "").trim().toLowerCase();
    const hash = await sha256(email);
    if (!email || hash !== secondaryEmailHash || getPrimaryHash() !== adminEmailHash) {
      alert("Access denied.");
      return;
    }
    try {
      await sendOtp(secondaryClient, email);
      alert("OTP sent.");
    } catch (error) {
      alert("Could not send secondary OTP.");
    }
  });

  document.getElementById("secondaryVerifyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(secondaryInput.value || "").trim().toLowerCase();
    const emailHash = await sha256(email);
    if (!email || emailHash !== secondaryEmailHash || getPrimaryHash() !== adminEmailHash) {
      alert("Access denied.");
      return;
    }
    const token = String(document.getElementById("secondaryOtp").value || "").trim();
    if (!token) return;
    try {
      const user = await verifyOtp(secondaryClient, email, token);
      const verifiedEmail = String((user && user.email) || "").toLowerCase();
      const verifiedHash = await sha256(verifiedEmail);
      if (verifiedHash !== secondaryEmailHash) {
        throw new Error("Access denied");
      }
      setSecondaryVerified(true);
      await secondaryClient.auth.signOut();
      alert("Step 2 verified.");
      await updateGate();
    } catch (error) {
      alert("Could not verify secondary OTP.");
    }
  });

  document.getElementById("refreshSession").addEventListener("click", () => {
    void updateGate();
  });

  document.getElementById("logoutAdmin").addEventListener("click", async () => {
    if (primaryClient) {
      await primaryClient.auth.signOut();
    }
    if (secondaryClient) {
      await secondaryClient.auth.signOut();
    }
    setSecondaryVerified(false);
    setPrimaryHash("");
    await updateGate();
  });

  reportRows.addEventListener("click", handleTableActions);
  controlRows.addEventListener("click", handleTableActions);
  userRows.addEventListener("click", handleTableActions);
  banRows.addEventListener("click", handleTableActions);

  await updateGate();
})();
