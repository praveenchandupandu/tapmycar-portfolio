#!/usr/bin/env node
/* ============================================================================
 * claude-patch-27-save-contact-vcard.js
 * ----------------------------------------------------------------------------
 * "Save TapMyCar to your contacts" so owners see a NAME, not a number, when a
 * stranger's call comes through.
 *
 * WHY ONE NUMBER, NOT FIVE: verified across the whole API - every owner-facing
 * call and SMS (inbound-call, stranger-wait x2, proxy-call, notify-owner,
 * send-broadcast) uses process.env.TWILIO_PHONE_NUMBER. The pool numbers are
 * only ever dialled BY strangers and are never used as a caller ID. So one
 * saved contact covers every call and every scan alert.
 *
 * THREE PARTS
 *  1. api/contact-card.js  (NEW)  - serves a vCard (.vcf). Tapping it opens the
 *     phone's own "Add Contact" screen, prefilled. Works the same on iPhone and
 *     Android and needs NO contacts permission - important while iOS is in
 *     review, since a contacts permission would add a new privacy declaration.
 *  2. public/dashboard.html      - dismissible prompt card, shown at most 3
 *     times ever, then never again. NOT a push notification: the push channel
 *     carries "someone is at your car right now" and must not be diluted.
 *  3. public/settings.html       - permanent "Save our number" row, always
 *     available for anyone who skipped or reinstalled.
 *
 * THE NUMBER IS NEVER HARDCODED. contact-card.js reads TWILIO_PHONE_NUMBER, the
 * same variable every outbound call already uses, so the saved contact cannot
 * drift out of sync with the real caller ID even if you change numbers later.
 *
 * SECURITY
 *  - Endpoint is public by necessity (a contact card can't require a login) but
 *    exposes ONLY your business number, which is already printed on every tag
 *    page. No user data, no PII, no DB query, no request body is read.
 *  - Zero user input reaches the response, so there is no injection surface.
 *  - GET/HEAD only; every other method is rejected.
 *  - TWILIO_PHONE_NUMBER is validated as strict E.164 before being emitted. A
 *    malformed or newline-bearing env value cannot break out of the vCard
 *    structure or inject headers (CRLF injection). Invalid -> 503, never a
 *    corrupt card.
 *  - Static Content-Disposition filename; no path handling anywhere.
 *  - Dashboard/settings additions use textContent-free static markup: no
 *    innerHTML, no eval, no string-built DOM, no new user input.
 *
 * SCOPE / BUNDLE IMPACT
 *  - api/contact-card.js: serverless, live on push, never touches app bundles.
 *  - public/*.html: live on the website on push; reaches the apps only at your
 *    next `npx cap sync`. No rebuild forced. Approved Play bundle untouched.
 *
 * SAFE / IDEMPOTENT: timestamped backups, latin1 byte preservation, ASCII-only
 * insertion, every anchor must match exactly once, HTML tag-balance verified,
 * node --check on the new API file, auto-restore of ALL files on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const MARKER   = 'TMC_PATCH27_SAVE_CONTACT';
const API_FILE = path.join('api', 'contact-card.js');
const DASH     = path.join('public', 'dashboard.html');
const SETT     = path.join('public', 'settings.html');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
const S = stamp();

const backups = [];   // {file, copy}
const created = [];   // new files to remove on rollback

function rollback() {
  for (const b of backups) { try { fs.copyFileSync(b.copy, b.file); } catch (e) {} }
  for (const f of created) { try { fs.unlinkSync(f); } catch (e) {} }
}
function die(msg, restore) {
  if (restore) rollback();
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  All files restored to their original state.\n'
                        : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
function backup(file) {
  const copy = file + '.tmcbak-' + S;
  fs.copyFileSync(file, copy);
  backups.push({ file: file, copy: copy });
  return copy;
}

// ── Pre-flight ──────────────────────────────────────────────────────────────
for (const f of [DASH, SETT]) {
  if (!fs.existsSync(f)) die('Cannot find ' + f + '. Run from the tapmycar project root.');
}
if (!fs.existsSync('api')) die('Cannot find api/ directory. Run from the tapmycar project root.');

const dashSrc = fs.readFileSync(DASH, 'latin1');
const settSrc = fs.readFileSync(SETT, 'latin1');

if (fs.existsSync(API_FILE) && dashSrc.indexOf(MARKER) !== -1 && settSrc.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' present).');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ── Anchors ────────────────────────────────────────────────────────────────
const A_DASH = '  <div data-tmc-slot="dashboard.banner"></div>';

const A_SETT = "  <div class=\"set-row\" onclick=\"window.location.href='/landing.html'\">";

let n;
n = countOf(dashSrc, A_DASH);
if (n !== 1) die('dashboard.html anchor matched ' + n + ' times (expected 1).');
n = countOf(settSrc, A_SETT);
if (n !== 1) die('settings.html anchor matched ' + n + ' times (expected 1).');

// ── FILE 1: api/contact-card.js ────────────────────────────────────────────
const API_SRC = [
  "// " + MARKER + ": serves a vCard so owners can save TapMyCar as a contact.",
  "//",
  "// The number comes from TWILIO_PHONE_NUMBER - the SAME variable used as the",
  "// callerId on every owner-facing call (inbound-call, stranger-wait,",
  "// proxy-call) and as the SMS sender (notify-owner, send-broadcast). Reading",
  "// it here means the saved contact can never drift out of sync with the",
  "// number owners actually see ringing.",
  "//",
  "// Public by necessity - a contact card cannot sit behind a login. It exposes",
  "// only the business number, which is already printed on every tag page. No",
  "// user data, no DB access, no request input is read, so there is no",
  "// injection surface.",
  "",
  "module.exports = async (req, res) => {",
  "  // Read-only endpoint: GET/HEAD only.",
  "  if (req.method !== 'GET' && req.method !== 'HEAD') {",
  "    res.setHeader('Allow', 'GET, HEAD');",
  "    return res.status(405).json({ error: 'Method not allowed' });",
  "  }",
  "",
  "  const raw = process.env.TWILIO_PHONE_NUMBER || '';",
  "  const number = String(raw).trim();",
  "",
  "  // Strict E.164. Guarantees no CRLF or stray characters can break out of",
  "  // the vCard structure or inject a response header.",
  "  if (!/^\\+[1-9][0-9]{7,14}$/.test(number)) {",
  "    console.error('contact-card: TWILIO_PHONE_NUMBER missing or malformed');",
  "    return res.status(503).json({ error: 'Contact card unavailable' });",
  "  }",
  "",
  "  // vCard 3.0: the most broadly supported version across iOS and Android.",
  "  const vcard = [",
  "    'BEGIN:VCARD',",
  "    'VERSION:3.0',",
  "    'N:;TapMyCar;;;',",
  "    'FN:TapMyCar',",
  "    'ORG:TapMyCar',",
  "    'TEL;TYPE=MAIN,VOICE:' + number,",
  "    'URL:https://www.tapmycar.io',",
  "    'NOTE:Calls and scan alerts from TapMyCar come from this number.',",
  "    'END:VCARD'",
  "  ].join('\\r\\n') + '\\r\\n';",
  "",
  "  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');",
  "  res.setHeader('Content-Disposition', 'attachment; filename=\"TapMyCar.vcf\"');",
  "  res.setHeader('Cache-Control', 'public, max-age=3600');",
  "  res.setHeader('X-Content-Type-Options', 'nosniff');",
  "  return res.status(200).send(vcard);",
  "};",
  ""
].join('\n');

// ── FILE 2: dashboard.html card ────────────────────────────────────────────
const R_DASH = [
  A_DASH,
  "",
  "  <!-- " + MARKER + ": save-our-number prompt. Shown at most 3 times ever.",
  "       Deliberately NOT a push notification - the push channel carries",
  "       'someone is at your car right now' and must not be diluted. -->",
  "  <div id=\"tmc-savecontact-card\" style=\"display:none;background:#fff;border:1px solid #ffd9bf;border-radius:18px;padding:16px;margin-bottom:14px;position:relative\">",
  "    <button id=\"tmc-sc-x\" aria-label=\"Dismiss\" style=\"position:absolute;top:10px;right:10px;width:28px;height:28px;border:0;background:transparent;color:#9a9a9a;font-size:20px;line-height:1;cursor:pointer\">&times;</button>",
  "    <div style=\"font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:4px;padding-right:28px\">Know when it&#39;s us calling</div>",
  "    <div style=\"font-size:13px;color:#666;line-height:1.45;margin-bottom:12px\">Save our number so calls and scan alerts show <strong>TapMyCar</strong> instead of an unknown number.</div>",
  "    <button id=\"tmc-sc-save\" style=\"display:inline-block;background:#FF6B00;color:#fff;border:0;font-size:14px;font-weight:700;padding:11px 20px;border-radius:12px;cursor:pointer\">Save contact</button>",
  "  </div>",
  "  <script>",
  "  (function(){",
  "    /* " + MARKER + " */",
  "    var KEY = 'tmc_savecontact_v1';",
  "    var card = document.getElementById('tmc-savecontact-card');",
  "    if (!card) return;",
  "    var state;",
  "    try { state = localStorage.getItem(KEY); } catch(e) { return; }",
  "    if (state === 'done') return;",
  "    var shown = parseInt(state, 10);",
  "    if (!(shown >= 0)) shown = 0;",
  "    if (shown >= 3) return;",
  "    try { localStorage.setItem(KEY, String(shown + 1)); } catch(e) {}",
  "    card.style.display = 'block';",
  "    function finish(){",
  "      try { localStorage.setItem(KEY, 'done'); } catch(e) {}",
  "      card.style.display = 'none';",
  "    }",
  "    document.getElementById('tmc-sc-save').addEventListener('click', function(){",
  "      finish();",
  "      window.location.href = '/api/contact-card';",
  "    });",
  "    document.getElementById('tmc-sc-x').addEventListener('click', function(){",
  "      card.style.display = 'none';",
  "    });",
  "  })();",
  "  </script>"
].join('\n');

// ── FILE 3: settings.html row ──────────────────────────────────────────────
const R_SETT = [
  "  <!-- " + MARKER + ": permanent entry point for anyone who skipped the prompt -->",
  "  <div class=\"set-row\" onclick=\"window.location.href='/api/contact-card'\"><div class=\"set-l\"><div class=\"set-ic\" style=\"background:var(--orl)\"><svg viewBox=\"0 0 24 24\" stroke=\"var(--or)\" fill=\"none\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z\"/></svg></div><div><div class=\"set-t\">Save our number</div><div class=\"set-s\">See &quot;TapMyCar&quot; when we call</div></div></div><div class=\"arr\"><svg viewBox=\"0 0 24 24\"><polyline points=\"9 18 15 12 9 6\"/></svg></div></div>",
  A_SETT
].join('\n');

// ── Guard: everything we insert must be pure ASCII ─────────────────────────
// These HTML files contain multi-byte characters. latin1 round-trips existing
// bytes perfectly, but NEW non-ASCII text would be mangled. Assert instead.
for (const [label, blob] of [['api', API_SRC], ['dashboard', R_DASH], ['settings', R_SETT]]) {
  if (/[^\x00-\x7F]/.test(blob)) die('internal error: non-ASCII in ' + label + ' insertion.');
}

// ── Apply ───────────────────────────────────────────────────────────────────
try {
  // 1. new API file
  if (fs.existsSync(API_FILE)) {
    backup(API_FILE);
  } else {
    created.push(API_FILE);
  }
  fs.writeFileSync(API_FILE, API_SRC, 'utf8');

  // 2. dashboard
  if (dashSrc.indexOf(MARKER) === -1) {
    backup(DASH);
    fs.writeFileSync(DASH, dashSrc.replace(A_DASH, function () { return R_DASH; }), 'latin1');
  }

  // 3. settings
  if (settSrc.indexOf(MARKER) === -1) {
    backup(SETT);
    fs.writeFileSync(SETT, settSrc.replace(A_SETT, function () { return R_SETT; }), 'latin1');
  }
} catch (e) {
  die('write failed: ' + e.message, true);
}

// ── Verify ──────────────────────────────────────────────────────────────────

// A. new API file must be valid JS, no BOM.
const apiOut = fs.readFileSync(API_FILE, 'utf8');
if (apiOut.charCodeAt(0) === 0xFEFF) die('api/contact-card.js has a BOM.', true);
try {
  new (require('vm').Script)(
    require('module').wrap(apiOut), { filename: API_FILE }
  );
} catch (e) {
  die('api/contact-card.js does not parse: ' + e.message, true);
}

// B. the E.164 validator in the generated file actually blocks bad input.
{
  const re = /^\+[1-9][0-9]{7,14}$/;
  const bad = ['', '  ', '18605158987', '+0860515898', '+1860\r\nX-Evil: 1',
               '+1860515898712345678', 'not-a-number', '+1 860 515 8987'];
  for (const b of bad) {
    if (re.test(String(b).trim())) die('validator would accept bad value: ' + JSON.stringify(b), true);
  }
  if (!re.test('+18605158987')) die('validator rejects the real main number.', true);
}

// C. HTML files: markers present, tag balance unchanged, specials preserved.
for (const [file, before] of [[DASH, dashSrc], [SETT, settSrc]]) {
  const after = fs.readFileSync(file, 'latin1');
  if (after.indexOf(MARKER) === -1) die('marker missing from ' + file, true);

  // Expected delta is derived from the replacement itself, not hardcoded, so
  // the check can never silently drift out of step with the inserted markup.
  const anchor = (file === DASH) ? A_DASH : A_SETT;
  const repl   = (file === DASH) ? R_DASH : R_SETT;
  for (const tag of ['<body', '</body>', '</html>', '<div', '</div>']) {
    const d = countOf(after, tag) - countOf(before, tag);
    const expected = countOf(repl, tag) - countOf(anchor, tag);
    if (d !== expected) {
      die(file + ': ' + tag + ' count changed by ' + d + ', expected ' + expected, true);
    }
  }
  // Divs we open, we close.
  if (countOf(repl, '<div') - countOf(anchor, '<div') !==
      countOf(repl, '</div>') - countOf(anchor, '</div>')) {
    die(file + ': inserted markup has unbalanced <div> tags.', true);
  }

  const nb = (before.match(/[^\x00-\x7F]/g) || []).length;
  const na = (after.match(/[^\x00-\x7F]/g) || []).length;
  if (nb !== na) die(file + ': special characters changed (' + nb + ' -> ' + na + ').', true);
}

// D. dashboard <script> tags balanced (we added exactly one pair).
{
  const after = fs.readFileSync(DASH, 'latin1');
  if (countOf(after, '<script') - countOf(dashSrc, '<script') !== 1) die('dashboard <script> imbalance.', true);
  if (countOf(after, '</script>') - countOf(dashSrc, '</script>') !== 1) die('dashboard </script> imbalance.', true);
}

console.log('\n  OK  ' + MARKER + ' applied.');
console.log('');
console.log('      NEW   ' + API_FILE + '   (serves the vCard)');
console.log('      EDIT  ' + DASH + '   (prompt card, max 3 shows)');
console.log('      EDIT  ' + SETT + '   (permanent "Save our number" row)');
console.log('');
console.log('      Backups: *.tmcbak-' + S);
console.log('');
console.log('      Number is read from TWILIO_PHONE_NUMBER - never hardcoded,');
console.log('      so the saved contact always matches the real caller ID.');
console.log('      Malformed env value returns 503, never a corrupt card.');
console.log('');
console.log('      api/ is serverless: live on push, app bundles untouched.');
console.log('      public/ reaches the apps at your next cap sync only.\n');
