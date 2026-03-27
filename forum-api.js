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

    async createComment(comment) {
      const comments = this._load(this.commentKey);
      comments.push({ id: crypto.randomUUID(), ...comment, created_at: new Date().toISOString() });
      this._save(this.commentKey, comments);
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
  }

  class SupabaseBackend {
    constructor(url, key) {
      this.client = window.supabase.createClient(url, key);
      this.hasModerationColumns = true;
      this.hasReportsTable = true;
    }

    async getPosts() {
      const primarySelect = "id, title, body, category, software_url, tags, author_name, created_at, is_pinned, is_sticky, is_hidden, hidden_reason";
      const fallbackSelect = "id, title, body, category, software_url, tags, author_name, created_at";

      let data;
      if (this.hasModerationColumns) {
        const { data: fullData, error } = await this.client
          .from("posts")
          .select(primarySelect)
          .order("created_at", { ascending: false })
          .limit(500);
        if (!error) {
          data = fullData || [];
        } else {
          this.hasModerationColumns = false;
        }
      }

      if (!data) {
        const { data: legacyData, error } = await this.client
          .from("posts")
          .select(fallbackSelect)
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        data = legacyData || [];
      }

      return data.map(withPostDefaults);
    }

    async getPostById(id) {
      const fullSelect = "id, title, body, category, software_url, tags, author_name, created_at, is_pinned, is_sticky, is_hidden, hidden_reason";
      const legacySelect = "id, title, body, category, software_url, tags, author_name, created_at";

      if (this.hasModerationColumns) {
        const { data, error } = await this.client.from("posts").select(fullSelect).eq("id", id).single();
        if (!error && data) return withPostDefaults(data);
        if (error && error.code !== "PGRST116") {
          this.hasModerationColumns = false;
        }
      }

      const { data, error } = await this.client.from("posts").select(legacySelect).eq("id", id).single();
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
      if (!this.hasReportsTable) return [];
      const { data, error } = await this.client
        .from("reports")
        .select("id, post_id, reason, reporter_name, status, created_at, resolved_at, resolved_by")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) {
        this.hasReportsTable = false;
        return [];
      }
      return data || [];
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

      if (!error) return;
      const { error: legacyError } = await this.client.from("posts").insert({
        title: post.title,
        body: post.body,
        category: post.category,
        software_url: post.software_url || null,
        tags: Array.isArray(post.tags) ? post.tags : [],
        author_name: post.author_name
      });
      if (legacyError) throw legacyError;
    }

    async updatePost(postId, patch) {
      const payload = {
        is_pinned: Boolean(patch.is_pinned),
        is_sticky: Boolean(patch.is_sticky),
        is_hidden: Boolean(patch.is_hidden),
        hidden_reason: patch.hidden_reason || null
      };
      const { error } = await this.client.from("posts").update(payload).eq("id", postId);
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

    async createReport(report) {
      if (!this.hasReportsTable) return;
      const { error } = await this.client.from("reports").insert({
        post_id: report.post_id,
        reason: report.reason,
        reporter_name: report.reporter_name,
        status: "open"
      });
      if (error) {
        this.hasReportsTable = false;
      }
    }

    async resolveReport(reportId, resolverName) {
      if (!this.hasReportsTable) return;
      const { error } = await this.client
        .from("reports")
        .update({ status: "resolved", resolved_by: resolverName, resolved_at: new Date().toISOString() })
        .eq("id", reportId);
      if (error) throw error;
    }
  }

  function createApi() {
    const hasSupabase =
      typeof CONFIG.supabaseUrl === "string" &&
      CONFIG.supabaseUrl.length > 0 &&
      typeof CONFIG.supabaseAnonKey === "string" &&
      CONFIG.supabaseAnonKey.length > 0 &&
      window.supabase;
    return hasSupabase ? new SupabaseBackend(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : new LocalBackend();
  }

  window.PollyApi = { createApi };
})();
