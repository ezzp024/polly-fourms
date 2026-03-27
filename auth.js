(async function () {
  const statusEl = document.getElementById("authStatus");
  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  const registerEmail = document.getElementById("registerEmail");
  const registerPassword = document.getElementById("registerPassword");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");

  const client = window.PollyCommon.createAuthClient();

  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") || "index.html";

  if (!client) {
    statusEl.textContent = "Supabase is not configured yet.";
    return;
  }

  async function refreshStatus() {
    const user = await window.PollyCommon.getAuthUser();
    if (!user) {
      statusEl.textContent = "No user logged in.";
      return;
    }

    const email = String(user.email || "");
    const isAdmin = await window.PollyCommon.hasAdminSession();
    document.body.classList.toggle("is-admin", isAdmin);
    statusEl.textContent = isAdmin
      ? `Logged in as ${email} (admin verified).`
      : `Logged in as ${email}.`;
  }

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(registerEmail.value || "").trim();
    const password = String(registerPassword.value || "");

    try {
      const { error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      statusEl.textContent = "Registration submitted. Check your email if confirmation is required.";
      await refreshStatus();
    } catch (error) {
      statusEl.textContent = `Register failed: ${error.message || String(error)}`;
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(loginEmail.value || "").trim();
    const password = String(loginPassword.value || "");

    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await refreshStatus();

      const isAdmin = await window.PollyCommon.hasAdminSession();
      if (isAdmin && next === "admin.html") {
        window.location.replace("admin.html");
        return;
      }

      if (next && next !== "admin.html") {
        window.location.replace(next);
      }
    } catch (error) {
      statusEl.textContent = `Login failed: ${error.message || String(error)}`;
    }
  });

  document.getElementById("checkSession").addEventListener("click", () => {
    void refreshStatus();
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await client.auth.signOut();
    document.body.classList.remove("is-admin");
    statusEl.textContent = "Logged out.";
  });

  await refreshStatus();
})();
