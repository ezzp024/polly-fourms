# Polly Forums

A stylish, GitHub Pages-ready community forum where users can:

- create posts
- discuss in comments
- publish software tools/releases with links and tags

Current UI/features include:

- classic multi-page forum layout (index, section, thread, releases)
- search, sorting, and pagination in sections/releases
- recent activity feed, top contributors panel, and forum stats
- thread quick actions (copy link + quote main post)

The site works in two modes:

1. **Demo mode** (no setup): stores posts/comments in `localStorage`.
2. **Live mode** (recommended): uses free **Supabase** for real public multi-user data.

## Pages

- `index.html` - forum index (board overview)
- `forum.html` - section page with thread list + new thread form
- `thread.html` - single thread view + replies
- `releases.html` - software release browser

## Core Files

- `styles.css` - forum styling (classic board look)
- `forum-api.js` - Supabase/localStorage data layer
- `common.js` - shared helpers + nickname handling
- `home.js`, `forum.js`, `thread.js`, `releases.js` - page logic
- `config.js` - backend config

## 1) Quick start locally

Open `index.html` in your browser.

If `config.js` is empty, it runs in demo mode.

## 2) Enable real users with free Supabase

Create a project at [https://supabase.com](https://supabase.com).

Exact clicks:

1. Open Supabase dashboard -> **New project**.
2. Choose organization -> set project name `polly-fourms` -> set a database password -> choose region -> **Create new project**.
3. Left menu -> **SQL Editor** -> **New query**.
4. Paste SQL from `supabase-setup.sql` (or the block below) -> click **Run**.
5. Left menu -> **Project Settings** -> **API**.
6. Copy these two values:
   - `Project URL`
   - `anon public` key
7. Open `config.js` and paste them.

Use this SQL:

```sql
create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 3 and 4000),
  category text not null default 'discussion',
  software_url text,
  tags text[] not null default '{}',
  author_name text not null check (char_length(author_name) between 2 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 2 and 24),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.posts enable row level security;
alter table public.comments enable row level security;

drop policy if exists "Public read posts" on public.posts;
drop policy if exists "Public create posts" on public.posts;
drop policy if exists "Public read comments" on public.comments;
drop policy if exists "Public create comments" on public.comments;

create policy "Public read posts"
on public.posts for select
to anon
using (true);

create policy "Public create posts"
on public.posts for insert
to anon
with check (true);

create policy "Public read comments"
on public.comments for select
to anon
using (true);

create policy "Public create comments"
on public.comments for insert
to anon
with check (true);
```

Then open `config.js` and paste your values:

```js
window.POLLY_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY"
};
```

After editing `config.js`, commit and push:

```bash
git add config.js supabase-setup.sql README.md
git commit -m "Configure Supabase for Polly Forums"
git push
```

Wait 1-2 minutes for GitHub Pages redeploy, then open:

`https://ezzp024.github.io/polly-fourms/`

## 3) Publish with free GitHub domain

1. Create a GitHub repo, for example: `polly-forums`.
2. Upload all project files.
3. In GitHub repo settings, open **Pages**.
4. Source: **Deploy from a branch**.
5. Branch: `main` / folder: `/ (root)`.

Your free domain will be:

`https://<your-github-username>.github.io/polly-forums/`

If you want the exact project name to look like "Polly Fourms", name your repo `polly-fourms`.

## Notes

- This is a lightweight forum starter.
- For moderation and abuse protection, add CAPTCHA and server-side validation later.
