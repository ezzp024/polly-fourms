(async function () {
  const statusEl = document.getElementById("authStatus");
  const registerForm = document.getElementById("registerForm");
  const resendForm = document.getElementById("resendForm");
  const registerBlock = document.getElementById("registerBlock");
  const loginForm = document.getElementById("loginForm");
  const registerEmail = document.getElementById("registerEmail");
  const registerPassword = document.getElementById("registerPassword");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const resendEmail = document.getElementById("resendEmail");

  const client = window.PollyCommon.createAuthClient();
  const allowRegistration = (window.POLLY_CONFIG || {}).allowRegistration !== false;

  const params = new URLSearchParams(window.location.search);
  const next = window.PollyCommon.sanitizeNextPath(params.get("next") || "index.html");

  function getEmailRedirectUrl() {
    const url = new URL("auth.html", window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function getHashParams() {
    const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    return new URLSearchParams(raw);
  }

  if (!client) {
    statusEl.textContent = "Supabase is not configured yet.";
    return;
  }

  if (!allowRegistration && registerBlock) {
    registerBlock.style.display = "none";
    if (resendForm) {
      resendForm.style.display = "none";
    }
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

  function authMessage(error, fallback) {
    const raw = String((error && error.message) || error || fallback || "Request failed");
    const lower = raw.toLowerCase();
    if (lower.includes("invalid login credentials")) {
      return "Login failed: invalid email or password.";
    }
    if (lower.includes("email not confirmed") || lower.includes("email_not_confirmed")) {
      return "Login failed: email is not verified yet. Use resend verification.";
    }
    if (lower.includes("rate limit") || lower.includes("over_email_send_rate_limit")) {
      return "Request blocked: email rate limit exceeded. Please wait and retry.";
    }
    if (lower.includes("password should be at least") || lower.includes("weak password")) {
      return "Register failed: choose a stronger password (10+ characters).";
    }
    return `${fallback || "Request failed"}: ${raw}`;
  }

  async function waitForUser(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const user = await window.PollyCommon.getAuthUser();
      if (user) return user;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  async function handleVerificationLanding() {
    const hash = getHashParams();
    const type = hash.get("type");
    const errorDescription = hash.get("error_description");

    if (errorDescription) {
      statusEl.textContent = `Verification failed: ${decodeURIComponent(errorDescription)}`;
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
      return;
    }

    if (!type) return;

    await refreshStatus();

    if (type === "signup") {
      statusEl.textContent = "Email verified successfully. You can now log in.";
    } else if (type === "recovery") {
      statusEl.textContent = "Recovery link accepted. Continue with account access.";
    }

    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!allowRegistration) {
      statusEl.textContent = "Registration is disabled. Contact an administrator.";
      return;
    }

    const email = String(registerEmail.value || "").trim();
    const password = String(registerPassword.value || "");

    if (password.length < 10) {
      statusEl.textContent = "Register failed: password must be at least 10 characters.";
      return;
    }

    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getEmailRedirectUrl()
        }
      });
      if (error) throw error;

      if (data && data.session) {
        statusEl.textContent = "Account created and logged in.";
        await refreshStatus();
        return;
      }

      statusEl.textContent = "Registration submitted. Check your email and click the verification link.";
      resendEmail.value = email;
    } catch (error) {
      statusEl.textContent = authMessage(error, "Register failed");
    }
  });

  resendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(resendEmail.value || "").trim();
    if (!email) return;

    try {
      const { error } = await client.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: getEmailRedirectUrl()
        }
      });
      if (error) throw error;
      statusEl.textContent = "Verification email resent. Please check inbox/spam.";
    } catch (error) {
      statusEl.textContent = authMessage(error, "Resend failed");
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(loginEmail.value || "").trim();
    const password = String(loginPassword.value || "");

    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const user = (data && data.user) || (await waitForUser(6000));
      if (!user) {
        throw new Error("Login succeeded but session is not ready yet. Please try again.");
      }

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

      if (!isAdmin && next === "admin.html") {
        statusEl.textContent = "Admin access denied for this account.";
        window.location.replace("index.html");
        return;
      }

      if (next && next !== "admin.html") {
        window.location.replace(next);
      }
    } catch (error) {
      statusEl.textContent = authMessage(error, "Login failed");
    }
  });

  document.getElementById("checkSession").addEventListener("click", () => {
    void refreshStatus();
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await client.auth.signOut();
    document.body.classList.remove("is-admin");
    statusEl.textContent = "Logged out.";
    if (window.PollyCommon && window.PollyCommon.refreshSessionNav) {
      await window.PollyCommon.refreshSessionNav();
    }
  });

  await refreshStatus();
  await handleVerificationLanding();

  client.auth.onAuthStateChange(async (eventName) => {
    if (eventName === "SIGNED_IN") {
      await refreshStatus();
    } else if (eventName === "SIGNED_OUT") {
      document.body.classList.remove("is-admin");
      statusEl.textContent = "Session ended.";
      if (window.PollyCommon && window.PollyCommon.refreshSessionNav) {
        await window.PollyCommon.refreshSessionNav();
      }
    } else if (eventName === "TOKEN_REFRESHED") {
      await refreshStatus();
    }
  });
})();
