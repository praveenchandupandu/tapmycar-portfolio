/* ============================================================================
 * TapMyCar  Patch 44  short referral URL + share message + welcome wording
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch44-share-and-wording.js
 *
 * Three small, independent improvements:
 *
 *   1. vercel.json  add a /r/:code rewrite. Referral links can now be the
 *      short, clean URL  https://tapmycar.io/r/TMC-492TZD  which rewrites
 *      to /register.html?ref=TMC-492TZD on the server. Short URLs (no
 *      query string) generate link previews much more reliably across
 *      WhatsApp / iMessage / SMS.
 *
 *   2. public/settings.html
 *        - referral input shows the new /r/CODE short URL
 *        - shareRefLink() uses a friendlier message and the short URL
 *
 *   3. public/welcome.html
 *        - referral success screen wording changes to:
 *            Referral applied
 *            Thanks for using <name>'s referral code! Welcome to TapMyCar.
 *          (no mention of "earn a reward")
 *
 * No DB changes. SAFE TO RE-RUN: each file skipped if it already contains
 * TMC_PATCH44.
 *
 * Honesty note about preview cards: even with this patch, WhatsApp may not
 * always render a preview card  it has its own throttling/caching rules
 * and is genuinely flaky across the industry. This patch maximises the
 * odds (short URL, og tags already in place) but cannot guarantee a card
 * every time. iMessage generally works.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH44';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch44-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * EDIT 1  vercel.json  add /r/:code rewrite to /register.html?ref=:code
 * ======================================================================*/

const VERCEL = 'vercel.json';

/* Anchor on the /tag/:token rewrite (always present) and append after it */
const VJ_FIND = [
  '    {',
  '      "source": "/tag/:token",',
  '      "destination": "/contact.html"',
  '    },'
].join('\n');

const VJ_REPLACE = [
  '    {',
  '      "source": "/tag/:token",',
  '      "destination": "/contact.html"',
  '    },',
  '    {',
  '      "source": "/r/:code",',
  '      "destination": "/register.html?ref=:code"',
  '    },'
].join('\n');

/* ========================================================================
 * EDIT 2  public/settings.html  short URL in the referral input + share fn
 * ======================================================================*/

const SETTINGS = path.join('public', 'settings.html');

/* 2a — change the referral input value to the /r/ short URL.
   We need to locate WHERE the referral link is built. */
const SH_LINK_FIND  = "    const link = 'https://tapmycar.io/register.html?ref=' + data.referral_code;";
const SH_LINK_REPLACE = "    const link = 'https://tapmycar.io/r/' + data.referral_code; /* TMC_PATCH44 */";

/* 2b — replace shareRefLink() with a version that uses better wording
   and lets the platform handle the URL inside text body. */
const SH_FN_FIND = [
  "function shareRefLink() {",
  "  const link = document.getElementById('ref-link').value;",
  "  if (navigator.share) { navigator.share({ title: 'TapMyCar', text: 'Protect your car with TapMyCar! Use my referral link:', url: link }); }",
  "  else { copyRefLink(); }",
  "}"
].join('\n');

const SH_FN_REPLACE = [
  "function shareRefLink() {",
  "  /* TMC_PATCH44: friendlier message + short URL. Passing the URL via",
  "     the canonical `url` field lets the OS share sheet render rich link",
  "     cards on iOS, while platforms that paste as plain text still get a",
  "     short URL (no query string) that they can preview reliably. */",
  "  const link = document.getElementById('ref-link').value;",
  "  if (!link) return;",
  "  const shareText = \"Hey! I'm on TapMyCar  the privacy-first contact tag for your car. Sign up with my referral:\";",
  "  if (navigator.share) {",
  "    navigator.share({ title: 'TapMyCar', text: shareText, url: link }).catch(function () { copyRefLink(); });",
  "  } else {",
  "    copyRefLink();",
  "  }",
  "}"
].join('\n');

/* ========================================================================
 * EDIT 3  public/welcome.html  remove "earn a reward" wording
 * ======================================================================*/

const WELCOME = path.join('public', 'welcome.html');

/* ========================================================================
 * EDIT 4  public/register.html  prefill gift-code input from ?ref=
 * Without this the /r/ short URL gets the user to the page but the input
 * stays empty — they'd have to manually type the code, defeating the point.
 * Inserts a small <script> right before </body> that reads ?ref= and fills
 * the gift-code input on page load.
 * ======================================================================*/

const REGISTER = path.join('public', 'register.html');

const RG_FIND = "</body>\n</html>";

const RG_REPLACE = [
  "<script>",
  "/* TMC_PATCH44: prefill the gift-code input from ?ref= so the short URL",
  "   (e.g. /r/TMC-492TZD) lands the user with the code already filled in. */",
  "(function () {",
  "  try {",
  "    var ref = new URL(window.location.href).searchParams.get('ref');",
  "    if (ref) {",
  "      var input = document.getElementById('gift-code');",
  "      if (input && !input.value) input.value = ref.trim().toUpperCase();",
  "    }",
  "  } catch (e) { /* non-fatal */ }",
  "})();",
  "</script>",
  "</body>",
  "</html>"
].join('\n');

const WC_FIND = [
  "      if (data.type === 'referral') {",
  "        /* TMC_PATCH43_REFERRALS: referral codes don't grant the user a plan.",
  "           The friend earns a reward later when this user upgrades to paid. */",
  "        var refName = data.referrer_name || 'your friend';",
  "        document.getElementById('success-title').textContent = data.alreadyRedeemed ? 'Already applied' : 'Referral applied';",
  "        document.getElementById('success-message').textContent =",
  "          (data.alreadyRedeemed ? \"This referral was already applied to your account. \" : \"Thanks! \") +",
  "          refName + \" will earn a reward when you upgrade to a paid plan.\";",
  "      } else if (data.alreadyRedeemed) {"
].join('\n');

const WC_REPLACE = [
  "      if (data.type === 'referral') {",
  "        /* TMC_PATCH44: simpler welcoming wording. No mention of reward. */",
  "        var refName = data.referrer_name || 'your friend';",
  "        if (data.alreadyRedeemed) {",
  "          document.getElementById('success-title').textContent = 'Already applied';",
  "          document.getElementById('success-message').textContent =",
  "            \"You've already used \" + refName + \"'s referral code on this account.\";",
  "        } else {",
  "          document.getElementById('success-title').textContent = 'Referral applied';",
  "          document.getElementById('success-message').textContent =",
  "            \"Thanks for using \" + refName + \"'s referral code! Welcome to TapMyCar.\";",
  "        }",
  "      } else if (data.alreadyRedeemed) {"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 44  short URL + share message + welcome wording');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

function patchFile(file, edits) {
  if (!fs.existsSync(file)) fail('expected file not found: ' + file);
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already patched)');
    return false;
  }
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + file + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + file + '  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  backupAndWrite(file, original, updated);
  log(file + ': patched');
  return true;
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

try {
  /* vercel.json: JSON has no comments, so MARKER detection doesn't work.
     Check for the new rewrite directly instead. */
  const vjOrig = fs.readFileSync(VERCEL, 'utf8');
  if (vjOrig.indexOf('"/r/:code"') !== -1) {
    log(VERCEL + ': skip (rewrite already present)');
  } else if (patchFile(VERCEL, [
    { label: 'add /r/:code rewrite', find: VJ_FIND, replace: VJ_REPLACE }
  ])) {
    /* validate vercel.json parses */
    JSON.parse(fs.readFileSync(VERCEL, 'utf8'));
    log('   - vercel.json: valid JSON');
    changed++;
  }
  if (patchFile(SETTINGS, [
    { label: 'short URL in ref-link input', find: SH_LINK_FIND, replace: SH_LINK_REPLACE },
    { label: 'shareRefLink: better message', find: SH_FN_FIND, replace: SH_FN_REPLACE }
  ])) changed++;
  if (patchFile(WELCOME, [
    { label: 'welcome.html: success wording', find: WC_FIND, replace: WC_REPLACE }
  ])) {
    /* syntax-check the script block */
    const s = fs.readFileSync(WELCOME, 'utf8');
    const i = s.indexOf('async function redeemCode');
    if (i !== -1) {
      const a = s.lastIndexOf('<script>', i) + 8;
      const b = s.indexOf('</script>', i);
      fs.writeFileSync('/tmp/p44-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p44-chk.js', { stdio: 'pipe' });
      log('   - welcome.html script: node --check OK');
    }
    changed++;
  }
  if (patchFile(REGISTER, [
    { label: 'prefill gift-code from ?ref=', find: RG_FIND, replace: RG_REPLACE }
  ])) {
    /* syntax-check the new inline script */
    const s = fs.readFileSync(REGISTER, 'utf8');
    const i = s.indexOf('TMC_PATCH44: prefill');
    if (i !== -1) {
      const a = s.lastIndexOf('<script>', i) + 8;
      const b = s.indexOf('</script>', i);
      fs.writeFileSync('/tmp/p44-reg-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p44-reg-chk.js', { stdio: 'pipe' });
      log('   - register.html prefill script: node --check OK');
    }
    changed++;
  }
} catch (e) {
  fail(e && e.message);
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 44: short referral URL + share message + welcome wording"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Test:');
  log('     - Visit https://tapmycar.io/r/TMC-492TZD (your code) directly.');
  log('       It should land on the registration page with the code prefilled.');
  log('     - Settings  Share Link  share to WhatsApp/iMessage. Message');
  log('       should use the new wording and short URL.');
  log('     - A friend signing up sees:');
  log('         Referral applied');
  log('         Thanks for using <your name>\'s referral code! Welcome to TapMyCar.\n');
}
