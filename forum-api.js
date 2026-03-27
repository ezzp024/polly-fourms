(function () {
  const CONFIG = window.POLLY_CONFIG || { supabaseUrl: "", supabaseAnonKey: "" };

  function withPostDefaults(post) {
    return {
      is_pinned: false,
      is_sticky: false,
      is_hidden: false,
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
      const storageKey = options && options.authStorageKey;
      const clientOptions = storageKey ? { auth: { storageKey } } : undefined;
      this.client = window.supabase.createClient(url, key, clientOptions);
    }

    async getPosts() {
      const { data, error } = await this.client
        .from("posts")
        .select("id, title, body, category, software_url, tags, author_name, created_at, is_pinned, is_sticky, is_hidden, hidden_reason")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []).map(withPostDefaults);
    }

    async getPostById(id) {
      const { data, error } = await this.client
        .from("posts")
        .select("id, title, body, category, software_url, tags, author_name, created_at, is_pinned, is_sticky, is_hidden, hidden_reason")
        .eq("id", id)
        .single();
      if (error) return null;
      return withPostDefaults(data);
    }

    async getComments() {
      const { data, error } = await this.client
        .from("comments")
        .select("id, post_id, author_name, body, created_at")
        .order("created_at", { ascending: true })
        .limit(3000);
      if (error) throw error;
      return data || [];
    }

    async getReports() {
      const { data, error } = await this.client
        .from("reports")
        .select("id, post_id, reason, reporter_name, status, created_at, resolved_at, resolved_by")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data || [];
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
      const normalized = String(name || "").trim().toLowerCase();
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
      const { error } = await this.client.from("posts").insert({
        title: post.title,
        body: post.body,
        category: post.category,
        software_url: post.software_url || null,
        tags: Array.isArray(post.tags) ? post.tags : [],
        author_name: post.author_name,
        is_pinned: false,
        is_sticky: false,
        is_hidden: false,
        hidden_reason: null
      });
      if (error) throw error;
    }

    async updatePost(postId, patch) {
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(patch, "is_pinned")) payload.is_pinned = Boolean(patch.is_pinned);
      if (Object.prototype.hasOwnProperty.call(patch, "is_sticky")) payload.is_sticky = Boolean(patch.is_sticky);
      if (Object.prototype.hasOwnProperty.call(patch, "is_hidden")) payload.is_hidden = Boolean(patch.is_hidden);
      if (Object.prototype.hasOwnProperty.call(patch, "hidden_reason")) payload.hidden_reason = patch.hidden_reason || null;
      if (Object.prototype.hasOwnProperty.call(patch, "software_url")) payload.software_url = patch.software_url || null;
      const { error } = await this.client.from("posts").update(payload).eq("id", postId);
      if (error) throw error;
    }

    async deletePost(postId) {
      const { error } = await this.client.from("posts").delete().eq("id", postId);
      if (error) throw error;
    }

    async clearPostLink(postId) {
      await this.updatePost(postId, { software_url: null });
    }

    async deletePostsByAuthor(name) {
      const { error } = await this.client.from("posts").delete().eq("author_name", name);
      if (error) throw error;
    }

    async createComment(comment) {
      const { error } = await this.client.from("comments").insert({
        post_id: comment.post_id,
        author_name: comment.author_name,
        body: comment.body
      });
      if (error) throw error;
    }

    async deleteCommentsByAuthor(name) {
      const { error } = await this.client.from("comments").delete().eq("author_name", name);
      if (error) throw error;
    }

    async createReport(report) {
      const { error } = await this.client.from("reports").insert({
        post_id: report.post_id,
        reason: report.reason,
        reporter_name: report.reporter_name,
        status: "open"
      });
      if (error) throw error;
    }

    async resolveReport(reportId, resolverName) {
      const { error } = await this.client
        .from("reports")
        .update({ status: "resolved", resolved_by: resolverName, resolved_at: new Date().toISOString() })
        .eq("id", reportId);
      if (error) throw error;
    }

    async banUser(nickname, reason, bannedBy) {
      const normalized = String(nickname || "").trim().toLowerCase();
      const { error } = await this.client.from("banned_users").insert({
        nickname: normalized,
        reason: reason || "Policy violation",
        banned_by: bannedBy || "admin",
        active: true
      });
      if (error) throw error;
    }

    async unbanUser(banId) {
      const { error } = await this.client
        .from("banned_users")
        .update({ active: false, resolved_at: new Date().toISOString() })
        .eq("id", banId);
      if (error) throw error;
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
