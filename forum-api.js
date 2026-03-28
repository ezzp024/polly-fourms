(function () {
  const CONFIG = window.POLLY_CONFIG || { supabaseUrl: "", supabaseAnonKey: "" };

  function sanitizeInput(input) {
    if (input == null) return "";
    return String(input)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .slice(0, 10000);
  }

  function sanitizePostInput(post) {
    if (!post || typeof post !== "object") return {};
    return {
      title: sanitizeInput(post.title),
      body: sanitizeInput(post.body),
      category: sanitizeInput(post.category),
      software_url: post.software_url ? sanitizeInput(post.software_url).slice(0, 500) : null,
      tags: Array.isArray(post.tags) ? post.tags.map((t) => sanitizeInput(t)).slice(0, 10) : [],
      author_name: sanitizeInput(post.author_name)
    };
  }

  function sanitizeCommentInput(comment) {
    if (!comment || typeof comment !== "object") return {};
    return {
      post_id: comment.post_id,
      body: sanitizeInput(comment.body),
      author_name: sanitizeInput(comment.author_name)
    };
  }

  function sanitizeReportInput(report) {
    if (!report || typeof report !== "object") return {};
    return {
      post_id: report.post_id,
      reason: sanitizeInput(report.reason).slice(0, 500),
      reporter_name: sanitizeInput(report.reporter_name)
    };
  }

  function friendlyError(error, fallback) {
    const message = String((error && (error.message || error.details || error.hint)) || fallback || "Request failed");
    const lower = message.toLowerCase();

    if (lower.includes("row-level security") || lower.includes("permission denied") || lower.includes("not authorized")) {
      return "Permission denied for this action.";
    }
    if (lower.includes("only admins can change moderation fields")) {
      return "Permission denied for this action.";
    }
    if (lower.includes("author identity cannot be changed") || lower.includes("author name cannot be changed")) {
      return "Permission denied for this action.";
    }
    if (lower.includes("rate") || lower.includes("too many") || lower.includes("flood")) {
      return "Rate limit reached. Please wait and try again.";
    }
    if (lower.includes("locked")) {
      return "This thread is locked.";
    }
    if (lower.includes("banned")) {
      return "Your account is banned from this action.";
    }
    if (lower.includes("safe") || lower.includes("unsafe") || lower.includes("url")) {
      return "Link is not allowed. Use a safe HTTPS link.";
    }
    if (lower.includes("display name is already in use")) {
      return "Display name is already in use. Choose a different one.";
    }
    return message;
  }

  function withPostDefaults(post) {
    return {
      is_pinned: false,
      is_sticky: false,
      is_hidden: false,
      is_locked: false,
      is_solved: false,
      hidden_reason: "",
      ...post
    };
  }

  function normalizeUrlDomain(rawUrl) {
    const value = String(rawUrl || "").trim().toLowerCase();
    if (!value) return "";
    try {
      const parsed = new URL(value);
      return parsed.hostname || "";
    } catch {
      return value.replace(/^https?:\/\//, "").split("/")[0] || "";
    }
  }

  class LocalBackend {
    constructor() {
      this.postKey = "polly_posts";
      this.commentKey = "polly_comments";
      this.reportKey = "polly_reports";
      this.banKey = "polly_bans";
      this.friendKey = "polly_friendships";
      this.downloadSubmissionKey = "polly_download_submissions";
      this.blockedDomainKey = "polly_blocked_domains";
    }

    _load(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || "[]");
      } catch {
        return [];
      }
    }

    _save(key, data) {
      localStorage.setItem(key, JSON.stringify(data));
    }

    async getPosts() {
      return this._load(this.postKey)
        .map(withPostDefaults)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }

    async getPostById(id) {
      const item = this._load(this.postKey).find((p) => p.id === id) || null;
      return item ? withPostDefaults(item) : null;
    }

    async getComments() {
      return this._load(this.commentKey).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    }

    async getReports() {
      return this._load(this.reportKey).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }

    async getBannedUsers() {
      return this._load(this.banKey);
    }

    async getMyFriends() {
      const me = String(window.PollyCommon?.getNickname?.() || "").trim();
      if (!me) return [];
      const meNorm = me.toLowerCase();
      const rows = this._load(this.friendKey).filter((row) => {
        if (row.status && row.status !== "accepted") return false;
        const a = String(row.requester_name || "").trim().toLowerCase();
        const b = String(row.addressee_name || "").trim().toLowerCase();
        return a === meNorm || b === meNorm;
      });
      const names = new Set();
      for (const row of rows) {
        const a = String(row.requester_name || "").trim();
        const b = String(row.addressee_name || "").trim();
        const aNorm = a.toLowerCase();
        const bNorm = b.toLowerCase();
        if (aNorm === meNorm && b) names.add(b);
        if (bNorm === meNorm && a) names.add(a);
      }
      return [...names].sort((x, y) => x.localeCompare(y));
    }

    async getIncomingFriendRequests() {
      const me = String(window.PollyCommon?.getNickname?.() || "").trim().toLowerCase();
      if (!me) return [];
      return this._load(this.friendKey)
        .filter((row) => String(row.addressee_name || "").trim().toLowerCase() === me && row.status === "pending")
        .map((row) => ({ id: row.id, from: row.requester_name, created_at: row.created_at }))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }

    async addFriend(friendName) {
      const me = String(window.PollyCommon?.getNickname?.() || "").trim();
      const target = String(friendName || "").trim();
      if (!me) throw new Error("Set your display name first.");
      if (!target) throw new Error("Friend name is required.");
      if (me.toLowerCase() === target.toLowerCase()) throw new Error("You cannot add yourself.");

      const rows = this._load(this.friendKey);
      const meNorm = me.toLowerCase();
      const targetNorm = target.toLowerCase();
      const exists = rows.some((row) => {
        const a = String(row.requester_name || "").trim().toLowerCase();
        const b = String(row.addressee_name || "").trim().toLowerCase();
        return (a === meNorm && b === targetNorm) || (a === targetNorm && b === meNorm);
      });
      if (exists) throw new Error("Friend request already exists for this member.");

      rows.push({
        id: crypto.randomUUID(),
        requester_name: me,
        addressee_name: target,
        status: "pending",
        created_at: new Date().toISOString()
      });
      this._save(this.friendKey, rows);
    }

    async acceptFriendRequest(friendName) {
      const me = String(window.PollyCommon?.getNickname?.() || "").trim().toLowerCase();
      const requester = String(friendName || "").trim().toLowerCase();
      if (!me || !requester) throw new Error("Friend name is required.");
      const rows = this._load(this.friendKey);
      const idx = rows.findIndex((row) => {
        return String(row.requester_name || "").trim().toLowerCase() === requester
          && String(row.addressee_name || "").trim().toLowerCase() === me
          && row.status === "pending";
      });
      if (idx < 0) throw new Error("Friend request not found.");
      rows[idx] = { ...rows[idx], status: "accepted", accepted_at: new Date().toISOString() };
      this._save(this.friendKey, rows);
    }

    async removeFriend(friendName) {
      const me = String(window.PollyCommon?.getNickname?.() || "").trim();
      const target = String(friendName || "").trim();
      if (!me || !target) return;

      const meNorm = me.toLowerCase();
      const targetNorm = target.toLowerCase();
      const rows = this._load(this.friendKey).filter((row) => {
        const a = String(row.requester_name || "").trim().toLowerCase();
        const b = String(row.addressee_name || "").trim().toLowerCase();
        return !((a === meNorm && b === targetNorm) || (a === targetNorm && b === meNorm));
      });
      this._save(this.friendKey, rows);
    }

    async isNicknameBanned(name) {
      const bans = await this.getBannedUsers();
      const normalized = String(name || "").trim().toLowerCase();
      return bans.some((b) => String(b.nickname || "").trim().toLowerCase() === normalized && b.active !== false);
    }

    async createPost(post) {
      const user = await this.getCurrentUser();
      const posts = this._load(this.postKey);
      const clean = sanitizePostInput(post);
      const postId = crypto.randomUUID();
      const submittedUrl = clean.software_url ? String(clean.software_url).trim() : "";
      posts.push(
        withPostDefaults({
          id: postId,
          ...clean,
          software_url: null,
          author_user_id: user?.id || null,
          created_at: new Date().toISOString()
        })
      );
      this._save(this.postKey, posts);

      if (submittedUrl) {
        const me = String(window.PollyCommon?.getNickname?.() || clean.author_name || "").trim();
        const rows = this._load(this.downloadSubmissionKey).filter((row) => row.post_id !== postId);
        rows.push({
          id: crypto.randomUUID(),
          post_id: postId,
          submitted_by_user_id: user?.id || null,
          submitted_by_name: me,
          submitted_url: submittedUrl,
          status: "pending",
          security_check_status: "pending",
          security_check_notes: "",
          reviewed_by: null,
          reviewed_at: null,
          created_at: new Date().toISOString()
        });
        this._save(this.downloadSubmissionKey, rows);
      }
    }

    async updatePost(postId, patch) {
      const posts = this._load(this.postKey);
      const index = posts.findIndex((p) => p.id === postId);
      if (index < 0) throw new Error("Post not found");
      posts[index] = withPostDefaults({ ...posts[index], ...patch });
      this._save(this.postKey, posts);
    }

    async deletePost(postId) {
      const posts = this._load(this.postKey).filter((p) => p.id !== postId);
      this._save(this.postKey, posts);
      const comments = this._load(this.commentKey).filter((c) => c.post_id !== postId);
      this._save(this.commentKey, comments);
    }

    async clearPostLink(postId) {
      await this.updatePost(postId, { software_url: null });
      const rows = this._load(this.downloadSubmissionKey).filter((row) => row.post_id !== postId);
      this._save(this.downloadSubmissionKey, rows);
    }

    async getPendingDownloadLinks() {
      const posts = this._load(this.postKey);
      const byPostId = new Map(posts.map((p) => [p.id, p]));
      return this._load(this.downloadSubmissionKey)
        .filter((row) => row.status === "pending")
        .map((row) => ({
          ...row,
          post_title: byPostId.get(row.post_id)?.title || "Unknown thread"
        }))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    }

    async reviewDownloadLink(submissionId, decision, reviewedBy, securityNotes) {
      const rows = this._load(this.downloadSubmissionKey);
      const idx = rows.findIndex((row) => row.id === submissionId && row.status === "pending");
      if (idx < 0) throw new Error("Pending download submission not found.");

      const notes = String(securityNotes || "").trim();
      if (notes.length < 8) throw new Error("Security review notes are required.");

      const nextStatus = decision === "approved" ? "approved" : "rejected";
      rows[idx] = {
        ...rows[idx],
        status: nextStatus,
        security_check_status: nextStatus === "approved" ? "passed" : "failed",
        security_check_notes: notes,
        reviewed_by: reviewedBy || "admin",
        reviewed_at: new Date().toISOString()
      };
      this._save(this.downloadSubmissionKey, rows);

      if (nextStatus === "approved") {
        await this.updatePost(rows[idx].post_id, { software_url: rows[idx].submitted_url });
      } else {
        await this.updatePost(rows[idx].post_id, { software_url: null });
      }
    }

    async banDownloadDomain(domain) {
      const clean = normalizeUrlDomain(domain);
      if (!clean) throw new Error("Domain is required.");
      const rows = this._load(this.blockedDomainKey);
      if (!rows.includes(clean)) {
        rows.push(clean);
        this._save(this.blockedDomainKey, rows);
      }
    }

    async deletePostsByAuthor(name) {
      const posts = this._load(this.postKey);
      const authorIds = posts.filter((p) => p.author_name === name).map((p) => p.id);
      this._save(
        this.postKey,
        posts.filter((p) => p.author_name !== name)
      );
      const comments = this._load(this.commentKey).filter((c) => !authorIds.includes(c.post_id));
      this._save(this.commentKey, comments);
    }

    async createComment(comment) {
      const user = await this.getCurrentUser();
      const comments = this._load(this.commentKey);
      comments.push({ id: crypto.randomUUID(), ...comment, author_user_id: user?.id || null, created_at: new Date().toISOString() });
      this._save(this.commentKey, comments);
    }

    async deleteComment(commentId) {
      const comments = this._load(this.commentKey).filter((c) => c.id !== commentId);
      this._save(this.commentKey, comments);
    }

    async updateComment(commentId, body) {
      const comments = this._load(this.commentKey);
      const index = comments.findIndex((c) => c.id === commentId);
      if (index < 0) throw new Error("Comment not found");
      const clean = String(body || "").trim().slice(0, 500);
      if (!clean) throw new Error("Comment body is required.");
      comments[index] = { ...comments[index], body: clean };
      this._save(this.commentKey, comments);
    }

    async deleteCommentsByAuthor(name) {
      this._save(
        this.commentKey,
        this._load(this.commentKey).filter((c) => c.author_name !== name)
      );
    }

    async createReport(report) {
      const reports = this._load(this.reportKey);
      reports.push({
        id: crypto.randomUUID(),
        post_id: report.post_id,
        reason: report.reason,
        reporter_name: report.reporter_name,
        status: "open",
        created_at: new Date().toISOString(),
        resolved_at: null,
        resolved_by: null
      });
      this._save(this.reportKey, reports);
    }

    async createModerationLog(action, targetType, targetId, details) {
      const key = "polly_moderation_logs";
      const rows = this._load(key);
      rows.push({
        id: crypto.randomUUID(),
        action,
        target_type: targetType,
        target_id: targetId || null,
        actor_email: "local",
        details: details || {},
        created_at: new Date().toISOString()
      });
      this._save(key, rows);
    }

    async resolveReport(reportId, resolverName) {
      const reports = this._load(this.reportKey);
      const index = reports.findIndex((r) => r.id === reportId);
      if (index < 0) throw new Error("Report not found");
      reports[index] = {
        ...reports[index],
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: resolverName
      };
      this._save(this.reportKey, reports);
    }

    async banUser(nickname, reason, bannedBy) {
      const bans = this._load(this.banKey);
      bans.push({
        id: crypto.randomUUID(),
        nickname,
        reason: reason || "Policy violation",
        banned_by: bannedBy || "admin",
        active: true,
        created_at: new Date().toISOString()
      });
      this._save(this.banKey, bans);
    }

    async unbanUser(banId) {
      const bans = this._load(this.banKey);
      const idx = bans.findIndex((b) => b.id === banId);
      if (idx >= 0) {
        bans[idx] = { ...bans[idx], active: false, resolved_at: new Date().toISOString() };
        this._save(this.banKey, bans);
      }
    }

    async getCurrentUser() {
      return null;
    }

    async getModerationLogs() {
      const key = "polly_moderation_logs";
      const rows = this._load(key);
      return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }

  class SupabaseBackend {
    constructor(url, key, options) {
      const storageKey = (options && options.authStorageKey) || "polly_auth_main";
      if (
        storageKey === "polly_auth_main" &&
        window.PollyCommon &&
        typeof window.PollyCommon.createAuthClient === "function"
      ) {
        const shared = window.PollyCommon.createAuthClient();
        if (shared) {
          this.client = shared;
          return;
        }
      }

      const clientOptions = { auth: { storageKey } };
      this.client = window.supabase.createClient(url, key, clientOptions);
    }

    async getPosts() {
      const { data, error } = await this.client
        .from("posts")
        .select("id, title, body, category, software_url, tags, author_name, author_user_id, created_at, is_pinned, is_sticky, is_hidden, is_locked, is_solved, hidden_reason")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []).map(withPostDefaults);
    }

    async getPostById(id) {
      const { data, error } = await this.client
        .from("posts")
        .select("id, title, body, category, software_url, tags, author_name, author_user_id, created_at, is_pinned, is_sticky, is_hidden, is_locked, is_solved, hidden_reason")
        .eq("id", id)
        .single();
      if (error) return null;
      return withPostDefaults(data);
    }

    async getComments() {
      const { data, error } = await this.client
        .from("comments")
        .select("id, post_id, author_name, author_user_id, body, created_at")
        .order("created_at", { ascending: true })
        .limit(3000);
      if (error) throw error;
      return data || [];
    }

    async getReports() {
      const { data, error } = await this.client
        .from("reports")
        .select("id, post_id, reason, reporter_name, reporter_user_id, status, created_at, resolved_at, resolved_by")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data || [];
    }

    async getMyProfile() {
      const user = await this.getCurrentUser();
      if (!user) return null;
      const { data, error } = await this.client
        .from("profiles")
        .select("user_id, display_name, bio, created_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    }

    async upsertMyProfile(profile) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Login required");
      const clean = String(profile.display_name || "").trim().slice(0, 24);
      if (!clean) throw new Error("Display name is required");
      const { error } = await this.client.from("profiles").upsert(
        {
          user_id: user.id,
          display_name: clean
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;
    }

    async getBannedUsers() {
      const { data, error } = await this.client
        .from("banned_users")
        .select("id, nickname, reason, banned_by, active, created_at, resolved_at")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data || [];
    }

    async getMyFriends() {
      const user = await this.getCurrentUser();
      if (!user) return [];

      const { data, error } = await this.client
        .from("friendships")
        .select("requester_user_id, requester_name, addressee_user_id, addressee_name, status")
        .or(`requester_user_id.eq.${user.id},addressee_user_id.eq.${user.id}`)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(friendlyError(error, "Could not load friends."));

      const names = new Set();
      for (const row of data || []) {
        if (row.requester_user_id === user.id && row.addressee_name) names.add(String(row.addressee_name));
        if (row.addressee_user_id === user.id && row.requester_name) names.add(String(row.requester_name));
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    }

    async getIncomingFriendRequests() {
      const user = await this.getCurrentUser();
      if (!user) return [];

      const { data, error } = await this.client
        .from("friendships")
        .select("id, requester_name, created_at")
        .eq("addressee_user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw new Error(friendlyError(error, "Could not load incoming requests."));
      return (data || []).map((row) => ({ id: row.id, from: row.requester_name, created_at: row.created_at }));
    }

    async addFriend(friendName) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Please login first.");

      const profile = await this.getMyProfile();
      if (!profile || !profile.display_name) {
        throw new Error("Please set your display name in profile settings first.");
      }

      const targetName = String(friendName || "").trim().slice(0, 24);
      if (!targetName) throw new Error("Friend name is required.");
      if (profile.display_name.toLowerCase() === targetName.toLowerCase()) {
        throw new Error("You cannot add yourself.");
      }

      const { data: targetProfile, error: profileErr } = await this.client
        .from("profiles")
        .select("user_id, display_name")
        .ilike("display_name", targetName)
        .maybeSingle();
      if (profileErr || !targetProfile || !targetProfile.user_id) {
        throw new Error("Member not found.");
      }

      const idA = String(user.id);
      const idB = String(targetProfile.user_id);
      const requester_user_id = idA;
      const requester_name = profile.display_name;
      const addressee_user_id = idB;
      const addressee_name = targetProfile.display_name;

      const { data: existingRows, error: existingErr } = await this.client
        .from("friendships")
        .select("id")
        .or(`and(requester_user_id.eq.${idA},addressee_user_id.eq.${idB}),and(requester_user_id.eq.${idB},addressee_user_id.eq.${idA})`)
        .limit(1);
      if (existingErr) throw new Error(friendlyError(existingErr, "Could not check friendship."));
      if ((existingRows || []).length > 0) {
        throw new Error("Friend request already exists for this member.");
      }

      const { error } = await this.client.from("friendships").insert({
        requester_user_id,
        requester_name,
        addressee_user_id,
        addressee_name,
        status: "pending"
      });
      if (error) throw new Error(friendlyError(error, "Could not send friend request."));
    }

    async acceptFriendRequest(friendName) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Please login first.");

      const targetName = String(friendName || "").trim().slice(0, 24);
      if (!targetName) throw new Error("Friend name is required.");

      const { data: targetProfile, error: profileErr } = await this.client
        .from("profiles")
        .select("user_id")
        .ilike("display_name", targetName)
        .maybeSingle();
      if (profileErr || !targetProfile || !targetProfile.user_id) {
        throw new Error("Member not found.");
      }

      const { error } = await this.client
        .from("friendships")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("requester_user_id", targetProfile.user_id)
        .eq("addressee_user_id", user.id)
        .eq("status", "pending");

      if (error) throw new Error(friendlyError(error, "Could not accept friend request."));
    }

    async removeFriend(friendName) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Please login first.");

      const targetName = String(friendName || "").trim().slice(0, 24);
      if (!targetName) throw new Error("Friend name is required.");

      const { data: targetProfile, error: profileErr } = await this.client
        .from("profiles")
        .select("user_id")
        .ilike("display_name", targetName)
        .maybeSingle();
      if (profileErr || !targetProfile || !targetProfile.user_id) {
        throw new Error("Member not found.");
      }

      const idA = String(user.id);
      const idB = String(targetProfile.user_id);
      const { error } = await this.client
        .from("friendships")
        .delete()
        .or(`and(requester_user_id.eq.${idA},addressee_user_id.eq.${idB}),and(requester_user_id.eq.${idB},addressee_user_id.eq.${idA})`);
      if (error) throw new Error(friendlyError(error, "Could not remove friend."));
    }

    async isNicknameBanned(name) {
      const user = await this.getCurrentUser();
      if (user) {
        const { data, error } = await this.client
          .from("banned_users")
          .select("id")
          .eq("user_id", user.id)
          .eq("active", true)
          .limit(1);
        if (!error && (data || []).length > 0) return true;
      }

      const normalized = String(name || "").trim().toLowerCase();
      if (!normalized) return false;

      const { data, error } = await this.client
        .from("banned_users")
        .select("id")
        .eq("nickname", normalized)
        .eq("active", true)
        .limit(1);
      if (error) throw error;
      return (data || []).length > 0;
    }

    async createPost(post) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Please login to create a thread.");

      const profile = await this.getMyProfile();
      if (!profile || !profile.display_name) {
        throw new Error("Please set your display name in profile settings first.");
      }

      const clean = sanitizePostInput(post);
      const submittedUrl = clean.software_url ? String(clean.software_url).trim() : "";
      const { data, error } = await this.client
        .from("posts")
        .insert({
          title: clean.title,
          body: clean.body,
          category: clean.category || "general",
          software_url: null,
          tags: clean.tags,
          author_name: profile.display_name,
          author_user_id: user.id,
          is_pinned: false,
          is_sticky: false,
          is_hidden: false,
          is_locked: false,
          is_solved: false,
          hidden_reason: null
        })
        .select("id")
        .single();
      if (error) throw new Error(friendlyError(error, "Could not create thread."));

      if (submittedUrl && data && data.id) {
        await this.submitDownloadLink(data.id, submittedUrl, profile.display_name, user.id);
      }
    }

    async submitDownloadLink(postId, url, authorName, authorUserId) {
      const cleanUrl = String(url || "").trim();
      if (!cleanUrl) return;

      const { error } = await this.client.from("download_link_submissions").upsert(
        {
          post_id: postId,
          submitted_by_user_id: authorUserId,
          submitted_by_name: authorName,
          submitted_url: cleanUrl,
          status: "pending",
          security_check_status: "pending",
          security_check_notes: ""
        },
        { onConflict: "post_id" }
      );

      if (error) throw new Error(friendlyError(error, "Could not submit download link for approval."));
    }

    async updatePost(postId, patch) {
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(patch, "is_pinned")) payload.is_pinned = Boolean(patch.is_pinned);
      if (Object.prototype.hasOwnProperty.call(patch, "is_sticky")) payload.is_sticky = Boolean(patch.is_sticky);
      if (Object.prototype.hasOwnProperty.call(patch, "is_hidden")) payload.is_hidden = Boolean(patch.is_hidden);
      if (Object.prototype.hasOwnProperty.call(patch, "hidden_reason")) payload.hidden_reason = patch.hidden_reason || null;
      if (Object.prototype.hasOwnProperty.call(patch, "software_url")) payload.software_url = patch.software_url || null;
      if (Object.prototype.hasOwnProperty.call(patch, "is_locked")) payload.is_locked = Boolean(patch.is_locked);
      if (Object.prototype.hasOwnProperty.call(patch, "is_solved")) payload.is_solved = Boolean(patch.is_solved);
      if (Object.prototype.hasOwnProperty.call(patch, "title")) payload.title = patch.title;
      if (Object.prototype.hasOwnProperty.call(patch, "body")) payload.body = patch.body;
      if (Object.prototype.hasOwnProperty.call(patch, "tags")) payload.tags = Array.isArray(patch.tags) ? patch.tags : [];
      const { error } = await this.client.from("posts").update(payload).eq("id", postId);
      if (error) throw new Error(friendlyError(error, "Could not update thread."));
    }

    async deletePost(postId) {
      const { error } = await this.client.from("posts").delete().eq("id", postId);
      if (error) throw new Error(friendlyError(error, "Could not delete thread."));
    }

    async clearPostLink(postId) {
      await this.updatePost(postId, { software_url: null });
    }

    async getPendingDownloadLinks() {
      const { data, error } = await this.client
        .from("download_link_submissions")
        .select("id, post_id, submitted_url, submitted_by_name, status, security_check_status, security_check_notes, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(friendlyError(error, "Could not load pending download links."));

      const postIds = (data || []).map((row) => row.post_id).filter(Boolean);
      let byPostId = new Map();
      if (postIds.length) {
        const { data: postRows } = await this.client
          .from("posts")
          .select("id, title")
          .in("id", postIds);
        byPostId = new Map((postRows || []).map((row) => [row.id, row.title]));
      }

      return (data || []).map((row) => ({
        ...row,
        post_title: byPostId.get(row.post_id) || "Unknown thread"
      }));
    }

    async reviewDownloadLink(submissionId, decision, reviewedBy, securityNotes) {
      const nextDecision = decision === "approved" ? "approved" : "rejected";
      const securityStatus = nextDecision === "approved" ? "passed" : "failed";

      const { data, error } = await this.client.rpc("review_download_link_submission", {
        p_submission_id: submissionId,
        p_decision: nextDecision,
        p_security_check_status: securityStatus,
        p_security_notes: String(securityNotes || ""),
        p_reviewed_by: String(reviewedBy || "admin")
      });
      if (error) throw new Error(friendlyError(error, "Could not review download link."));
      return data;
    }

    async banDownloadDomain(domain) {
      const clean = normalizeUrlDomain(domain);
      if (!clean) throw new Error("Domain is required.");
      const { error } = await this.client.from("blocked_link_domains").insert({ domain: clean });
      if (error && !String(error.message || "").toLowerCase().includes("duplicate")) {
        throw new Error(friendlyError(error, "Could not block domain."));
      }
    }

    async deletePostsByAuthor(name) {
      const { error } = await this.client.from("posts").delete().eq("author_name", name);
      if (error) throw new Error(friendlyError(error, "Could not delete user threads."));
    }

    async createComment(comment) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Please login to reply.");

      const profile = await this.getMyProfile();
      if (!profile || !profile.display_name) {
        throw new Error("Please set your display name in profile settings first.");
      }

      const clean = sanitizeCommentInput(comment);
      const { error } = await this.client.from("comments").insert({
        post_id: clean.post_id,
        author_name: profile.display_name,
        author_user_id: user.id,
        body: clean.body
      });
      if (error) throw new Error(friendlyError(error, "Could not create reply."));
    }

    async updateComment(commentId, body) {
      const clean = String(body || "").trim().slice(0, 500);
      if (!clean) throw new Error("Comment body is required.");
      const { error } = await this.client.from("comments").update({ body: clean }).eq("id", commentId);
      if (error) throw new Error(friendlyError(error, "Could not update comment."));
    }

    async deleteComment(commentId) {
      const { error } = await this.client.from("comments").delete().eq("id", commentId);
      if (error) throw new Error(friendlyError(error, "Could not delete comment."));
    }

    async deleteCommentsByAuthor(name) {
      const { error } = await this.client.from("comments").delete().eq("author_name", name);
      if (error) throw new Error(friendlyError(error, "Could not delete user comments."));
    }

    async createReport(report) {
      const user = await this.getCurrentUser();
      if (!user) throw new Error("Please login to report.");

      const profile = await this.getMyProfile();
      if (!profile || !profile.display_name) {
        throw new Error("Please set your display name in profile settings first.");
      }

      const clean = sanitizeReportInput(report);
      const { error } = await this.client.from("reports").insert({
        post_id: clean.post_id,
        reason: clean.reason,
        reporter_name: profile.display_name,
        reporter_user_id: user.id,
        status: "open"
      });
      if (error) throw new Error(friendlyError(error, "Could not submit report."));
    }

    async createModerationLog(action, targetType, targetId, details) {
      const user = await this.getCurrentUser();
      const actor = user ? String(user.email || "") : "";
      const { error } = await this.client.from("moderation_logs").insert({
        action,
        target_type: targetType,
        target_id: targetId || null,
        actor_email: actor,
        details: details || {}
      });
      if (error) throw new Error(friendlyError(error, "Could not write moderation log."));
    }

    async resolveReport(reportId, resolverName) {
      const { error } = await this.client
        .from("reports")
        .update({ status: "resolved", resolved_by: resolverName, resolved_at: new Date().toISOString() })
        .eq("id", reportId);
      if (error) throw new Error(friendlyError(error, "Could not resolve report."));
    }

    async banUser(nickname, reason, bannedBy) {
      const normalized = String(nickname || "").trim().toLowerCase();
      let userId = null;
      const { data: profileData } = await this.client
        .from("profiles")
        .select("user_id")
        .ilike("display_name", nickname)
        .maybeSingle();
      if (profileData && profileData.user_id) {
        userId = profileData.user_id;
      }

      const { error } = await this.client.from("banned_users").insert({
        user_id: userId,
        nickname: normalized,
        reason: reason || "Policy violation",
        banned_by: bannedBy || "admin",
        active: true
      });
      if (error) throw new Error(friendlyError(error, "Could not ban user."));
    }

    async unbanUser(banId) {
      const { error } = await this.client
        .from("banned_users")
        .update({ active: false, resolved_at: new Date().toISOString() })
        .eq("id", banId);
      if (error) throw new Error(friendlyError(error, "Could not unban user."));
    }

    async getCurrentUser() {
      const { data, error } = await this.client.auth.getUser();
      if (error) return null;
      return data.user || null;
    }

    async getModerationLogs() {
      const { data, error } = await this.client
        .from("moderation_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return [];
      return data || [];
    }
  }

  function createApi(options) {
    const hasSupabase =
      typeof CONFIG.supabaseUrl === "string" &&
      CONFIG.supabaseUrl.length > 0 &&
      typeof CONFIG.supabaseAnonKey === "string" &&
      CONFIG.supabaseAnonKey.length > 0 &&
      window.supabase;
    return hasSupabase ? new SupabaseBackend(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, options) : new LocalBackend();
  }

  window.PollyApi = { createApi };
})();
