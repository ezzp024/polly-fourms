const fs = require("fs");
const txt = fs.readFileSync("config.js", "utf8");
const urlMatch = txt.match(/supabaseUrl:\s*"([^"]+)/);
const keyMatch = txt.match(/supabaseAnonKey:\s*"([^"]+)/);
const url = urlMatch ? urlMatch[1] : "";
const anonKey = keyMatch ? keyMatch[1] : "";

async function test() {
  console.log("Testing security...\n");
  
  const loginRes = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sper1337@gmail.com', password: '12312344' })
  });
  const session = await loginRes.json();
  const token = session.access_token;
  const userId = session.user.id;
  
  const h = { 'apikey': anonKey, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  const anonHeaders = { 'apikey': anonKey, 'Content-Type': 'application/json' };
  
  // Test 1: Read reports
  const reports = await fetch(url + '/rest/v1/reports?select=id', { headers: h });
  const reportsData = await reports.json();
  const reportsSecure = reports.status >= 400 || (Array.isArray(reportsData) && reportsData.length === 0);
  console.log('1. Read reports:', reports.status, reportsSecure ? 'SECURE' : 'VULNERABLE (count: ' + ((reportsData || []).length) + ')');
  
  // Test 2: Find other user's post
  const postsRes = await fetch(url + '/rest/v1/posts?select=id,author_user_id&order=created_at.desc&limit=10', { headers: h });
  const posts = await postsRes.json();
  const otherPost = posts.find(p => p.author_user_id && p.author_user_id !== userId);
  
  if (otherPost) {
    console.log('Testing with post:', otherPost.id);
    
    // Test 3: Edit other's post
    const beforePost = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id + '&select=title', { headers: anonHeaders });
    const beforePostData = await beforePost.json();
    const oldTitle = beforePostData[0]?.title;
    const hackedTitle = 'HACKED_' + Date.now();
    const patch = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ title: hackedTitle })
    });
    const afterPost = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id + '&select=title', { headers: anonHeaders });
    const afterPostData = await afterPost.json();
    const unchanged = afterPostData[0]?.title === oldTitle;
    console.log('2. Edit others post:', patch.status, unchanged ? 'SECURE' : 'VULNERABLE');
    
    // Test 4: Delete other's post  
    const del = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id, {
      method: 'DELETE',
      headers: h
    });
    const checkPost = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id + '&select=id', { headers: anonHeaders });
    const stillExistsPost = (await checkPost.json()).length > 0;
    console.log('3. Delete others post:', del.status, stillExistsPost ? 'SECURE' : 'VULNERABLE');
  } else {
    console.log('No other posts found to test');
  }
  
  // Test 5: Read others comments
  const commentsRes = await fetch(url + '/rest/v1/comments?select=id,author_user_id&limit=10', { headers: h });
  const comments = await commentsRes.json();
  const otherComment = comments.find(c => c.author_user_id && c.author_user_id !== userId);
  
  if (otherComment) {
    const delComment = await fetch(url + '/rest/v1/comments?id=eq.' + otherComment.id, {
      method: 'DELETE', 
      headers: h
    });
    const checkComment = await fetch(url + '/rest/v1/comments?id=eq.' + otherComment.id + '&select=id', { headers: anonHeaders });
    const stillExistsComment = (await checkComment.json()).length > 0;
    console.log('4. Delete others comment:', delComment.status, stillExistsComment ? 'SECURE' : 'VULNERABLE');
  }
  
  console.log('\n=== DONE ===');
}

test().catch(e => console.error(e));
