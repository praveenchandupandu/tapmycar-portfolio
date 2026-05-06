// ═══════════════════════════════════════════════════════════════
// TapMyCar — fix V6 vehicle population + restore real logo
// ═══════════════════════════════════════════════════════════════
// Two issues visible after the V6 contact page started rendering:
//
//   1. Vehicle hero shows "Vehicle" instead of "Subaru Impreza"
//      Root cause: the V6 script captures tag data via a fetch
//      wrapper that reads response.clone().json() asynchronously.
//      v6PopulateActive fires 50ms after showState('active') but
//      window._tag may not be set yet (race condition).
//
//      Fix: set window._tag synchronously inside loadTag() before
//      showState fires. Removes the race entirely.
//
//   2. Logo at top-left is the abstract V6 brand-mark (small orange
//      square) instead of the actual TapMyCar logo image.
//
//      Fix: replace the v6-brand-mark div with <img src="/logo.png">
//      and drop the redundant "TapMyCar" text (logo already shows it).
//
// Run from project root:  node tapmycar-fix-vehicle-and-logo.js
// Idempotent. Touches only public/contact.html.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET = path.join(ROOT, 'public', 'contact.html');

if (!fs.existsSync(TARGET)) {
  console.error('ERROR: public/contact.html not found.');
  process.exit(1);
}

// Backup
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-vehicle-logo-' + stamp);
fs.mkdirSync(BACKUP, { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP, 'contact.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');

let html = fs.readFileSync(TARGET, 'utf8');


// ────────────────────────────────────────────────────────────
// FIX 1 — Set window._tag synchronously in loadTag
// ────────────────────────────────────────────────────────────
console.log('━━━ Fix 1: Sync window._tag in loadTag ━━━');
{
  if (html.indexOf('TMC_SYNC_TAG_FIXED') !== -1) {
    console.log('  Already patched, skipping');
  } else {
    // Find: showState("active");currentScanId
    // Replace with: /*TMC_SYNC_TAG_FIXED*/window._tag=data.tag;showState("active");currentScanId
    const oldStr = 'showState("active");currentScanId';
    const newStr = '/*TMC_SYNC_TAG_FIXED*/window._tag=data.tag;showState("active");currentScanId';

    if (html.indexOf(oldStr) === -1) {
      console.error('  ERROR: could not find showState("active");currentScanId pattern');
      console.error('  Has the file structure changed?');
      process.exit(1);
    }
    html = html.replace(oldStr, newStr);
    console.log('  loadTag now sets window._tag synchronously before showState');
  }
}


// ────────────────────────────────────────────────────────────
// FIX 2 — Replace V6 abstract brand-mark with real logo image
// ────────────────────────────────────────────────────────────
console.log('');
console.log('━━━ Fix 2: Use real /logo.png in brand area ━━━');
{
  if (html.indexOf('TMC_REAL_LOGO') !== -1) {
    console.log('  Already patched, skipping');
  } else {
    // The current V6 brand row looks like:
    //   <div class="v6-brand-l">
    //     <div class="v6-brand-mark"></div>
    //     <div class="v6-brand-text">
    //       <div class="v6-brand-name">Tap<span>My</span>Car</div>
    //       <div class="v6-brand-tag">Privacy for you, Safety for your Car</div>
    //     </div>
    //   </div>
    //
    // Replace with the actual logo image + tagline only (since the logo
    // image already contains the TapMyCar wordmark).

    // Match the brand-l block (handles whitespace variations).
    const oldBlockRegex = /<div class="v6-brand-l">\s*<div class="v6-brand-mark"><\/div>\s*<div class="v6-brand-text">\s*<div class="v6-brand-name">Tap<span>My<\/span>Car<\/div>\s*<div class="v6-brand-tag">Privacy for you, Safety for your Car<\/div>\s*<\/div>\s*<\/div>/;

    const newBlock = `<div class="v6-brand-l"><!-- TMC_REAL_LOGO --><img src="/logo.png" alt="TapMyCar" style="height:36px;width:auto;display:block;flex-shrink:0"><div class="v6-brand-text"><div class="v6-brand-tag" style="font-size:10px;color:#6B7280;font-weight:500;line-height:1.3">Privacy for you,<br>Safety for your Car</div></div></div>`;

    if (!oldBlockRegex.test(html)) {
      console.error('  ERROR: could not find V6 brand-l block to replace.');
      console.error('  Was the V6 design deployed differently? Bailing.');
      process.exit(1);
    }
    html = html.replace(oldBlockRegex, newBlock);
    console.log('  Brand area now uses /logo.png with tagline beside it');
  }
}


fs.writeFileSync(TARGET, html, 'utf8');

console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  VEHICLE + LOGO FIX COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Deploy:');
console.log('  git add public/contact.html');
console.log('  git commit -m "V6 fixes: sync vehicle data + use real logo"');
console.log('  git push');
console.log('');
console.log('After deploy, hard-refresh the contact URL:');
console.log('  - Logo at top-left should be the real TapMyCar logo');
console.log('  - Dark hero should show "SUBARU IMPREZA" with color/year/plate pills');
