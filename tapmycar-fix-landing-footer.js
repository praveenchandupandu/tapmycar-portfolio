// ═══════════════════════════════════════════════════════════════
// Fix landing.html footer:
//   1. "New Britain, CT" → "Connecticut, USA"
//   2. Contact button → open the existing chatbot (toggleChat)
//      instead of mailto (which does nothing if no default mail app)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'landing.html');
if (!fs.existsSync(filePath)) {
  console.error('public/landing.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let fixes = 0;

// ─── 1. Location text ──────────────────────────────────────
const locPatterns = [
  { find: 'New Britain, CT', replace: 'Connecticut, USA' },
  { find: 'New Britain,CT', replace: 'Connecticut, USA' },
  { find: 'New Britain , CT', replace: 'Connecticut, USA' }
];

for (const { find, replace } of locPatterns) {
  if (content.includes(find)) {
    content = content.split(find).join(replace);
    console.log(`[FIX] Location: "${find}" → "${replace}"`);
    fixes++;
  }
}

if (content.includes('Connecticut, USA')) {
  console.log('[VERIFY] Connecticut, USA is now in footer');
} else {
  console.log('[WARN] Location replacement may not have matched — checking file content...');
}

// ─── 2. Contact link → toggleChat() ────────────────────────
// Replace the mailto anchor with a link that opens the chatbot
const oldContactPatterns = [
  '<a href="mailto:support@tapmycar.io">Contact</a>',
  "<a href='mailto:support@tapmycar.io'>Contact</a>",
  '<a href="mailto:support@tapmycar.io" >Contact</a>'
];

const newContact = `<a href="#" onclick="event.preventDefault();if(typeof toggleChat==='function'){toggleChat();}else{window.location.href='mailto:support@tapmycar.io';}">Contact</a>`;

let contactFixed = false;
for (const oldPattern of oldContactPatterns) {
  if (content.includes(oldPattern)) {
    content = content.replace(oldPattern, newContact);
    console.log('[FIX] Contact link now opens chatbot (falls back to mailto if chatbot not loaded)');
    contactFixed = true;
    fixes++;
    break;
  }
}

if (!contactFixed) {
  // Check if already fixed
  if (content.includes("toggleChat()")) {
    console.log('[OK] Contact already wired to chatbot');
  } else {
    console.log('[WARN] Contact link pattern not found — manual check needed');
  }
}

// Save
if (fixes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'landing.html'));
  console.log('[SYNC] public/landing.html -> landing.html');
}

console.log('');
console.log('='.repeat(50));
console.log(`Total fixes: ${fixes}`);
console.log('='.repeat(50));
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Landing footer: Connecticut USA + Contact opens chatbot"');
console.log('  git push');
