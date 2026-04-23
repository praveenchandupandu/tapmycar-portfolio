// Fix: Add .bnav to chatbot nav detector.
// The dashboard/activity/manage/verify pages use <nav class="bnav">
// which my old selectors didn't match. Adding it now.

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'app.js');
if (!fs.existsSync(filePath)) {
  console.error('public/app.js not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

// Check if .bnav is already in the selector list
const alreadyFixed = /\.mobile-bottom,\s*\.bnav/.test(content) ||
                     /\.bnav,\s*\.mobile-bottom/.test(content) ||
                     content.includes("'.bnav'");

if (alreadyFixed) {
  console.log('[OK] .bnav already in selector list');
  process.exit(0);
}

// Find the multi-selector CSS string and add .bnav to it
const oldSelector = `'.mobile-bottom, .bottom-nav, .bottom-tabs, .tab-bar, nav.bottom, [class*="bottom-nav"], [class*="mobile-nav"]'`;
const newSelector = `'.mobile-bottom, .bnav, .bottom-nav, .bottom-tabs, .tab-bar, nav.bottom, [class*="bottom-nav"], [class*="mobile-nav"]'`;

if (content.includes(oldSelector)) {
  content = content.replace(oldSelector, newSelector);
  console.log('[FIX] Added .bnav to nav detector selectors');
} else {
  // Flexible match — find any querySelector string that has .mobile-bottom
  const flexPattern = /'\.mobile-bottom([^']+)'/;
  const match = content.match(flexPattern);
  if (match) {
    content = content.replace(flexPattern, "'.mobile-bottom, .bnav$1'");
    console.log('[FIX] Added .bnav via flexible match');
  } else {
    console.error('[ERROR] Could not find chatbot selector list to patch');
    process.exit(1);
  }
}

fs.writeFileSync(filePath, content, 'utf8');
if (fs.existsSync(path.join(ROOT, 'app.js'))) {
  fs.copyFileSync(filePath, path.join(ROOT, 'app.js'));
}
console.log('[SYNC] public/app.js -> app.js');
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Chatbot: detect .bnav as bottom nav (dashboard pages)"');
console.log('  git push');
