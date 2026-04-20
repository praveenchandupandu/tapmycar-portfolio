// Diagnostic + flexible Reviews tab patcher for admin.html

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'admin.html');
if (!fs.existsSync(filePath)) {
  console.error('public/admin.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

if (content.includes("showTab('reviews')") || content.includes('showTab("reviews")')) {
  console.log('[OK] Reviews tab button already present \u2014 nothing to do');
  process.exit(0);
}

console.log('Searching for Leads tab in admin.html...');
console.log('');

// Try multiple regex patterns to handle quote/whitespace variations
const patterns = [
  { name: "single-quoted leads",  re: /<div\s+class="tab"\s+onclick="showTab\('leads'\)"\s*>\s*Leads\s*<\/div>/ },
  { name: "double-quoted leads",  re: /<div\s+class="tab"\s+onclick='showTab\("leads"\)'\s*>\s*Leads\s*<\/div>/ },
  { name: "escaped quotes",       re: /<div\s+class="tab"\s+onclick="showTab\(\\?['"]leads\\?['"]\)"\s*>\s*Leads\s*<\/div>/ },
  { name: "showTab leads anywhere",re: /(<div[^>]*class=["']tab["'][^>]*showTab\([^)]*leads[^)]*\)[^>]*>\s*Leads\s*<\/div>)/i }
];

let matched = null;
let matchedPattern = null;
for (const p of patterns) {
  const m = content.match(p.re);
  if (m) {
    matched = m;
    matchedPattern = p;
    console.log(`[FOUND] using pattern: ${p.name}`);
    console.log(`[MATCH] "${m[0]}"`);
    break;
  }
}

if (!matched) {
  // Diagnostic: show what's actually around any "Leads" text
  console.log('[NO MATCH] None of the patterns worked.');
  console.log('');
  console.log('Diagnostic - showing lines containing "Leads":');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes('leads') && line.includes('tab')) {
      console.log(`  Line ${i + 1}: ${line}`);
    }
  });
  console.log('');
  console.log('MANUAL FIX:');
  console.log('1. Open public/admin.html in Notepad');
  console.log('2. Press Ctrl+F, search for: Leads</div>');
  console.log('3. Find the line that looks like a tab button (has class="tab")');
  console.log('4. Right AFTER that line, paste this on a new line:');
  console.log('');
  console.log('  <div class="tab" onclick="showTab(\'reviews\')">Reviews</div>');
  console.log('');
  console.log('5. Save the file (make sure encoding stays as UTF-8)');
  console.log('6. Run: Copy-Item "public\\admin.html" "admin.html" -Force');
  console.log('7. Then: git add -A; git commit -m "Add Reviews tab"; git push');
  process.exit(1);
}

// Build replacement: keep the matched leads line, add Reviews line right after
const reviewsTabHtml = `\n  <div class="tab" onclick="showTab('reviews')">Reviews</div>`;
content = content.replace(matched[0], matched[0] + reviewsTabHtml);

fs.writeFileSync(filePath, content, 'utf8');
fs.copyFileSync(filePath, path.join(ROOT, 'admin.html'));
console.log('');
console.log('[FIX] Reviews tab button added to admin.html');
console.log('[SYNC] public/admin.html -> admin.html');
console.log('');
console.log('Now commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Session 6 fix-up: add Reviews tab button"');
console.log('  git push');
