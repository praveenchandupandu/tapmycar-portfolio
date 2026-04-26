// ════════════════════════════════════════════════════════════════
// Fix etag.html inner alignment:
// 1. "Or get your free digital eTag" heading: add text-align:center
// 2. .sticker box (200px wide): add margin:0 auto so it centers in 
//    the 430px parent
// 3. TapMyCar + #token row: change from space-between (which spreads
//    them to corners) to centered with smaller gap
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
let fixes = 0;

// FIX 1: Center the "Or get your free digital eTag" label
const oldHeading = '<div style="font-size:11px;font-weight:700;color:#6B7280;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Or get your free digital eTag</div>';
const newHeading = '<div style="font-size:11px;font-weight:700;color:#6B7280;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px;text-align:center">Or get your free digital eTag</div>';

if (content.indexOf(oldHeading) !== -1) {
  content = content.replace(oldHeading, newHeading);
  console.log('[FIX] Heading text now centered');
  fixes++;
}

// FIX 2: Center the .sticker container (was width:200px floating left)
const oldSticker = '<div class="sticker" style="width:200px">';
const newSticker = '<div class="sticker" style="width:200px;margin:0 auto">';

if (content.indexOf(oldSticker) !== -1) {
  content = content.replace(oldSticker, newSticker);
  console.log('[FIX] Sticker container now centered');
  fixes++;
}

// FIX 3: TapMyCar logo + token row — change from space-between to centered with small gap
const oldRow = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:15px;font-weight:800;color:var(--bk)">TapMyCar<span style="color:var(--or)">.</span></div><div style="font-size:9px;color:var(--gy)" id="sticker-token">#---</div></div>';
const newRow = '<div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-bottom:10px"><div style="font-size:15px;font-weight:800;color:var(--bk)">TapMyCar<span style="color:var(--or)">.</span></div><div style="font-size:9px;color:var(--gy)" id="sticker-token">#---</div></div>';

if (content.indexOf(oldRow) !== -1) {
  content = content.replace(oldRow, newRow);
  console.log('[FIX] TapMyCar logo + token now centered together');
  fixes++;
}

if (fixes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  const rootCopy = path.join(ROOT, 'etag.html');
  if (fs.existsSync(rootCopy)) {
    fs.copyFileSync(filePath, rootCopy);
  }
  console.log('[SYNC] public/etag.html -> etag.html');
}

console.log('');
console.log('═'.repeat(50));
console.log('Total fixes: ' + fixes);
console.log('═'.repeat(50));

if (fixes === 0) {
  console.log('[WARN] No fixes applied. File patterns may have changed.');
}

console.log('');
console.log('Commit and push:');
console.log('  git diff public/etag.html');
console.log('  git add -A');
console.log('  git commit -m "etag.html: center inner heading + sticker + logo row"');
console.log('  git push');
