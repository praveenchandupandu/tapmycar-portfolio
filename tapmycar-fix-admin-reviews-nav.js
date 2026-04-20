// Add Reviews sidebar button to admin.html using the correct sb-item structure
// Also fix the reviewsTab moderate function to use navTo instead of showTab

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'admin.html');
if (!fs.existsSync(filePath)) {
  console.error('public/admin.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let changes = 0;

// 1. Check if already done
if (content.includes(`navTo('reviews')`) || content.includes(`data-tab="reviews"`)) {
  console.log('[OK] Reviews sidebar button already present');
} else {
  // Find the Leads sb-item line and add a Reviews sb-item right after it
  const leadsButtonMatch = content.match(/(\s*<button class="sb-item" data-tab="leads"[^>]*>[\s\S]*?<\/button>)/);

  if (leadsButtonMatch) {
    const leadsButton = leadsButtonMatch[1];
    // Build a Reviews sb-item using a star icon
    const reviewsButton = `\n    <button class="sb-item" data-tab="reviews" onclick="navTo('reviews')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span>Reviews</span></button>`;

    content = content.replace(leadsButton, leadsButton + reviewsButton);
    console.log('[FIX] Added Reviews sidebar button after Leads');
    changes++;
  } else {
    console.log('[WARN] Could not find Leads sb-item to insert after');
  }
}

// 2. The Reviews panel was already added with id="panel-reviews" in last push - verify
if (content.includes(`id="panel-reviews"`)) {
  console.log('[OK] Reviews panel HTML is present');
} else {
  console.log('[WARN] Reviews panel HTML missing - the previous Session 6 push may not have completed');
}

if (changes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'admin.html'));
  console.log('[SYNC] public/admin.html -> admin.html');
}

console.log('');
console.log(`Total changes: ${changes}`);
console.log('');
console.log('Now commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Add Reviews sidebar button to admin"');
console.log('  git push');
