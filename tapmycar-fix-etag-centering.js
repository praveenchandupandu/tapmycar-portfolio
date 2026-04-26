// ════════════════════════════════════════════════════════════════
// FIX: etag.html appears off-center on desktop because the 430px
// content has a white background blending into the surrounding 
// white viewport. Add a subtle gray/orange-tinted background so 
// the centered card visually stands out.
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'etag.html');
if (!fs.existsSync(filePath)) {
  console.error('public/etag.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

if (content.indexOf('id="etag-desktop-frame"') !== -1) {
  console.log('[OK] etag.html already has desktop framing');
  process.exit(0);
}

// Insert <style> block right before </head> so it overrides the global app.css
const insertStyle = `<style id="etag-desktop-frame">
  /* Desktop visual framing — soft gray background so the 430px white
     content container is visually distinct and clearly centered.
     Mobile (under 480px) still looks 100% the same. */
  @media (min-width: 481px) {
    html, body {
      background: linear-gradient(180deg, #FFF7F0 0%, #F5F5F7 100%) !important;
      min-height: 100vh;
    }
    body {
      max-width: 430px !important;
      margin: 0 auto !important;
      background: #fff !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
      border-radius: 0;
      min-height: 100vh;
      position: relative;
    }
  }
</style>
</head>`;

if (content.indexOf('</head>') === -1) {
  console.error('[ERROR] No </head> tag found');
  process.exit(1);
}

content = content.replace('</head>', insertStyle);

fs.writeFileSync(filePath, content, 'utf8');
const rootCopy = path.join(ROOT, 'etag.html');
if (fs.existsSync(rootCopy)) {
  fs.copyFileSync(filePath, rootCopy);
}

console.log('[FIX] Added desktop framing to etag.html');
console.log('       - Soft orange-tinted gray background fills the viewport on desktop');
console.log('       - 430px white content container has subtle shadow');
console.log('       - Mobile view unchanged');
console.log('[SYNC] public/etag.html -> etag.html');
console.log('');
console.log('Commit and push:');
console.log('  git diff public/etag.html');
console.log('  git add -A');
console.log('  git commit -m "etag.html: add desktop framing so 430px container looks centered"');
console.log('  git push');
