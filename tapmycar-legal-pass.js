// tapmycar-legal-pass.js
// Session 1 — all legal compliance fixes in one atomic run.
// Safe to run multiple times. Skips edits already applied.
//
// Run from project root:
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-legal-pass.js

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT_DIR = __dirname;

// ───────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────
let ok = 0, skip = 0, fail = 0;

function readPublic(file) {
  const p = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function writePublicAndRoot(file, html) {
  fs.writeFileSync(path.join(PUBLIC_DIR, file), html, 'utf8');
  const rootP = path.join(ROOT_DIR, file);
  if (fs.existsSync(rootP)) fs.writeFileSync(rootP, html, 'utf8');
}

function applyEdit(file, label, oldStr, newStr, markerIfAlreadyDone) {
  let html = readPublic(file);
  if (html === null) { console.log(`[MISS] ${file} — file not found`); fail++; return; }
  if (markerIfAlreadyDone && html.includes(markerIfAlreadyDone)) {
    console.log(`[SKIP] ${file} — ${label} already applied`);
    skip++; return;
  }
  if (!html.includes(oldStr)) {
    console.log(`[FAIL] ${file} — ${label} pattern not found (file may have changed)`);
    fail++; return;
  }
  html = html.replace(oldStr, newStr);
  writePublicAndRoot(file, html);
  console.log(`[OK]   ${file} — ${label}`);
  ok++;
}

// ───────────────────────────────────────────────────────────────
// T&C DISCLAIMER (sign-in-wrap pattern for register.html)
// ───────────────────────────────────────────────────────────────
const TC_DISCLAIMER = `    <div style="font-size:11px;color:#6B7280;text-align:center;line-height:1.55;margin-bottom:12px;padding:0 8px">
      By continuing, you agree to our <a href="/terms.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Terms of Service</a> and <a href="/privacy.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Privacy Policy</a>.
    </div>
    `;

applyEdit(
  'register.html',
  'T&C disclaimer above "Send verification code"',
  '    <button class="btn" onclick="sendOTP()">Send verification code ',
  TC_DISCLAIMER + '<button class="btn" onclick="sendOTP()">Send verification code ',
  'By continuing, you agree to our <a href="/terms.html"'
);

// Inject T&C before the verify button, idempotently.
// (We don't use applyEdit here because a simple marker check can't distinguish
//  "already added before sendOTP" from "already added before verify" — both look
//  the same globally. So we check the 400 chars right before the verify button.)
(function injectTCBeforeVerifyButton() {
  const file = 'register.html';
  let html = readPublic(file);
  if (html === null) { console.log(`[MISS] ${file} — file not found`); fail++; return; }
  const verifyIdx = html.indexOf('<button class="btn" onclick="verifyOTP()">');
  if (verifyIdx === -1) {
    console.log(`[FAIL] ${file} — verify button not found`);
    fail++; return;
  }
  const before = html.substring(Math.max(0, verifyIdx - 400), verifyIdx);
  if (before.includes('By continuing, you agree')) {
    console.log(`[SKIP] ${file} — T&C disclaimer above verify button already applied`);
    skip++; return;
  }
  const injected = html.substring(0, verifyIdx) + TC_DISCLAIMER.trimStart() + html.substring(verifyIdx);
  writePublicAndRoot(file, injected);
  console.log(`[OK]   ${file} — T&C disclaimer above verify button`);
  ok++;
})();

// ───────────────────────────────────────────────────────────────
// CONTACT.HTML — privacy notice for strangers who scan
// ───────────────────────────────────────────────────────────────

// 1) Make the location notice always visible (remove display:none) + add Privacy link
applyEdit(
  'contact.html',
  'Always-visible privacy notice for strangers',
  '<div id="location-notice" style="background:#FFF3EC;padding:10px 20px;border-bottom:.5px solid #FFE4CC;display:none"><p style="font-size:11px;color:#92400E;text-align:center">TapMyCar may request your approximate location to help the vehicle owner. Your identity is never shared.</p></div>',
  '<div id="location-notice" style="background:#FFF3EC;padding:10px 20px;border-bottom:.5px solid #FFE4CC"><p style="font-size:11px;color:#92400E;text-align:center;line-height:1.55">Your device type, approximate location (if you allow it), and any message or photo you send are shared with the vehicle owner. Your phone number is never shared. <a href="/privacy.html" style="color:#FF6B00;font-weight:600;text-decoration:none">Privacy Policy</a></p></div>',
  'Privacy Policy</a></p></div>\n  <div style="padding:16px 20px;display:flex'
);

// 2) Update the bottom "Official TapMyCar tag" line to include Privacy link
applyEdit(
  'contact.html',
  'Bottom tag footer includes Privacy link',
  '<div style="text-align:center;font-size:10px;color:#9CA3AF;padding:4px 0">Official TapMyCar tag - Praman Tech LLC - <a href="https://tapmycar.io" style="color:#FF6B00;text-decoration:none">tapmycar.io</a></div>',
  '<div style="text-align:center;font-size:10px;color:#9CA3AF;padding:6px 0;line-height:1.6">Official TapMyCar tag · Praman Tech LLC · <a href="https://tapmycar.io" style="color:#FF6B00;text-decoration:none">tapmycar.io</a><br><a href="/privacy.html" style="color:#9CA3AF;text-decoration:underline">Privacy</a> · <a href="/terms.html" style="color:#9CA3AF;text-decoration:underline">Terms</a></div>',
  '<a href="/privacy.html" style="color:#9CA3AF;text-decoration:underline">Privacy</a>'
);

// ───────────────────────────────────────────────────────────────
// SETTINGS.HTML — add Legal section (Privacy + Terms links)
// ───────────────────────────────────────────────────────────────
const LEGAL_SECTION = `  <!-- Legal -->
  <div class="sl">Legal</div>
  <div class="set-row" onclick="window.location.href='/privacy.html'"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)" fill="none" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div><div><div class="set-t">Privacy Policy</div><div class="set-s">How we handle your data</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>
  <div class="set-row" onclick="window.location.href='/terms.html'"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)" fill="none" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><div class="set-t">Terms of Service</div><div class="set-s">Rules for using TapMyCar</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>

`;

applyEdit(
  'settings.html',
  'Legal section (Privacy + Terms) before Support',
  '  <!-- Support -->',
  LEGAL_SECTION + '  <!-- Support -->',
  `onclick="window.location.href='/privacy.html'"`
);

// ───────────────────────────────────────────────────────────────
// FOOTER — add to pages lacking one
// ───────────────────────────────────────────────────────────────
const UNIVERSAL_FOOTER = `
<div style="padding:20px 20px 32px;text-align:center;border-top:.5px solid #E5E7EB;margin-top:24px;background:#fff">
  <p style="font-size:11px;color:#9CA3AF;margin:0 0 4px">
    <a href="/privacy.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Privacy</a>
    &nbsp;·&nbsp;
    <a href="/terms.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Terms</a>
    &nbsp;·&nbsp;
    <a href="mailto:support@tapmycar.io" style="color:#FF6B00;text-decoration:none;font-weight:600">Support</a>
  </p>
  <p style="font-size:11px;color:#9CA3AF;margin:0">© 2026 Praman Tech LLC</p>
</div>

`;

const PAGES_NEEDING_FOOTER = [
  'register.html',
  'signin.html',
  'dashboard.html',
  'activate.html',
  'activity.html',
  'manage.html',
  'settings.html',
  'payment-success.html',
  'etag.html',
  'verify.html',
];

PAGES_NEEDING_FOOTER.forEach(file => {
  let html = readPublic(file);
  if (html === null) { console.log(`[MISS] ${file} — file not found`); fail++; return; }
  if (html.includes('href="/privacy.html"') && html.includes('href="/terms.html"') && html.includes('© 2026 Praman Tech LLC')) {
    console.log(`[SKIP] ${file} — footer with legal links already present`);
    skip++; return;
  }
  // Inject right before </body>
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) { console.log(`[FAIL] ${file} — no </body> tag found`); fail++; return; }
  html = html.substring(0, idx) + UNIVERSAL_FOOTER + html.substring(idx);
  writePublicAndRoot(file, html);
  console.log(`[OK]   ${file} — footer with Privacy/Terms/Support added`);
  ok++;
});

// ───────────────────────────────────────────────────────────────
// SUMMARY
// ───────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────────────`);
console.log(` Done. ${ok} edits applied, ${skip} already done, ${fail} failed.`);
console.log(`─────────────────────────────────────────`);
if (fail > 0) {
  console.log(`\nIf any edits failed, paste the [FAIL] lines into the chat and I'll debug.`);
}
