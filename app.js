const CONFIG = window.POLLY_CONFIG || { supabaseUrl: "", supabaseAnonKey: "" };

const els = {
  identityForm: document.getElementById("identityForm"),
  nickname: document.getElementById("nickname"),
  postForm: document.getElementById("postForm"),
  feedList: document.getElementById("feedList"),
  postTemplate: document.getElementById("postTemplate"),
  categoryFilter: document.getElementById("categoryFilter"),
  search: document.getElementById("search"),
  emptyState: document.getElementById("emptyState"),
  metricPosts: document.getElementById("metricPosts"),
  metricSoftware: document.getElementById("metricSoftware"),
  metricComments: document.getElementById("metricComments")
};

const state = {
  posts: [],
  commentsByPost: new Map(),
  nickname: localStorage.getItem("polly_nickname") || "",
  backend: null
};

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

  async getComments() {
    return this._load(this.commentKey).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  }

  async createPost(post) {
    const posts = this._load(this.postKey);
    posts.push({
      id: crypto.randomUUID(),
      ...post,
      created_at: new Date().toISOString()
    });
    this._save(this.postKey, posts);
  }

  async createComment(comment) {
    const comments = this._load(this.commentKey);
    comments.push({
      id: crypto.randomUUID(),
      ...comment,
      created_at: new Date().toISOString()
    });
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
      .limit(200);

    if (error) throw error;
    return data;
  }

  async getComments() {
    const { data, error } = await this.client
      .from("comments")
      .select("id, post_id, author_name, body, created_at")
      .order("created_at", { ascending: true })
      .limit(1000);

    if (error) throw error;
    return data;
  }

  async createPost(post) {
    const { error } = await this.client.from("posts").insert({
      title: post.title,
      body: post.body,
      category: post.category,
      software_url: post.software_url || null,
      tags: post.tags,
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

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(iso) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function normalizeTags(raw) {
  return raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag, idx, list) => tag && list.indexOf(tag) === idx)
    .slice(0, 8);
}

function refreshMetrics() {
  els.metricPosts.textContent = String(state.posts.length);
  els.metricSoftware.textContent = String(state.posts.filter((p) => p.category === "software").length);

  let comments = 0;
  state.commentsByPost.forEach((rows) => {
    comments += rows.length;
  });
  els.metricComments.textContent = String(comments);
}

function filteredPosts() {
  const query = els.search.value.trim().toLowerCase();
  const cat = els.categoryFilter.value;

  return state.posts.filter((post) => {
    if (cat !== "all" && post.category !== cat) return false;
    if (!query) return true;

    const haystack = [post.title, post.body, (post.tags || []).join(" "), post.author_name]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function renderPosts() {
  const posts = filteredPosts();
  els.feedList.textContent = "";

  for (const post of posts) {
    const fragment = els.postTemplate.content.cloneNode(true);
    const root = fragment.querySelector(".post-card");

    fragment.querySelector(".post-category").textContent = post.category;
    fragment.querySelector(".post-time").textContent = formatTime(post.created_at);
    fragment.querySelector(".post-title").textContent = post.title;
    fragment.querySelector(".post-body").textContent = post.body;

    const link = fragment.querySelector(".software-link");
    if (post.software_url) {
      link.href = post.software_url;
      link.classList.remove("hidden");
    }

    const tagsWrap = fragment.querySelector(".post-tags");
    (post.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.textContent = `#${tag}`;
      tagsWrap.append(chip);
    });

    fragment.querySelector(".post-meta").textContent = `by ${post.author_name}`;

    const commentsList = fragment.querySelector(".comments-list");
    const comments = state.commentsByPost.get(post.id) || [];
    fragment.querySelector(".comment-count").textContent = String(comments.length);

    comments.forEach((comment) => {
      const node = document.createElement("article");
      node.className = "comment";
      node.innerHTML = `<strong>${escapeHtml(comment.author_name)}</strong><p>${escapeHtml(comment.body)}</p>`;
      commentsList.append(node);
    });

    const commentForm = fragment.querySelector(".comment-form");
    commentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.nickname) {
        alert("Set your nickname first.");
        return;
      }

      const input = commentForm.elements.comment;
      const body = input.value.trim();
      if (!body) return;

      try {
        await state.backend.createComment({
          post_id: post.id,
          author_name: state.nickname,
          body
        });
        input.value = "";
        await loadData();
      } catch (error) {
        alert(`Could not post comment: ${error.message || error}`);
      }
    });

    els.feedList.append(root);
  }

  els.emptyState.classList.toggle("hidden", posts.length > 0);
}

async function loadData() {
  const [posts, comments] = await Promise.all([state.backend.getPosts(), state.backend.getComments()]);
  state.posts = posts;

  state.commentsByPost = comments.reduce((map, item) => {
    const group = map.get(item.post_id) || [];
    group.push(item);
    map.set(item.post_id, group);
    return map;
  }, new Map());

  refreshMetrics();
  renderPosts();
}

function initIdentity() {
  if (state.nickname) {
    els.nickname.value = state.nickname;
  }

  els.identityForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.nickname.value.trim().slice(0, 24);
    if (!value) return;
    state.nickname = value;
    localStorage.setItem("polly_nickname", value);
  });
}

function initCreatePost() {
  els.postForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.nickname) {
      alert("Set your nickname first.");
      return;
    }

    const form = new FormData(els.postForm);
    const title = String(form.get("title") || "").trim();
    const content = String(form.get("content") || "").trim();
    const category = String(form.get("category") || "discussion");
    const softwareUrl = String(form.get("softwareUrl") || "").trim();
    const tags = normalizeTags(String(form.get("tags") || ""));

    if (!title || !content) return;

    try {
      await state.backend.createPost({
        title,
        body: content,
        category,
        software_url: softwareUrl,
        tags,
        author_name: state.nickname
      });
      els.postForm.reset();
      await loadData();
    } catch (error) {
      alert(`Could not publish post: ${error.message || error}`);
    }
  });
}

function initFilters() {
  const rerender = () => renderPosts();
  els.categoryFilter.addEventListener("change", rerender);
  els.search.addEventListener("input", rerender);
}

function initBackend() {
  const hasSupabase =
    typeof CONFIG.supabaseUrl === "string" &&
    CONFIG.supabaseUrl.length > 0 &&
    typeof CONFIG.supabaseAnonKey === "string" &&
    CONFIG.supabaseAnonKey.length > 0 &&
    window.supabase;

  state.backend = hasSupabase
    ? new SupabaseBackend(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
    : new LocalBackend();
}

async function boot() {
  initBackend();
  initIdentity();
  initCreatePost();
  initFilters();

  try {
    await loadData();
  } catch (error) {
    console.error(error);
    alert("Failed to load data. Falling back to local browser storage.");
    state.backend = new LocalBackend();
    await loadData();
  }
}

void boot();
