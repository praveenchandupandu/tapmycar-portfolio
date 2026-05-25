// ============================================================================
// TapMyCar - Patch 62: Three website fixes
//
//   ISSUE 1 - the tag page (contact.html) auto-jumps to /dashboard.html 1.5s
//             after a tag is claimed/activated, giving the user no choice.
//             FIX: remove the 3 auto-redirect timers. The success screen
//             already has a "Go to my dashboard" button - the user taps it
//             when they are ready.
//
//   ISSUE 2 - the chatbot describes the free eTag as "Free digital QR code,
//             3 masked calls/month" with no mention it is a 30-DAY plan.
//             FIX: update the chatbot knowledge text in app.js so it states
//             the eTag is free for 30 days, after which the user upgrades to
//             Standard/Premium or the tag deactivates - no automatic charge.
//
//   ISSUE 3 - "About TapMyCar" in Settings opens /landing.html, a page built
//             for logged-OUT visitors (every button -> register.html), so a
//             logged-in user feels pushed to sign up again.
//             FIX: on landing.html, if the visitor is logged in (tmc_token
//             present), the register.html call-to-action buttons are
//             re-pointed to /dashboard.html and relabelled "Go to Dashboard".
//             The page content is unchanged.
//
//   No SQL change. Syncs app.js + contact.html + landing.html to root.
//
// Properties: idempotent (safe to re-run), validates JS, backs up changes.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch62-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, c) { fs.writeFileSync(p, c, { encoding: 'utf8' }); }
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
}
function checkJs(absPath, label) {
  try {
    execSync('node --check "' + absPath + '"', { stdio: 'pipe' });
    ok(label + ' passes node --check');
  } catch (e) {
    errExit(label + ' FAILED node --check:\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

log('');
log('TapMyCar Patch 62 - Tag-page redirect / chatbot eTag / landing CTAs');
log('===================================================================');

// ----------------------------------------------------------------------------
// ISSUE 1 - contact.html : remove the 3 auto-redirect timers
// ----------------------------------------------------------------------------
log('');
log('Issue 1 - contact.html (remove auto-redirect after success)');

const contactPath = path.join(PUBLIC, 'contact.html');
let contactSrc = fs.readFileSync(contactPath, 'utf8');

if (contactSrc.indexOf('TMC_PATCH62_NOAUTONAV') !== -1) {
  skip('public/contact.html');
} else {
  backup(contactPath, 'public/contact.html');

  // Each redirect line has a unique comment line directly above it - anchor
  // on the comment + line pair so each of the 3 is matched uniquely.
  const REDIRECT = "\n    setTimeout(function() { window.location.href = '/dashboard.html'; }, 1500);";
  const REMOVED  = "\n    /* TMC_PATCH62_NOAUTONAV: auto-redirect removed - user taps the" +
                   "\n       \"Go to my dashboard\" button on the success screen instead. */";

  const pairs = [
    ["    /* All good \u2014 show success and redirect. */\n    showState('success');" + REDIRECT,
     "    /* All good \u2014 show success. */\n    showState('success');" + REMOVED],
    ["    /* Success: go to dashboard. */\n    showState('success');" + REDIRECT,
     "    /* Success. */\n    showState('success');" + REMOVED],
    ["       frontend doesn't need to do that step. */\n    showState('success');" + REDIRECT,
     "       frontend doesn't need to do that step. */\n    showState('success');" + REMOVED]
  ];
  pairs.forEach(function (p, i) {
    contactSrc = replaceOnce(contactSrc, p[0], p[1], 'Issue1 redirect #' + (i + 1));
  });
  writeFile(contactPath, contactSrc);
  ok('Removed 3 auto-redirect timers - success screen button now decides');
}

// ----------------------------------------------------------------------------
// ISSUE 2 - app.js : chatbot eTag 30-day knowledge
// ----------------------------------------------------------------------------
log('');
log('Issue 2 - app.js (chatbot eTag 30-day text)');

const appPath = path.join(PUBLIC, 'app.js');
let appSrc = fs.readFileSync(appPath, 'utf8');

if (appSrc.indexOf('TMC_PATCH62_ETAG30') !== -1) {
  skip('public/app.js');
} else {
  backup(appPath, 'public/app.js');

  // 2a - the PLANS line for eTag.
  appSrc = replaceOnce(appSrc,
    '- eTag: Free digital QR code, download instantly, 3 masked calls/month',
    '- eTag: Free digital QR code for 30 days, download instantly, 3 masked calls/month. ' +
    'TMC_PATCH62_ETAG30 After 30 days the user chooses to upgrade to Standard or Premium ' +
    'to keep the tag active - if they do not upgrade, the eTag deactivates. There is NO ' +
    'automatic charge; the user is never billed without choosing to.',
    'Issue2 eTag plan line');

  // 2b - the HOW IT WORKS sticker line - clarify it is for paid plans.
  appSrc = replaceOnce(appSrc,
    '5. Physical sticker ships after 30 days',
    '5. On a paid plan, the physical NFC + QR sticker ships to your home',
    'Issue2 sticker line');

  writeFile(appPath, appSrc);
  checkJs(appPath, 'public/app.js');
  ok('Chatbot now explains the eTag 30-day rule correctly');
}

// ----------------------------------------------------------------------------
// ISSUE 3 - landing.html : logged-in visitors get "Go to Dashboard"
// ----------------------------------------------------------------------------
log('');
log('Issue 3 - landing.html (logged-in CTA re-point)');

const landingPath = path.join(PUBLIC, 'landing.html');
let landingSrc = fs.readFileSync(landingPath, 'utf8');

if (landingSrc.indexOf('TMC_PATCH62_LANDING') !== -1) {
  skip('public/landing.html');
} else {
  backup(landingPath, 'public/landing.html');

  // 3a - tag each register.html CTA with a class so the script can find them.
  // The 4 primary CTAs (header, hero, app, footer "Get App") + 1 bottom CTA.
  var cssClassTag = ' data-tmc-cta="1"';
  [
    '<a href="/register.html" style="background:#FF6B00;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:10px;text-decoration:none">Get started</a>',
    '<a href="/register.html" class="hero-btn-primary">Explore TapMyCar</a>',
    '<a href="/register.html" class="app-btn">Download Free </a>',
    '<a href="/register.html" class="cta-btn">Explore TapMyCar</a>',
    '<a href="/register.html" style="background:#FF6B00;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:10px;text-decoration:none">Get App</a>'
  ].forEach(function (anchor, i) {
    if (landingSrc.indexOf(anchor) !== -1) {
      var tagged = anchor.replace('<a href="/register.html"', '<a href="/register.html"' + cssClassTag);
      landingSrc = replaceOnce(landingSrc, anchor, tagged, 'Issue3 CTA #' + (i + 1));
    }
  });

  // 3b - inject the script before </body>: if logged in, re-point tagged CTAs.
  const SCRIPT = [
    '',
    '<script>',
    '// TMC_PATCH62_LANDING - logged-in visitors should not be pushed to register.',
    '(function(){',
    '  var token = null;',
    '  try { token = localStorage.getItem("tmc_token"); } catch(e){}',
    '  if (!token) return;  // logged-out visitor: leave the page as-is',
    '  var ctas = document.querySelectorAll(\'a[data-tmc-cta="1"]\');',
    '  for (var i = 0; i < ctas.length; i++) {',
    '    ctas[i].setAttribute("href", "/dashboard.html");',
    '    var t = (ctas[i].textContent || "").trim().toLowerCase();',
    '    // Relabel the wordy CTAs; leave tiny header buttons compact.',
    '    if (t.indexOf("explore") !== -1 || t.indexOf("download") !== -1) {',
    '      ctas[i].textContent = "Go to Dashboard";',
    '    } else {',
    '      ctas[i].textContent = "Dashboard";',
    '    }',
    '  }',
    '})();',
    '</script>',
    ''
  ].join('\n');
  landingSrc = replaceOnce(landingSrc, '</body>', SCRIPT + '</body>', 'Issue3 script');

  writeFile(landingPath, landingSrc);
  ok('Landing CTAs re-point to dashboard for logged-in users');
}

// ----------------------------------------------------------------------------
// Sync to root
// ----------------------------------------------------------------------------
log('');
log('Sync to root');
[['app.js', appPath], ['contact.html', contactPath], ['landing.html', landingPath]]
  .forEach(function (pair) {
    const rootCopy = path.join(ROOT, pair[0]);
    if (fs.existsSync(rootCopy)) {
      backup(rootCopy, 'root-' + pair[0]);
      fs.copyFileSync(pair[1], rootCopy);
      ok('Synced ' + pair[0] + ' -> root');
    }
  });

log('');
log('===================================================================');
log('Patch 62 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh. TEST:');
log('   1. Claim/activate a tag -> the success screen now STAYS; you tap');
log('      "Go to my dashboard" yourself (no automatic jump).');
log('   2. Ask the chatbot "is the eTag really free?" -> it explains the');
log('      30-day rule and that there is no automatic charge.');
log('   3. Signed in, open Settings -> About TapMyCar -> landing page; the');
log('      buttons now say "Go to Dashboard" and go there, not to sign-up.');
log('      (Open it logged-out and the buttons are the normal sign-up ones.)');
log('');
