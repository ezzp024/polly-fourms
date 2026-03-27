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
- member profiles with ranks and activity history
- sticky/pinned threads plus hidden thread queue
- reporting workflow and moderator/admin console
- secured admin panel with email OTP step 1 + step 2 secondary email verification

The site works in two modes:

1. **Demo mode** (no setup): stores posts/comments in `localStorage`.
2. **Live mode** (recommended): uses free **Supabase** for real public multi-user data.

## Pages

- `index.html` - forum index (board overview)
- `forum.html` - section page with thread list + new thread form
- `thread.html` - single thread view + replies
- `releases.html` - software release browser
- `profile.html` - member profile + member directory
- `admin.html` - moderation console for moderators/admins

## Core Files

- `styles.css` - forum styling (classic board look)
- `forum-api.js` - Supabase/localStorage data layer
- `common.js` - shared helpers + nickname handling
- `home.js`, `forum.js`, `thread.js`, `releases.js` - page logic
- `profile.js`, `admin.js` - profile + moderation logic
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
4. Paste SQL from `supabase-setup.sql` -> click **Run**.
5. Left menu -> **Project Settings** -> **API**.
6. Copy these two values:
   - `Project URL`
   - `anon public` key
7. Open `config.js` and paste them.

Use SQL from `supabase-setup.sql` (includes posts, comments, reports, bans, admin policies).

Important for this project:

- If you created Supabase earlier, you should run the latest `supabase-setup.sql` again.
- The script is safe to re-run (`if not exists` + policy replacement).

Then open `config.js` and paste your values:

```js
window.POLLY_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
  adminEmail: "ezzp024@gmail.com",
  secondaryAdminEmail: "yuripoli1973@gmail.com",
  moderatorNames: ["admin"],
  adminNames: ["admin"]
};
```

To use moderator/admin features, set your nickname to one of the names in `moderatorNames` or `adminNames`.

For secure admin panel access:

1. Open `admin.html`.
2. Step 1 sends OTP to `adminEmail`.
3. Step 2 sends OTP to `secondaryAdminEmail`.
4. Complete both verifications to unlock full admin controls.

You also need both emails available in Supabase Auth users. The easiest method:

- Go to **Authentication -> Users -> Add user**
- Create user `ezzp024@gmail.com`
- Create user `yuripoli1973@gmail.com`

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
