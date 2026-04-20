// Fix: The getAdminKey() helper in the Reviews tab was looking in
// localStorage.getItem('admin_key') and URL ?key=, but the real admin.html
// uses a global JS variable `adminKey` populated from tmc_admin_key storage.

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'admin.html');
if (!fs.existsSync(filePath)) {
  console.error('public/admin.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let changed = false;

// Find and replace our broken getAdminKey function
const oldFunc = `function getAdminKey() {
  // Read from same place admin.html stores it (URL param, localStorage, prompt)
  return localStorage.getItem('admin_key') || new URLSearchParams(window.location.search).get('key') || '';
}`;

const newFunc = `function getAdminKey() {
  // Use the global adminKey variable that admin.html's login flow already populates
  if (typeof adminKey !== 'undefined' && adminKey) return adminKey;
  // Fall back to localStorage keys that admin.html uses
  return localStorage.getItem('tmc_admin_key') || localStorage.getItem('admin_key') || '';
}`;

if (content.includes(oldFunc)) {
  content = content.replace(oldFunc, newFunc);
  console.log('[FIX] Replaced broken getAdminKey() with working version');
  changed = true;
} else if (content.includes("typeof adminKey !== 'undefined'")) {
  console.log('[OK] getAdminKey already patched');
} else {
  // Try a more flexible search
  const looseMatch = content.match(/function getAdminKey\(\) \{[\s\S]*?\n\}/);
  if (looseMatch) {
    console.log('[DIAG] Found getAdminKey but signature differs:');
    console.log(looseMatch[0]);
    console.log('');
    console.log('Attempting loose replacement...');
    content = content.replace(looseMatch[0], newFunc);
    changed = true;
    console.log('[FIX] Replaced using loose match');
  } else {
    console.log('[ERROR] Could not find getAdminKey function at all');
    console.log('This suggests Session 6 admin.html patch may not have applied');
  }
}

if (changed) {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'admin.html'));
  console.log('[SYNC] public/admin.html -> admin.html');
  console.log('');
  console.log('Now commit and push:');
  console.log('  git add -A');
  console.log('  git commit -m "Fix admin Reviews tab: use correct adminKey variable"');
  console.log('  git push');
}
