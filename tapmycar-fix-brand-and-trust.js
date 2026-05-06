// ═══════════════════════════════════════════════════════════════
// TapMyCar — V6 polish: brand area + trust pills
// ═══════════════════════════════════════════════════════════════
// Two cleanups requested after the page rendered correctly:
//
//   1. Brand area at top: show logo + "TapMyCar" title + "Privacy
//      for you, Safety for your Car" subtitle. Container slightly
//      taller to fit cleanly. (Previous patch dropped the title
//      assuming the logo wordmark was enough — user wants both.)
//
//   2. Trust pills below stats: currently in two rows
//      (Private+Instant on one line, Verified on its own centered
//      row). Merge into a single line with all three pills.
//      Labels shortened so all three fit on a 430px mobile width.
//
// Touches only public/contact.html. Idempotent.
// Run from project root:  node tapmycar-fix-brand-and-trust.js
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
const BACKUP = path.join(ROOT, 'backup-brand-trust-' + stamp);
fs.mkdirSync(BACKUP, { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP, 'contact.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');

let html = fs.readFileSync(TARGET, 'utf8');


// ────────────────────────────────────────────────────────────
// FIX 1 — Brand area: logo + TapMyCar title + tagline
// ────────────────────────────────────────────────────────────
console.log('━━━ Fix 1: Restore TapMyCar title in brand area ━━━');
{
  if (html.indexOf('TMC_BRAND_TITLE_RESTORED') !== -1) {
    console.log('  Already patched, skipping');
  } else {
    // Match the post-real-logo brand-l block and replace it with
    // logo + title + tagline. Keep flex layout so logo and text sit
    // side-by-side. Slight padding bump on .v6-top is set via inline
    // style override below the markup change.
    const oldBrandRegex = /<div class="v6-brand-l"><!-- TMC_REAL_LOGO --><img src="\/logo\.png"[^>]*><div class="v6-brand-text"><div class="v6-brand-tag"[^>]*>Privacy for you,<br>Safety for your Car<\/div><\/div><\/div>/;

    const newBrand = `<div class="v6-brand-l" style="gap:11px"><!-- TMC_BRAND_TITLE_RESTORED --><img src="/logo.png" alt="TapMyCar" style="height:38px;width:auto;display:block;flex-shrink:0"><div class="v6-brand-text" style="gap:2px"><div style="font-size:15px;font-weight:800;color:#0E0E0E;letter-spacing:-0.3px;line-height:1.1">Tap<span style="color:#FF6B00">My</span>Car</div><div style="font-size:10px;color:#6B7280;font-weight:500;line-height:1.3">Privacy for you,<br>Safety for your Car</div></div></div>`;

    if (!oldBrandRegex.test(html)) {
      console.error('  ERROR: could not find the post-logo brand-l block.');
      console.error('  Has the file structure changed since the last patch?');
      process.exit(1);
    }
    html = html.replace(oldBrandRegex, newBrand);

    // Bump .v6-top vertical padding slightly so the taller brand area breathes.
    // Match the .v6-top CSS rule and replace its padding.
    const oldTopPadRegex = /\.v6-top\{background:linear-gradient\(180deg,#fff,#FAFAF9\);padding:16px 20px 12px\}/;
    const newTopPad = '.v6-top{background:linear-gradient(180deg,#fff,#FAFAF9);padding:18px 20px 14px}';
    if (oldTopPadRegex.test(html)) {
      html = html.replace(oldTopPadRegex, newTopPad);
    }

    console.log('  Brand area now shows logo + TapMyCar title + tagline');
  }
}


// ────────────────────────────────────────────────────────────
// FIX 2 — Merge trust-row + verified-row into one line
// ────────────────────────────────────────────────────────────
console.log('');
console.log('━━━ Fix 2: Single line for all three trust pills ━━━');
{
  if (html.indexOf('TMC_TRUST_ONELINE') !== -1) {
    console.log('  Already patched, skipping');
  } else {
    // Match the existing trust-row + verified-row pair and replace with
    // a single trust-row containing all three pills. Labels shortened to
    // fit a 430px mobile width: Private / Instant alerts / Verified.
    const oldTrustRegex = /<div class="v6-trust-row">\s*<div class="v6-trust"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"\/><path d="M7 11V7a5 5 0 0 1 10 0v4"\/><\/svg><b>Number<\/b> stays private<\/div>\s*<div class="v6-trust"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"\/><polyline points="12 6 12 12 16 14"\/><\/svg>Notified <b>in seconds<\/b><\/div>\s*<\/div>\s*<div class="v6-verified-row">\s*<div class="v6-trust"><svg viewBox="0 0 24 24"><path d="M22 11\.08V12a10 10 0 1 1-5\.93-9\.14"\/><polyline points="22 4 12 14\.01 9 11\.01"\/><\/svg><b>Verified<\/b> tag<\/div>\s*<\/div>/;

    const newTrust = `<!-- TMC_TRUST_ONELINE --><div class="v6-trust-row" style="justify-content:center;gap:6px;flex-wrap:nowrap"><div class="v6-trust" style="padding:6px 9px;font-size:10px"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><b>Private</b></div><div class="v6-trust" style="padding:6px 9px;font-size:10px"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><b>Instant</b> alerts</div><div class="v6-trust" style="padding:6px 9px;font-size:10px"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><b>Verified</b></div></div>`;

    if (!oldTrustRegex.test(html)) {
      console.error('  ERROR: could not find trust-row + verified-row pair.');
      process.exit(1);
    }
    html = html.replace(oldTrustRegex, newTrust);
    console.log('  Trust pills now in a single line: Private | Instant alerts | Verified');
  }
}


fs.writeFileSync(TARGET, html, 'utf8');

console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  BRAND + TRUST FIX COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Deploy:');
console.log('  git add public/contact.html');
console.log('  git commit -m "V6 polish: brand title + single-line trust pills"');
console.log('  git push');
