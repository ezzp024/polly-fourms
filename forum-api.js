(function () {
  const CONFIG = window.POLLY_CONFIG || { supabaseUrl: "", supabaseAnonKey: "" };

  class LocalBackend {
    constructor() {
      this.postKey = "polly_posts";
      this.commentKey = "polly_comments";
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
      return this._load(this.postKey).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }

    async getPostById(id) {
      return this._load(this.postKey).find((p) => p.id === id) || null;
    }

    async getComments() {
      return this._load(this.commentKey).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    }

    async createPost(post) {
      const posts = this._load(this.postKey);
      posts.push({ id: crypto.randomUUID(), ...post, created_at: new Date().toISOString() });
      this._save(this.postKey, posts);
    }

    async createComment(comment) {
      const comments = this._load(this.commentKey);
      comments.push({ id: crypto.randomUUID(), ...comment, created_at: new Date().toISOString() });
      this._save(this.commentKey, comments);
    }
  }

  class SupabaseBackend {
    constructor(url, key) {
      this.client = window.supabase.createClient(url, key);
    }

    async getPosts() {
      const { data, error } = await this.client
        .from("posts")
        .select("id, title, body, category, software_url, tags, author_name, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data || [];
    }

    async getPostById(id) {
      const { data, error } = await this.client
        .from("posts")
        .select("id, title, body, category, software_url, tags, author_name, created_at")
        .eq("id", id)
        .single();
      if (error) return null;
      return data;
    }

    async getComments() {
      const { data, error } = await this.client
        .from("comments")
        .select("id, post_id, author_name, body, created_at")
        .order("created_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return data || [];
    }

    async createPost(post) {
      const { error } = await this.client.from("posts").insert({
        title: post.title,
        body: post.body,
        category: post.category,
        software_url: post.software_url || null,
        tags: Array.isArray(post.tags) ? post.tags : [],
        author_name: post.author_name
      });
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
