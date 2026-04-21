// Add app.js include to landing.html so the chatbot injects properly.
// This is the ONLY missing piece — app.js auto-calls injectChatbot()
// on DOMContentLoaded, which creates the orange bubble in bottom-right.

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'landing.html');
if (!fs.existsSync(filePath)) {
  console.error('public/landing.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('src="/app.js"') || content.includes("src='/app.js'")) {
  console.log('[OK] app.js is already included');
  process.exit(0);
}

// Insert just before </body>
const scriptTag = '<script src="/app.js"></script>\n';

if (content.includes('</body>')) {
  content = content.replace('</body>', scriptTag + '</body>');
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'landing.html'));
  console.log('[FIX] Added <script src="/app.js"></script> to landing.html');
  console.log('[SYNC] public/landing.html -> landing.html');
  console.log('');
  console.log('Now commit and push:');
  console.log('  git add -A');
  console.log('  git commit -m "Landing: include app.js so chatbot loads"');
  console.log('  git push');
} else {
  console.error('[ERROR] Could not find </body> tag in landing.html');
  process.exit(1);
}
