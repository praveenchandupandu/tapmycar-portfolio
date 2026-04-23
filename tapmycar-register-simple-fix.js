// ═══════════════════════════════════════════════════════════════
// Simple fix for register.html: change both button wrapper styles
// from margin-top:24px to margin-top:auto so button + footer get
// pushed to bottom (like signin page).
//
// Uses occurrence counting: register.html has EXACTLY 2 occurrences
// of `<div style="margin-top:24px">` — both are button wrappers.
// We replace both.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'register.html');
if (!fs.existsSync(filePath)) {
  console.error('public/register.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

const target = '<div style="margin-top:24px">';
const replacement = '<div style="margin-top:auto">';

const count = content.split(target).length - 1;
console.log(`Found ${count} occurrences of "${target}"`);

if (count === 0) {
  console.log('[WARN] Target string not found. Maybe already fixed?');
  process.exit(0);
}

content = content.split(target).join(replacement);
fs.writeFileSync(filePath, content, 'utf8');
const rootCopy = path.join(ROOT, 'register.html');
if (fs.existsSync(rootCopy)) fs.copyFileSync(filePath, rootCopy);
console.log(`[FIX] Replaced ${count} occurrences with margin-top:auto`);
console.log('[SYNC] public/register.html -> register.html');
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Register: button wrappers use margin-top:auto (push to bottom)"');
console.log('  git push');
