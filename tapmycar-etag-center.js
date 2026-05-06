// ═══════════════════════════════════════════════════════════════
// TapMyCar — etag.html promo box center alignment
// ═══════════════════════════════════════════════════════════════
// Centers all content inside the orange "Standard plan" promo box
// on etag.html so the layout looks balanced:
//   - "MOST POPULAR" label
//   - "Get a real physical tag shipped to your door" headline
//   - The 4 feature bullets
//   - The "Get Standard — $9.99/yr" button
//
// Run from project root:  node tapmycar-etag-center.js
// Touches only public/etag.html. Idempotent.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET = path.join(ROOT, 'public', 'etag.html');

if (!fs.existsSync(TARGET)) {
  console.error('ERROR: public/etag.html not found.');
  process.exit(1);
}

// ─── BACKUP ──────────────────────────────────────────────────
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-etag-center-' + stamp);
fs.mkdirSync(BACKUP, { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP, 'etag.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));

// ─── PATCH etag.html ─────────────────────────────────────────
let html = fs.readFileSync(TARGET, 'utf8');

if (html.indexOf('TMC_ETAG_CENTER_PATCHED') !== -1) {
  console.log('  Already patched — no changes made');
} else {
  const oldBlock = `  <div id="standard-promo" style="width:100%;background:linear-gradient(135deg,#FF6B00,#D21209);border-radius:18px;padding:18px 16px;position:relative;overflow:hidden">
    <div style="position:absolute;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.08);right:-15px;top:-25px"></div>
    <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.75);margin-bottom:4px;letter-spacing:.8px;text-transform:uppercase">Most popular</div>
    <div style="font-size:17px;font-weight:800;color:#fff;line-height:1.3;margin-bottom:8px">Get a real physical tag<br>shipped to your door</div>
    <div style="font-size:11px;color:rgba(255,255,255,.85);line-height:1.7;margin-bottom:12px">
      <span style="color:#FFE4CC">Physical NFC + QR sticker for your window</span><br>
      <span style="color:#FFE4CC">Know WHERE your car was scanned</span><br>
      <span style="color:#FFE4CC">Screen every call before answering</span><br>
      <span style="color:#FFE4CC">Your number NEVER shared with anyone</span>
    </div>
    <a href="/pricing.html" style="display:inline-block;background:#fff;color:#FF6B00;font-size:13px;font-weight:800;padding:11px 22px;border-radius:12px;text-decoration:none">Get Standard — $9.99/yr</a>
  </div>`;

  const newBlock = `  <!-- TMC_ETAG_CENTER_PATCHED -->
  <div id="standard-promo" style="width:100%;background:linear-gradient(135deg,#FF6B00,#D21209);border-radius:18px;padding:22px 18px;position:relative;overflow:hidden;text-align:center">
    <div style="position:absolute;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.08);right:-15px;top:-25px"></div>
    <div style="position:absolute;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.06);left:-20px;bottom:-20px"></div>
    <div style="display:inline-block;font-size:9px;font-weight:800;color:#FF6B00;background:#fff;padding:4px 12px;border-radius:99px;margin-bottom:10px;letter-spacing:.08em;text-transform:uppercase;position:relative;z-index:1;box-shadow:0 2px 8px rgba(0,0,0,.12)">Most popular</div>
    <div style="font-size:18px;font-weight:800;color:#fff;line-height:1.3;margin-bottom:12px;letter-spacing:-0.01em;position:relative;z-index:1">Get a real physical tag<br>shipped to your door</div>
    <div style="font-size:11px;color:rgba(255,255,255,.92);line-height:1.85;margin-bottom:16px;position:relative;z-index:1">
      <div>Physical NFC + QR sticker for your window</div>
      <div>Know WHERE your car was scanned</div>
      <div>Screen every call before answering</div>
      <div>Your number NEVER shared with anyone</div>
    </div>
    <a href="/pricing.html" style="display:inline-block;background:#fff;color:#FF6B00;font-size:13px;font-weight:800;padding:12px 28px;border-radius:99px;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.18);position:relative;z-index:1">Get Standard — $9.99/yr</a>
  </div>`;

  if (html.indexOf(oldBlock) === -1) {
    // Try regex fallback in case line endings differ
    const fallbackRegex = /<div id="standard-promo"[\s\S]*?Get Standard — \$9\.99\/yr<\/a>\s*<\/div>/;
    if (fallbackRegex.test(html)) {
      html = html.replace(fallbackRegex, newBlock);
      fs.writeFileSync(TARGET, html, 'utf8');
      console.log('  Patched etag.html (fallback regex)');
    } else {
      console.error('  ERROR: Could not find the standard-promo block.');
      process.exit(1);
    }
  } else {
    html = html.replace(oldBlock, newBlock);
    fs.writeFileSync(TARGET, html, 'utf8');
    console.log('  Patched etag.html (exact match)');
  }
}

console.log('\n═══════════════════════════════════════════════');
console.log('  ETAG.HTML CENTER ALIGNMENT COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Changes inside the orange Standard-plan box:');
console.log('  ✓ All text now center-aligned');
console.log('  ✓ "Most popular" upgraded to a white pill badge');
console.log('  ✓ Headline 17px → 18px with tighter letter-spacing');
console.log('  ✓ Bullets now use proper <div> spacing instead of <br>');
console.log('  ✓ "Get Standard" button is now pill-shaped (radius 99px)');
console.log('    with a deeper shadow, padding bumped to 12px 28px');
console.log('  ✓ Added a second soft highlight blob for depth');
console.log('');
console.log('Test: open public/etag.html, scroll to the orange box');
console.log('— everything should now be centered.');
