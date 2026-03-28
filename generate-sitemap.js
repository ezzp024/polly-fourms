#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseConfig() {
  const text = fs.readFileSync("config.js", "utf8");
  const url = (text.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1] || "";
  const anonKey = (text.match(/supabaseAnonKey:\s*"([^"]+)"/) || [])[1] || "";
  if (!url || !anonKey) {
    throw new Error("Missing supabaseUrl/supabaseAnonKey in config.js");
  }
  return { url, anonKey };
}

async function request(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json };
}

async function main() {
  const { url, anonKey } = parseConfig();
  const baseUrl = "https://ezzp024.github.io/polly-fourms";

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json"
  };

  const postsRes = await request(`${url}/rest/v1/posts?select=id,created_at,updated_at&order=created_at.desc&limit=5000`, {
    headers
  });

  const posts = Array.isArray(postsRes.json) ? postsRes.json : [];

  const staticPages = [
    { loc: "/", changefreq: "daily", priority: 1.0 },
    { loc: "/forum.html", changefreq: "daily", priority: 0.9 },
    { loc: "/releases.html", changefreq: "daily", priority: 0.8 },
    { loc: "/profile.html", changefreq: "weekly", priority: 0.6 },
    { loc: "/auth.html", changefreq: "weekly", priority: 0.5 },
    { loc: "/admin.html", changefreq: "weekly", priority: 0.4 }
  ];

  const sectionMeta = [
    { key: "general", name: "General Tech Chat" },
    { key: "software", name: "Software Releases" },
    { key: "help", name: "Coding Help" },
    { key: "showcase", name: "Project Showcase" }
  ];

  for (const section of sectionMeta) {
    staticPages.push({
      loc: `/forum.html?section=${section.key}`,
      changefreq: "daily",
      priority: 0.8
    });
  }

  const threadUrls = posts.map((post) => ({
    loc: `/thread.html?id=${post.id}`,
    lastmod: post.created_at,
    changefreq: "weekly",
    priority: 0.7
  }));

  const allUrls = [...staticPages, ...threadUrls];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${baseUrl}${u.loc}</loc>
    ${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : ""}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  fs.writeFileSync("sitemap.xml", sitemap);
  console.log(`Generated sitemap.xml with ${allUrls.length} URLs (${posts.length} threads)`);

  const rssSections = [
    { key: "general", name: "General Tech Chat" },
    { key: "software", name: "Software Releases" },
    { key: "help", name: "Coding Help" },
    { key: "showcase", name: "Project Showcase" }
  ];

  for (const section of rssSections) {
    const sectionPosts = posts.slice(0, 50);
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Polly Fourms - ${section.name}</title>
  <link>${baseUrl}/forum.html?section=${section.key}</link>
  <description>Latest threads in ${section.name}</description>
  <language>en-us</language>
${sectionPosts
  .map(
    (p) => `  <item>
    <title>Thread ${p.id}</title>
    <link>${baseUrl}/thread.html?id=${p.id}</link>
    <guid>${baseUrl}/thread.html?id=${p.id}</guid>
    <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
  </item>`
  )
  .join("\n")}
</channel>
</rss>`;

    fs.writeFileSync(`feed-${section.key}.xml`, rss);
    console.log(`Generated feed-${section.key}.xml`);
  }

  console.log("Done! Upload sitemap.xml and feed-*.xml to your site root.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
