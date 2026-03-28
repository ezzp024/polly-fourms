(function () {
  const CONFIG = window.POLLY_CONFIG || { supabaseUrl: "", supabaseAnonKey: "" };

  function friendlyError(error, fallback) {
    const message = String((error && (error.message || error.details || error.hint)) || fallback || "Request failed");
    const lower = message.toLowerCase();

    if (lower.includes("row-level security") || lower.includes("permission denied") || lower.includes("not authorized")) {
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

  class LocalBackend {
    constructor() {
      this.postKey = "polly_posts";
      this.commentKey = "polly_comments";
      this.reportKey = "polly_reports";
      this.banKey = "polly_bans";
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

    async isNicknameBanned(name) {
      const bans = await this.getBannedUsers();
      const normalized = String(name || "").trim().toLowerCase();
      return bans.some((b) => String(b.nickname || "").trim().toLowerCase() === normalized && b.active !== false);
    }

    async createPost(post) {
      const posts = this._load(this.postKey);
      posts.push(
        withPostDefaults({
          id: crypto.randomUUID(),
          ...post,
          created_at: new Date().toISOString()
        })
      );
      this._save(this.postKey, posts);
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
      const comments = this._load(this.commentKey);
      comments.push({ id: crypto.randomUUID(), ...comment, created_at: new Date().toISOString() });
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

      const { error } = await this.client.from("posts").insert({
        title: post.title,
        body: post.body,
        category: post.category,
        software_url: post.software_url || null,
        tags: Array.isArray(post.tags) ? post.tags : [],
        author_name: profile.display_name,
        author_user_id: user.id,
        is_pinned: false,
        is_sticky: false,
        is_hidden: false,
        is_locked: false,
        is_solved: false,
        hidden_reason: null
      });
      if (error) throw new Error(friendlyError(error, "Could not create thread."));
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

      const { error } = await this.client.from("comments").insert({
        post_id: comment.post_id,
        author_name: profile.display_name,
        author_user_id: user.id,
        body: comment.body
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

      const { error } = await this.client.from("reports").insert({
        post_id: report.post_id,
        reason: report.reason,
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
