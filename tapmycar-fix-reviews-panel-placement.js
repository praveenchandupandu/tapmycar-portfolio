// ═══════════════════════════════════════════════════════════════════
// Fix Reviews panel placement in admin.html
// The panel was incorrectly placed AFTER </main></div>, so it renders
// outside the app layout. This script moves it inside content-wrap
// next to panel-scans, and adds Reviews to the TAB_TITLES/SUBS maps.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'admin.html');
if (!fs.existsSync(filePath)) {
  console.error('public/admin.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let totalFixes = 0;

// ─── 1. Extract the misplaced Reviews panel (panel HTML only) ────
// Find <!-- REVIEWS TAB --> through </div> of panel-reviews (before its script)
const panelStart = content.indexOf('<!-- REVIEWS TAB -->');
if (panelStart === -1) {
  console.log('[SKIP] Reviews panel not found in file');
  process.exit(0);
}

// Find the end of the panel div — the first </div> after <div id="reviews-list">
const reviewsListStart = content.indexOf('<div id="reviews-list">', panelStart);
const panelEndSearchStart = reviewsListStart + 30;
const panelCloseIdx = content.indexOf('</div>\n</div>', panelEndSearchStart);

if (panelCloseIdx === -1) {
  console.log('[ERROR] Could not find end of Reviews panel div');
  process.exit(1);
}
const panelEnd = panelCloseIdx + '</div>\n</div>'.length;

// Capture the panel HTML
const panelHtml = content.substring(panelStart, panelEnd);
console.log('[FOUND] Reviews panel HTML (' + panelHtml.length + ' chars)');

// Check: is it already inside content-wrap?
const contentWrapStart = content.indexOf('<div class="content-wrap">');
const contentWrapEnd = content.indexOf('</div>\n  </main>', contentWrapStart);
if (panelStart > contentWrapStart && panelStart < contentWrapEnd) {
  console.log('[OK] Panel already inside content-wrap');
} else {
  // 2. Remove panel from its wrong location
  content = content.substring(0, panelStart) + content.substring(panelEnd);
  console.log('[FIX] Removed Reviews panel from outside position');

  // Re-find content-wrap end after removal
  const newContentWrapEnd = content.indexOf('</div>\n  </main>', content.indexOf('<div class="content-wrap">'));
  if (newContentWrapEnd === -1) {
    console.error('[ERROR] Could not find content-wrap closing tag');
    process.exit(1);
  }

  // 3. Insert panel right before content-wrap closing </div>
  // The panel-scans usually ends just before that, so this puts Reviews after panel-scans
  const indent = '      ';
  const panelWithIndent = '\n' + indent + panelHtml.trim() + '\n\n    ';
  content = content.substring(0, newContentWrapEnd) + panelWithIndent + content.substring(newContentWrapEnd);
  console.log('[FIX] Inserted Reviews panel inside content-wrap');
  totalFixes++;
}

// ─── 4. Add reviews to TAB_TITLES and TAB_SUBS ─────────────
if (!content.includes('"reviews":')) {
  // TAB_TITLES
  content = content.replace(
    '"upgrade": "Upgrade tracker",',
    '"upgrade": "Upgrade tracker", "reviews": "Reviews",'
  );
  // TAB_SUBS
  content = content.replace(
    '"upgrade": "Users approaching day 30 auto-upgrade",',
    '"upgrade": "Users approaching day 30 auto-upgrade", "reviews": "Review moderation \u2014 approve, toggle visibility, feature on landing",'
  );
  if (content.includes('"reviews": "Reviews"')) {
    console.log('[FIX] Added Reviews title/subtitle to navigation');
    totalFixes++;
  }
} else {
  console.log('[OK] TAB_TITLES already has reviews entry');
}

// Save
if (totalFixes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'admin.html'));
  console.log('');
  console.log('[SYNC] public/admin.html -> admin.html');
}

console.log('');
console.log('\u2550'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('\u2550'.repeat(50));
console.log('');
console.log('Now commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Fix Reviews panel placement in admin"');
console.log('  git push');
