/* ============================================================================
 * TapMyCar  Patch 46  renewal prompt for paid users without subscription
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch46-renewal-prompt.js
 *
 * For users on a paid plan (standard/premium) who have NO active Stripe
 * subscription_id AND have been on the plan for > 30 days, the app now shows:
 *
 *   1. A full-screen renewal modal on dashboard load:
 *      "Renew your annual plan to keep your tag active. [Pay Now $9.99/yr]
 *       [✕ Close]"
 *      Once-per-session: if they close it, sessionStorage flag is set and
 *      it won't appear again until they open a new browser tab/session.
 *
 *   2. A persistent yellow banner below the header on dashboard and
 *      settings: "⚠️ Your annual subscription is overdue. Renew to keep
 *      your tag active." with a small ✕ to dismiss per session.
 *      Clicking the banner goes to /pricing.html.
 *
 * The check uses two existing data points from /api/get-dashboard:
 *   - user.plan  must be 'standard' or 'premium'
 *   - user.subscription_id  must be null/empty
 *   - user.created_at  must be > 30 days ago (or the most recent paid order)
 *
 * Files modified/created:
 *   - public/app-renewal-prompt.js     NEW. The shared modal + banner code.
 *   - public/dashboard.html            includes the script before </body>.
 *   - public/settings.html             same.
 *
 * No backend changes. The script piggy-backs on the existing get-dashboard
 * endpoint which already returns the user object including plan and
 * subscription_id. If get-dashboard fails (network etc.) the prompt simply
 * does nothing  fails closed.
 *
 * SAFE TO RE-RUN: each file skipped if already contains TMC_PATCH46.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH46';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch46-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const DASH  = path.join('public', 'dashboard.html');
const SET   = path.join('public', 'settings.html');
const SCRIPT_PATH = path.join('public', 'app-renewal-prompt.js');

/* =====================================================================
 * FILE 1  NEW: public/app-renewal-prompt.js
 * ===================================================================*/

const SCRIPT_BODY = [
  "/* TMC_PATCH46  shared renewal prompt (modal + banner).",
  "   Loaded by dashboard.html and settings.html.",
  "   - Modal once per session (sessionStorage flag).",
  "   - Banner persistent across pages, dismissable once per session.",
  "   - No-op if user is on free 'etag' plan or has an active subscription.",
  "   - Uses the existing /api/get-dashboard endpoint (no new backend). */",
  "(function () {",
  "  'use strict';",
  "  if (window.__tmcRenewalInit) return;",
  "  window.__tmcRenewalInit = true;",
  "",
  "  var SESSION_KEY_MODAL  = 'tmc_renewal_modal_dismissed';",
  "  var SESSION_KEY_BANNER = 'tmc_renewal_banner_dismissed';",
  "  var GRACE_DAYS = 30;",
  "",
  "  function getToken() {",
  "    try {",
  "      return localStorage.getItem('tmc_session_token') ||",
  "             localStorage.getItem('tmc_token');",
  "    } catch (e) { return null; }",
  "  }",
  "",
  "  function shouldShow(user) {",
  "    if (!user) return false;",
  "    /* Must be on a paid plan. */",
  "    if (user.plan !== 'standard' && user.plan !== 'premium') return false;",
  "    /* If there's an active subscription, we're fine. */",
  "    if (user.subscription_id) return false;",
  "    /* Must be > 30 days since they came on plan. We use created_at because",
  "       that's reliably present; if you want to switch to the most recent",
  "       paid order, this is the line to change. */",
  "    if (!user.created_at) return false;",
  "    var ageDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;",
  "    if (ageDays <= GRACE_DAYS) return false;",
  "    return true;",
  "  }",
  "",
  "  function injectBanner() {",
  "    try { if (sessionStorage.getItem(SESSION_KEY_BANNER)) return; } catch (e) {}",
  "    if (document.getElementById('tmc-renewal-banner')) return;",
  "",
  "    var bar = document.createElement('div');",
  "    bar.id = 'tmc-renewal-banner';",
  "    bar.style.cssText = [",
  "      'background:#FEF3C7',",
  "      'border-bottom:1px solid #FCD34D',",
  "      'color:#92400E',",
  "      'padding:10px 14px',",
  "      'font-family:Inter,system-ui,sans-serif',",
  "      'font-size:13px',",
  "      'font-weight:600',",
  "      'display:flex',",
  "      'align-items:center',",
  "      'gap:10px',",
  "      'cursor:pointer',",
  "      'position:sticky',",
  "      'top:0',",
  "      'z-index:50',",
  "      'box-shadow:0 1px 2px rgba(0,0,0,0.04)'",
  "    ].join(';');",
  "    bar.innerHTML =",
  "      '<span style=\"font-size:16px;line-height:1\">' + String.fromCharCode(0x26A0) + String.fromCharCode(0xFE0F) + '</span>' +",
  "      '<span style=\"flex:1\">Your annual subscription is overdue. Renew to keep your tag active.</span>' +",
  "      '<button type=\"button\" id=\"tmc-banner-x\" aria-label=\"Dismiss\" ' +",
  "        'style=\"background:transparent;border:0;color:#92400E;font-size:18px;font-weight:700;cursor:pointer;padding:0 4px;line-height:1\">' +",
  "        String.fromCharCode(0xD7) + '</button>';",
  "",
  "    /* Click banner -> pricing. Click X -> dismiss for session. */",
  "    bar.addEventListener('click', function (e) {",
  "      if (e.target && e.target.id === 'tmc-banner-x') {",
  "        try { sessionStorage.setItem(SESSION_KEY_BANNER, '1'); } catch (e2) {}",
  "        bar.remove();",
  "        return;",
  "      }",
  "      window.location.href = '/pricing.html';",
  "    });",
  "",
  "    /* Insert at top of body (below the sticky header if any). The header",
  "       on dashboard/settings is inside its own container; using position",
  "       sticky here keeps the banner fixed below it as the user scrolls. */",
  "    if (document.body.firstChild) document.body.insertBefore(bar, document.body.firstChild);",
  "    else document.body.appendChild(bar);",
  "  }",
  "",
  "  function injectModal() {",
  "    try { if (sessionStorage.getItem(SESSION_KEY_MODAL)) return; } catch (e) {}",
  "    if (document.getElementById('tmc-renewal-modal')) return;",
  "",
  "    var ov = document.createElement('div');",
  "    ov.id = 'tmc-renewal-modal';",
  "    ov.style.cssText = [",
  "      'position:fixed',",
  "      'inset:0',",
  "      'background:rgba(0,0,0,0.62)',",
  "      'z-index:9999',",
  "      'display:flex',",
  "      'align-items:center',",
  "      'justify-content:center',",
  "      'padding:16px',",
  "      'font-family:Inter,system-ui,sans-serif'",
  "    ].join(';');",
  "    ov.innerHTML =",
  "      '<div style=\"background:#fff;max-width:420px;width:100%;border-radius:18px;padding:26px 24px;position:relative;box-shadow:0 20px 40px rgba(0,0,0,0.18)\">' +",
  "        '<button type=\"button\" id=\"tmc-modal-x\" aria-label=\"Close\" ' +",
  "          'style=\"position:absolute;top:12px;right:12px;background:#F3F4F6;border:0;width:30px;height:30px;border-radius:15px;font-size:18px;font-weight:700;color:#6B7280;cursor:pointer;line-height:1\">' +",
  "          String.fromCharCode(0xD7) + '</button>' +",
  "        '<div style=\"width:56px;height:56px;border-radius:28px;background:#FEF3C7;color:#92400E;display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:14px\">' +",
  "          String.fromCharCode(0x26A0) + String.fromCharCode(0xFE0F) + '</div>' +",
  "        '<div style=\"font-size:18px;font-weight:800;color:#111;margin-bottom:6px\">Renew your annual plan</div>' +",
  "        '<div style=\"font-size:13px;color:#6B7280;line-height:1.6;margin-bottom:18px\">Your annual subscription is overdue. Renew to keep your tag active and your privacy features working.</div>' +",
  "        '<button type=\"button\" id=\"tmc-modal-pay\" ' +",
  "          'style=\"width:100%;padding:13px;background:#FF6B00;color:#fff;border:0;border-radius:11px;font-weight:700;font-size:14px;cursor:pointer\">Renew now</button>' +",
  "        '<button type=\"button\" id=\"tmc-modal-close\" ' +",
  "          'style=\"width:100%;padding:11px;margin-top:8px;background:transparent;border:0;color:#6B7280;font-weight:600;font-size:13px;cursor:pointer\">Close</button>' +",
  "      '</div>';",
  "    document.body.appendChild(ov);",
  "",
  "    function dismiss() {",
  "      try { sessionStorage.setItem(SESSION_KEY_MODAL, '1'); } catch (e) {}",
  "      ov.remove();",
  "    }",
  "    document.getElementById('tmc-modal-x').addEventListener('click', dismiss);",
  "    document.getElementById('tmc-modal-close').addEventListener('click', dismiss);",
  "    document.getElementById('tmc-modal-pay').addEventListener('click', function () {",
  "      window.location.href = '/pricing.html';",
  "    });",
  "    /* Click outside dialog also dismisses. */",
  "    ov.addEventListener('click', function (e) {",
  "      if (e.target === ov) dismiss();",
  "    });",
  "  }",
  "",
  "  function init() {",
  "    var token = getToken();",
  "    if (!token) return;",
  "    fetch('/api/get-dashboard', { headers: { 'Authorization': 'Bearer ' + token } })",
  "      .then(function (r) { return r.ok ? r.json() : null; })",
  "      .then(function (d) {",
  "        if (!d || !shouldShow(d.user)) return;",
  "        injectBanner();",
  "        /* Modal only on pages that explicitly opt in (dashboard). The page",
  "           sets window.__tmcShowRenewalModal = true before this script runs. */",
  "        if (window.__tmcShowRenewalModal) injectModal();",
  "      })",
  "      .catch(function () { /* fail closed */ });",
  "  }",
  "",
  "  if (document.readyState === 'loading') {",
  "    document.addEventListener('DOMContentLoaded', init);",
  "  } else { init(); }",
  "})();",
  ""
].join('\n');

/* =====================================================================
 * FILE 2  public/dashboard.html
 *   Inject the renewal-modal flag + the script tag before </body>.
 * ===================================================================*/

const DASH_FIND  = "<script src=\"/app-settings.js\" defer>";
const DASH_REPLACE = [
  "<!-- TMC_PATCH46 renewal prompt -->",
  "<script>window.__tmcShowRenewalModal = true;</script>",
  "<script src=\"/app-renewal-prompt.js\" defer></script>",
  "<script src=\"/app-settings.js\" defer>"
].join('\n');

/* =====================================================================
 * FILE 3  public/settings.html
 *   Banner only here (no modal). Inject the script before </body>.
 * ===================================================================*/

const SET_FIND    = "</body>";
const SET_REPLACE = [
  "<!-- TMC_PATCH46 renewal prompt -->",
  "<script src=\"/app-renewal-prompt.js\" defer></script>",
  "</body>"
].join('\n');

/* =====================================================================
 * DRIVER
 * ===================================================================*/

log('\nTapMyCar  Patch 46  renewal prompt\n');
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

/* Write the new shared script. Always overwrite if missing the marker. */
const scriptExists = fs.existsSync(SCRIPT_PATH);
if (scriptExists && fs.readFileSync(SCRIPT_PATH, 'utf8').indexOf(MARKER) !== -1) {
  log(SCRIPT_PATH + ': skip (already present with marker)');
} else {
  if (scriptExists) {
    fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
    fs.copyFileSync(SCRIPT_PATH, path.join(BACKUP_DIR, SCRIPT_PATH));
  }
  fs.writeFileSync(SCRIPT_PATH, SCRIPT_BODY, 'utf8');
  execSync('node --check "' + SCRIPT_PATH + '"', { stdio: 'pipe' });
  log(SCRIPT_PATH + ': written, node --check OK');
  changed++;
}

try {
  if (patchFile(DASH, [
    { label: 'dashboard.html include', find: DASH_FIND, replace: DASH_REPLACE }
  ])) changed++;
  if (patchFile(SET, [
    { label: 'settings.html include', find: SET_FIND, replace: SET_REPLACE }
  ])) changed++;
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
  log('  2. git commit -m "Patch 46: renewal prompt for users without active subscription"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Hard-refresh /dashboard.html. Since your test account is on');
  log('     plan=standard, no subscription_id, and 31 days old, you should see:');
  log('       - Full-screen modal on first load');
  log('       - Yellow banner at the top after dismissing');
  log('       - Banner appears on /settings.html too');
  log('       - Banner X dismisses for the session');
  log('       - Open in a private window: modal returns (new session)\n');
}
