const fs = require("fs");
const txt = fs.readFileSync("config.js", "utf8");
const urlMatch = txt.match(/supabaseUrl.*?["']([^"']+)["']/);
const keyMatch = txt.match(/supabaseAnonKey.*?["']([^"']+)["']/);
const url = urlMatch ? urlMatch[1] : "";
const key = keyMatch ? keyMatch[1] : "";

async function finalTest() {
  console.log("=== FINAL SECURITY VERIFICATION ===\n");
  
  const loginRes = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sper1337@gmail.com', password: '12312344' })
  });
  const session = await loginRes.json();
  const token = session.access_token;
  const userId = session.user.id;
  
  const h = { 'apikey': key, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  const anonH = { 'apikey': key, 'Authorization': 'Bearer ' + key };
  
  // Test 1: Reports - should be empty for non-admin
  const reportsRes = await fetch(url + '/rest/v1/reports?select=id', { headers: h });
  const reportsCount = (await reportsRes.json()).length;
  console.log('1. REPORTS for non-admin:');
  console.log('   Result: ' + reportsCount + ' rows (should be 0)');
  console.log('   Status: ' + (reportsCount === 0 ? 'PASS - SECURE' : 'FAIL'));
  
  // Test 2: Create report then verify non-admin can't read it
  const postsRes = await fetch(url + '/rest/v1/posts?select=id&limit=1', { headers: h });
  const postId = (await postsRes.json())[0]?.id;
  if (postId) {
    await fetch(url + '/rest/v1/reports', {
      method: 'POST',
      headers: h,
      body: JSON.stringify([{ post_id: postId, reason: 'security test', reporter_name: 'test', reporter_user_id: userId, status: 'open' }])
    });
    
    const afterCreate = await fetch(url + '/rest/v1/reports?select=id', { headers: h });
    const afterCount = (await afterCreate.json()).length;
    console.log('\n2. REPORTS after creating one:');
    console.log('   User can see: ' + afterCount + ' rows');
    console.log('   Status: ' + (afterCount === 0 ? 'PASS - SECURE (empty even after creating)' : 'WARNING - check manually'));
  }
  
  // Test 3: Edit others post
  const allPosts = await fetch(url + '/rest/v1/posts?select=id,title,author_user_id&limit=10', { headers: h });
  const postsList = await allPosts.json();
  const otherPost = postsList.find(p => p.author_user_id && p.author_user_id !== userId);
  
  if (otherPost) {
    const origTitle = otherPost.title;
    const patchRes = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ title: 'HACKED_TEST_' + Date.now() })
    });
    
    const checkRes = await fetch(url + '/rest/v1/posts?id=eq.' + otherPost.id + '&select=title', { headers: h });
    const newTitle = (await checkRes.json())[0]?.title;
    
    console.log('\n3. EDIT OTHERS POST:');
    console.log('   Original: ' + origTitle);
    console.log('   After patch: ' + newTitle);
    console.log('   Changed: ' + (newTitle !== origTitle ? 'YES - VULNERABLE!' : 'NO'));
    console.log('   Status: ' + (newTitle === origTitle ? 'PASS - SECURE' : 'FAIL - VULNERABLE'));
  }
  
  // Test 4: Delete others comment
  const commentsRes = await fetch(url + '/rest/v1/comments?select=id,author_user_id&limit=10', { headers: h });
  const commentsList = await commentsRes.json();
  const otherComment = commentsList.find(c => c.author_user_id && c.author_user_id !== userId);
  
  if (otherComment) {
    const delRes = await fetch(url + '/rest/v1/comments?id=eq.' + otherComment.id, {
      method: 'DELETE',
      headers: h
    });
    
    const checkRes = await fetch(url + '/rest/v1/comments?id=eq.' + otherComment.id + '&select=id', { headers: h });
    const stillExists = (await checkRes.json()).length > 0;
    
    console.log('\n4. DELETE OTHERS COMMENT:');
    console.log('   Still exists: ' + stillExists);
    console.log('   Status: ' + (stillExists ? 'PASS - SECURE' : 'FAIL - VULNERABLE'));
  }
  
  console.log('\n=== SECURITY TEST COMPLETE ===');
}

finalTest().catch(e => console.error("Error:", e.message));
