// Quick fix-up: add the missing "Reviews" tab button to admin.html
// (the previous script's pattern didn't match; this uses a regex)

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'admin.html');
if (!fs.existsSync(filePath)) {
  console.error('public/admin.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

if (content.includes(`showTab('reviews')`)) {
  console.log('[OK] Reviews tab button already present');
  process.exit(0);
}

// Find the Leads tab line and add Reviews tab right after it
// Pattern is flexible: matches any whitespace/quoting variations
const leadsTabPattern = /(<div class="tab" onclick="showTab\('leads'\)">Leads<\/div>)(\s*)/;
const match = content.match(leadsTabPattern);

if (match) {
  const replacement = `${match[1]}\n  <div class="tab" onclick="showTab('reviews')">Reviews</div>${match[2]}`;
  content = content.replace(leadsTabPattern, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'admin.html'));
  console.log('[FIX] Added Reviews tab button to admin.html');
  console.log('[SYNC] public/admin.html -> admin.html');
} else {
  console.log('[ERROR] Could not find Leads tab line in admin.html');
  console.log('Manual fix: find the line `<div class="tab" onclick="showTab(\'leads\')">Leads</div>`');
  console.log('Right after it, add:');
  console.log('  <div class="tab" onclick="showTab(\'reviews\')">Reviews</div>');
  process.exit(1);
}

console.log('\nNow commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Session 6 fix-up: add Reviews tab button to admin"');
console.log('  git push');
