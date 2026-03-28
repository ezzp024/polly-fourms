const fs = require("fs");
const txt = fs.readFileSync("config.js", "utf8");
const urlMatch = txt.match(/supabaseUrl.*?["']([^"']+)["']/);
const keyMatch = txt.match(/supabaseAnonKey.*?["']([^"']+)["']/);
const url = urlMatch ? urlMatch[1] : "";
const key = keyMatch ? keyMatch[1] : "";

async function test() {
  console.log("=== DETAILED SECURITY TEST ===\n");
  
  const loginRes = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sper1337@gmail.com', password: '12312344' })
  });
  const session = await loginRes.json();
  const token = session.access_token;
  const userId = session.user.id;
  console.log("Logged in as:", userId);
  
  const h = { 'apikey': key, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  
  // Test 1: Try to READ reports
  const reportsRes = await fetch(url + '/rest/v1/reports?select=id,reason', { headers: h });
  const reportsData = await reportsRes.json();
  console.log('\n1. REPORTS READ:');
  console.log('   Status:', reportsRes.status);
  console.log('   Data count:', Array.isArray(reportsData) ? reportsData.length : 'error');
  const reportsBlocked = reportsRes.status >= 400 || (Array.isArray(reportsData) && reportsData.length === 0);
  console.log('   SECURE:', reportsBlocked ? 'YES' : 'NO - can read!');
  
  // Get posts to test with
  const postsRes = await fetch(url + '/rest/v1/posts?select=id,title,author_user_id&order=created_at.desc&limit=10', { headers: h });
  const postsData = await postsRes.json();
  const otherPost = postsData.find(p => p.author_user_id && p.author_user_id !== userId);
  
  if (otherPost) {
    console.log('\n2. EDIT OTHERS POST:');
    console.log('   Post ID:', otherPost.id);
    console.log('   Original title:', otherPost.title);
    
    const newTitle = 'HACKED_BY_TEST_' + Date.now();
    const patchRes = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ title: newTitle })
    });
    
    // Check if actually changed
    const checkRes = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id + '&select=title', { headers: h });
    const afterData = await checkRes.json();
    const actualTitle = afterData[0]?.title;
    
    console.log('   Patch status:', patchRes.status);
    console.log('   Title after patch:', actualTitle);
    console.log('   Was changed:', actualTitle === newTitle ? 'YES - VULNERABLE!' : 'NO - secure');
  }
  
  // Test comments
  const commentsRes = await fetch(url + '/rest/v1/comments?select=id,author_user_id&limit=10', { headers: h });
  const commentsData = await commentsRes.json();
  const otherComment = commentsData.find(c => c.author_user_id && c.author_user_id !== userId);
  
  if (otherComment) {
    console.log('\n3. DELETE OTHERS COMMENT:');
    console.log('   Comment ID:', otherComment.id);
    const delRes = await fetch(url + '/rest/v1/comments?id=eq.' + otherComment.id, {
      method: 'DELETE',
      headers: h
    });
    
    // Check if still exists
    const checkRes = await fetch(url + '/rest/v1/comments?id=eq.' + otherComment.id + '&select=id', { headers: h });
    const stillExists = (await checkRes.json()).length > 0;
    
    console.log('   Delete status:', delRes.status);
    console.log('   Still exists:', stillExists);
    console.log('   SECURE:', !stillExists ? 'NO - was deleted!' : 'YES');
  }
  
  console.log('\n=== TEST COMPLETE ===');
}

test().catch(e => console.error("Error:", e.message));
