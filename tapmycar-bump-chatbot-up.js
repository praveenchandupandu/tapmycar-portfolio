// Increase chatbot bubble offset from 88px to 110px above bottom nav
// so it doesn't overlap with the nav icons on mobile

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'app.js');
if (!fs.existsSync(filePath)) {
  console.error('public/app.js not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let fixes = 0;

// Bubble position
if (content.includes("bubble.style.bottom = '88px';")) {
  content = content.replace("bubble.style.bottom = '88px';", "bubble.style.bottom = '110px';");
  console.log('[FIX] Bubble offset: 88px → 110px');
  fixes++;
} else if (content.includes("bubble.style.bottom = '110px';")) {
  console.log('[OK] Bubble already at 110px');
}

// Badge position (moves with bubble)
if (content.includes("badge.style.bottom = '136px';")) {
  content = content.replace("badge.style.bottom = '136px';", "badge.style.bottom = '158px';");
  console.log('[FIX] Badge offset: 136px → 158px');
  fixes++;
} else if (content.includes("badge.style.bottom = '158px';")) {
  console.log('[OK] Badge already at 158px');
}

if (fixes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  if (fs.existsSync(path.join(ROOT, 'app.js'))) {
    fs.copyFileSync(filePath, path.join(ROOT, 'app.js'));
  }
  console.log('[SYNC] public/app.js -> app.js');
}

console.log('');
console.log('='.repeat(50));
console.log(`Total fixes: ${fixes}`);
console.log('='.repeat(50));
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Chatbot: bump bubble higher above bottom nav"');
console.log('  git push');
