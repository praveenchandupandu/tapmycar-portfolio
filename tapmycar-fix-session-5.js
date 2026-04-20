// ═══════════════════════════════════════════════════════════════════
// TapMyCar — Session 5: Cancel sub + Delete account UI + Desktop CSS fix
// ═══════════════════════════════════════════════════════════════════
// Surgical edits only, no file replacements. Safe operation.
//
// 1. settings.html — add Cancel Subscription + Delete Account rows
//    (cancel function already exists, just missing the UI element cancel-sub-row)
// 2. settings.html — add deleteAccount() JS function
// 3. app.css — add .wide-page class for full-width desktop layout
// 4. Apply class="wide-page" on body tag of:
//    - landing.html
//    - pricing.html
//    - why.html
//    - terms.html
//    - privacy.html
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

function patchFile(relPath, patches) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  [SKIP] ${relPath} not found`);
    return;
  }
  let content = fs.readFileSync(fullPath, 'utf8');
  let fileChanges = 0;

  for (const { name, find, replace } of patches) {
    if (content.includes(find)) {
      content = content.replace(find, replace);
      console.log(`  [FIX] ${relPath} :: ${name}`);
      fileChanges++;
      totalFixes++;
    } else if (replace && content.includes(replace)) {
      console.log(`  [OK]  ${relPath} :: ${name} (already patched)`);
    } else {
      console.log(`  [WARN] ${relPath} :: ${name} - pattern not found`);
    }
  }

  if (fileChanges > 0) {
    fs.writeFileSync(fullPath, content, 'utf8');
    // Sync to root
    const baseName = path.basename(relPath);
    const rootCopy = path.join(ROOT, baseName);
    if (fs.existsSync(rootCopy) || relPath.startsWith('public/')) {
      fs.copyFileSync(fullPath, rootCopy);
    }
  }
}

console.log('═══ Session 5: cancel/delete UI + desktop CSS fix ═══');
console.log('');

// ─── 1. settings.html: Add Cancel + Delete UI rows + Delete JS ─────
console.log('Part 1: settings.html UI additions');

patchFile('public/settings.html', [
  {
    name: 'add cancel-sub-row + delete-account-row before Sign out',
    find: `  <!-- Sign out -->
  <div class="set-row" onclick="signOut()"><div class="set-l"><div class="set-ic" style="background:var(--rdl)"><svg viewBox="0 0 24 24" stroke="var(--rd)"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></div><div><div class="set-t" style="color:var(--rd)">Sign out</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>`,
    replace: `  <!-- Cancel Subscription (only shown if user has an active subscription) -->
  <div class="set-row" id="cancel-sub-row" style="display:none" onclick="cancelSubscription()"><div class="set-l"><div class="set-ic" style="background:#FFF3EC"><svg viewBox="0 0 24 24" stroke="var(--or)"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg></div><div><div class="set-t">Cancel subscription</div><div class="set-s">Stop future charges. Keeps tag active until paid period ends.</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>

  <!-- Danger zone -->
  <div class="sl" style="color:var(--rd)">Danger zone</div>
  <div class="set-row" onclick="deleteAccount()"><div class="set-l"><div class="set-ic" style="background:var(--rdl)"><svg viewBox="0 0 24 24" stroke="var(--rd)"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div><div><div class="set-t" style="color:var(--rd)">Delete account</div><div class="set-s">Permanently delete your account and all data.</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>

  <!-- Sign out -->
  <div class="set-row" onclick="signOut()"><div class="set-l"><div class="set-ic" style="background:var(--rdl)"><svg viewBox="0 0 24 24" stroke="var(--rd)"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></div><div><div class="set-t" style="color:var(--rd)">Sign out</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>`
  },
  {
    name: 'add deleteAccount() JS function after cancelSubscription()',
    find: `async function cancelSubscription() {
  if (!confirm('Are you sure you want to cancel your subscription?')) return;
  try {
    const res = await fetch('/api/cancel-subscription', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ user_id: s.token }) });
    const data = await res.json();
    if (data.success) { showToast('Subscription cancelled'); document.getElementById('cancel-sub-row').style.display = 'none'; }
    else { showToast(data.error || 'Failed to cancel'); }
  } catch(e) { showToast('Network error'); }
}`,
    replace: `async function cancelSubscription() {
  if (!confirm('Cancel your TapMyCar subscription?\\n\\nYou will not be charged again. Your tag will stay active until the end of your current paid period.\\n\\nPhysical stickers already shipped are yours to keep.')) return;
  try {
    const res = await fetch('/api/cancel-subscription', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ user_id: s.token }) });
    const data = await res.json();
    if (data.success) { showToast('Subscription cancelled'); document.getElementById('cancel-sub-row').style.display = 'none'; }
    else { showToast(data.error || 'Failed to cancel'); }
  } catch(e) { showToast('Network error'); }
}

async function deleteAccount() {
  const first = confirm('Delete your TapMyCar account permanently?\\n\\nThis will:\\n• Cancel any active subscription\\n• Disable all your tags (scans will show "inactive")\\n• Permanently delete your personal data\\n\\nThis cannot be undone.');
  if (!first) return;
  const typed = prompt('To confirm, type DELETE (all caps) in the box below:');
  if (typed !== 'DELETE') {
    if (typed !== null) showToast('Delete cancelled \u2014 confirmation text did not match');
    return;
  }
  try {
    const res = await fetch('/api/delete-account', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: s.token, confirm: 'DELETE' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Account deleted. Goodbye!');
      localStorage.clear();
      setTimeout(() => { window.location.href = '/landing.html'; }, 1500);
    } else {
      showToast(data.error || 'Failed to delete account. Please contact support@tapmycar.io.');
    }
  } catch(e) { showToast('Network error \u2014 please try again'); }
}`
  }
]);

// ─── 2. app.css: add .wide-page class ─────────────────────────────
console.log('');
console.log('Part 2: app.css \u2014 add wide-page override');

patchFile('public/app.css', [
  {
    name: 'add .wide-page class at end of file',
    find: `body{font-family:'Inter',sans-serif;background:var(--wh);color:var(--bk);max-width:430px;margin:0 auto;min-height:100vh;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;}`,
    replace: `body{font-family:'Inter',sans-serif;background:var(--wh);color:var(--bk);max-width:430px;margin:0 auto;min-height:100vh;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;}
body.wide-page{max-width:1100px;padding:0 20px;box-sizing:border-box;}
@media (max-width:720px){body.wide-page{max-width:430px;padding:0;}}`
  }
]);

// ─── 3. Apply class="wide-page" to landing, pricing, why, terms, privacy ─
console.log('');
console.log('Part 3: apply wide-page class to 5 desktop-friendly pages');

['landing.html', 'pricing.html', 'why.html', 'terms.html', 'privacy.html'].forEach(fname => {
  const filePath = path.join(ROOT, 'public', fname);
  if (!fs.existsSync(filePath)) {
    console.log(`  [SKIP] public/${fname} not found`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Handle <body> (no attrs)
  if (content.includes('<body>\n') || content.includes('<body>\r\n')) {
    content = content.replace(/<body>(\r?\n)/, '<body class="wide-page">$1');
    changed = true;
  }
  // Handle <body ...> with other attrs (add class if none) - skip if already has wide-page
  else if (!content.includes('wide-page')) {
    const match = content.match(/<body([^>]*)>/);
    if (match) {
      const attrs = match[1];
      if (attrs.includes('class="')) {
        content = content.replace(/<body([^>]*)class="([^"]*)"([^>]*)>/, '<body$1class="$2 wide-page"$3>');
      } else {
        content = content.replace(/<body([^>]*)>/, '<body$1 class="wide-page">');
      }
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    // Sync to root
    fs.copyFileSync(filePath, path.join(ROOT, fname));
    console.log(`  [FIX] public/${fname} \u2014 added class="wide-page"`);
    totalFixes++;
  } else {
    console.log(`  [OK]  public/${fname} already has wide-page`);
  }
});

console.log('');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log(`Total fixes applied: ${totalFixes}`);
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('');
console.log('REMINDER: also drop the new delete-account.js into api/');
console.log('');
console.log('Review before push:');
console.log('  git diff public/settings.html public/app.css public/landing.html');
console.log('');
console.log('Then commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Session 5: cancel sub UI + delete account + desktop CSS"');
console.log('  git push');
