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

  function getEmailRedirectUrl() {
    const url = new URL("auth.html", window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function clearAuthInputs() {
    registerEmail.value = "";
    registerPassword.value = "";
    loginEmail.value = "";
    loginPassword.value = "";
  }

  function unlockReadOnlyOnFocus(input) {
    input.addEventListener("focus", () => {
      input.removeAttribute("readonly");
    });
    input.addEventListener("blur", () => {
      if (!input.value) {
        input.setAttribute("readonly", "readonly");
      }
    });
  }

  if (!client) {
    statusEl.textContent = "Supabase is not configured yet.";
    return;
  }

  clearAuthInputs();
  setTimeout(clearAuthInputs, 80);
  setTimeout(clearAuthInputs, 400);
  setTimeout(clearAuthInputs, 1200);

  [registerEmail, registerPassword, loginEmail, loginPassword].forEach(unlockReadOnlyOnFocus);

  window.addEventListener("focus", clearAuthInputs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      clearAuthInputs();
    }
  });

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
      const { error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getEmailRedirectUrl()
        }
      });
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

      const profile = await window.PollyCommon.fetchMyProfile();
      if (!profile || !profile.display_name) {
        window.location.replace("profile.html?setup=1");
        return;
      }

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
