/* ============================================================================
 * TapMyCar  Patch 53-admin-ui  failed-refunds tab on admin page
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch53-admin-ui.js
 *
 * Adds a new "Refunds" sidebar nav item + panel to the admin page. Lists
 * orders flagged with refund_failed_at, shows the user, the Stripe error,
 * and a "Mark resolved" button per row. Also adds a tiny pending-count
 * indicator next to the nav label so it is obvious when something needs
 * attention.
 *
 * Backend endpoints (built in Patch 53):
 *   - /api/admin-failed-refunds       list
 *   - /api/admin-resolve-refund       mark one resolved
 *
 * One file modified: public/cmshaveaccesstouser2026-npmevy.html
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH53_ADMIN.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH53_ADMIN';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch53-admin-ui-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const ADMIN_HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* =====================================================================
 * EDIT 1  sidebar nav item AFTER the Retention button.
 * The Retention button has a trailing <!-- TMC_PATCH42 --> comment that we
 * anchor on. Insert a new sibling immediately after it.
 * ===================================================================*/

const NAV_FIND  = '<button class="sb-item" data-tab="retention" onclick="navTo(\'retention\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg><span>Retention</span></button><!-- TMC_PATCH42 -->';
const NAV_REPLACE = [
  NAV_FIND,
  '    <button class="sb-item" data-tab="refunds" onclick="navTo(\'refunds\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg><span>Refunds</span><span id="refunds-nav-count" style="display:none;margin-left:auto;background:#DC2626;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:10px"></span></button><!-- TMC_PATCH53_ADMIN -->'
].join('\n');

/* =====================================================================
 * EDIT 2  add the panel. We anchor right BEFORE the Retention panel
 * comment so the new one is structurally near related tooling.
 * Wait  the Retention panel is in the middle of the file. Cleaner anchor:
 * the closing of the Retention panel div. But finding that uniquely is
 * tricky. Use the `panel-retention` opening as forward anchor and inject
 * a sibling panel after the panel's closing div.
 *
 * Simpler approach: find the unique `id="panel-retention"` opening,
 * insert our new panel right before it (so it appears in nav order
 * matters not  the panels are show/hide-by-id, not ordered).
 * ===================================================================*/

const PANEL_FIND = '      <!-- TMC_PATCH42 Retention panel -->';
const PANEL_REPLACE = [
  '      <!-- TMC_PATCH53_ADMIN Refunds panel -->',
  '      <div class="panel" id="panel-refunds">',
  '        <div class="section">',
  '          <div class="section-head">',
  '            <div class="section-title">Failed refunds</div>',
  '            <span class="section-link" onclick="loadFailedRefunds()" style="cursor:pointer">Refresh</span>',
  '          </div>',
  '          <div style="font-size:12px;color:#6B7280;margin:6px 0 14px;line-height:1.5">Orders where Stripe refund-create returned an error. The user has been emailed asking us to follow up. After you process the refund manually in the Stripe Dashboard, click <b>Mark resolved</b> to clear it.</div>',
  '          <div id="refunds-list" style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden"></div>',
  '          <label style="display:inline-flex;align-items:center;gap:8px;margin-top:14px;font-size:12px;color:#6B7280;cursor:pointer">',
  '            <input type="checkbox" id="refunds-include-resolved" onchange="loadFailedRefunds()">',
  '            <span>Include already-resolved entries</span>',
  '          </label>',
  '        </div>',
  '      </div>',
  '',
  '      <!-- TMC_PATCH42 Retention panel -->'
].join('\n');

/* =====================================================================
 * EDIT 3  TAB_TITLES + TAB_SUBS entries. Anchor on the Retention key
 * inside each object.
 * ===================================================================*/

const TT_FIND = '"retention": "Retention"}';
const TT_REPLACE = '"retention": "Retention", "refunds": "Refunds"}';

const TS_FIND = '"retention": "Exit reasons, opt-in counts, lapsed emails"}';
const TS_REPLACE = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review"}';

/* =====================================================================
 * EDIT 4  JS  fetch + render + resolve handler. Anchor on a unique line
 * near other admin JS so it sits with related code. We append after the
 * navTo() function. Easiest: append right before the closing </script>
 * of the admin script block. There are multiple <script> blocks  we
 * need to land in the same scope where navTo lives.
 *
 * Inspecting the file, the admin code lives in one big <script> block.
 * We anchor on the TMC_PATCH42 retention-tab-logic block which sits in
 * that script. Insert our function definitions after the end of that
 * block.
 *
 * Cleaner anchor: a unique recognizable line that closes the retention
 * logic. The line "TMC_PATCH42 Retention tab logic" is the START. Look
 * for the next blank-line followed by something else. Hard to pin.
 *
 * Easiest robust approach: anchor on `const TAB_TITLES = ` line; insert
 * the JS right after the TAB_SUBS line (we already replaced it above with
 * a longer string). Read the file AGAIN after edits 1-3 to find new state.
 * Use a unique marker.
 *
 * Even simpler: use `const TAB_TITLES = ` for anchor and inject BEFORE it
 * inside a small IIFE so scope isn't an issue.
 *
 * No  these are at module top of the embedded <script>. Functions need
 * to be in scope when navTo runs and when the buttons fire. Just place
 * the new functions near the end of the script. The script tag ends with
 * `</script>` and there's probably only one big admin script block. We
 * anchor on a unique near-end pattern.
 * ===================================================================*/

/* Pick a stable late anchor: a closing helper or known function. We'll
   anchor on the existing window-level function "navTo" definition  this
   is the dispatcher every nav item uses. Insert our additions right after
   the closing brace of navTo. To avoid getting too fancy, the cleanest
   anchor: the line `const TAB_SUBS = {...};` (now patched). Insert AFTER. */

const JS_FIND_AFTER_PATCH = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review"}; /* TMC_PATCH42 */';

const JS_REPLACE_AFTER_PATCH = [
  JS_FIND_AFTER_PATCH,
  '',
  '/* TMC_PATCH53_ADMIN: failed-refunds tab logic. */',
  'async function loadFailedRefunds() {',
  '  const list = document.getElementById("refunds-list");',
  '  const navCount = document.getElementById("refunds-nav-count");',
  '  if (!list) return;',
  '  list.innerHTML = \'<div style="padding:18px;font-size:13px;color:#6B7280;text-align:center">Loading...</div>\';',
  '  const includeResolved = !!(document.getElementById("refunds-include-resolved") && document.getElementById("refunds-include-resolved").checked);',
  '  try {',
  '    const res = await fetch("/api/admin-failed-refunds" + (includeResolved ? "?include_resolved=1" : ""));',
  '    if (!res.ok) throw new Error("admin auth required");',
  '    const data = await res.json();',
  '    const orders = (data && data.orders) || [];',
  '    /* Update the small red badge on the nav  unresolved count only. */',
  '    if (navCount) {',
  '      const unresolved = orders.filter(function (o) { return !o.resolved; }).length;',
  '      if (unresolved > 0) { navCount.textContent = String(unresolved); navCount.style.display = "inline-block"; }',
  '      else                { navCount.style.display = "none"; }',
  '    }',
  '    if (orders.length === 0) {',
  '      list.innerHTML = \'<div style="padding:24px;font-size:13px;color:#6B7280;text-align:center">No failed refunds. \\u2728</div>\';',
  '      return;',
  '    }',
  '    list.innerHTML = orders.map(function (o, i) {',
  '      const border = (i < orders.length - 1) ? "border-bottom:1px solid #F3F4F6;" : "";',
  '      const userName  = (o.user && (o.user.name || o.user.email)) || o.user.id || "unknown user";',
  '      const userEmail = (o.user && o.user.email) || "";',
  '      const amount = "$" + ((o.amount_cents || 0) / 100).toFixed(2);',
  '      const when   = o.refund_failed_at ? new Date(o.refund_failed_at).toLocaleString() : "";',
  '      const err    = (o.refund_error_message || "").replace(/</g, "&lt;");',
  '      const statusBadge = o.resolved',
  '        ? \'<span style="background:#D1FAE5;color:#065F46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Resolved</span>\'',
  '        : \'<span style="background:#FEE2E2;color:#7F1D1D;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Open</span>\';',
  '      const actionBtn = o.resolved',
  '        ? \'\'',
  '        : \'<button type="button" onclick="resolveRefund(\\\'\' + o.order_id + \'\\\')" style="background:#FF6B00;color:#fff;border:0;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Mark resolved</button>\';',
  '      return \'<div style="padding:14px;\' + border + \'">\' +',
  '        \'<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">\' +',
  '          \'<div style="flex:1;min-width:0">\' +',
  '            \'<div style="font-size:13px;font-weight:700;color:#111">\' + userName + \'</div>\' +',
  '            (userEmail && userEmail !== userName ? \'<div style="font-size:11px;color:#6B7280">\' + userEmail + \'</div>\' : "") +',
  '          \'</div>\' +',
  '          \'<div style="font-size:14px;font-weight:800;color:#111">\' + amount + \'</div>\' +',
  '          statusBadge +',
  '        \'</div>\' +',
  '        \'<div style="font-size:11px;color:#6B7280;margin-bottom:8px">\' + when + \' &middot; order \' + o.order_id.slice(0,8) + \'</div>\' +',
  '        \'<div style="background:#FEF2F2;border:1px solid #FECACA;padding:8px 10px;border-radius:8px;font-size:11px;color:#7F1D1D;font-family:ui-monospace,monospace;word-break:break-word;line-height:1.5;margin-bottom:8px">\' + (err || "(no error message)") + \'</div>\' +',
  '        actionBtn +',
  '      \'</div>\';',
  '    }).join("");',
  '  } catch (e) {',
  '    list.innerHTML = \'<div style="padding:18px;font-size:13px;color:#DC2626;text-align:center">Could not load failed refunds.</div>\';',
  '  }',
  '}',
  '',
  'async function resolveRefund(orderId) {',
  '  if (!confirm("Mark this refund as manually resolved? This means you have already processed the refund in Stripe.")) return;',
  '  try {',
  '    const res = await fetch("/api/admin-resolve-refund", {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({ order_id: orderId })',
  '    });',
  '    if (!res.ok) throw new Error("resolve failed");',
  '    loadFailedRefunds();',
  '  } catch (e) {',
  '    alert("Could not mark as resolved. Try again.");',
  '  }',
  '}',
  '',
  '/* Auto-load the refunds list whenever the Refunds tab is opened, and also',
  '   once on page load so the nav badge gets populated. */',
  '(function () {',
  '  if (window.__tmcRefundsInit) return;',
  '  window.__tmcRefundsInit = true;',
  '  /* On any nav button click that targets refunds, reload. */',
  '  document.addEventListener("click", function (e) {',
  '    const btn = e.target.closest && e.target.closest("[data-tab=\\"refunds\\"]");',
  '    if (btn) setTimeout(loadFailedRefunds, 20);',
  '  });',
  '  /* Also load once a bit after page render so the badge gets a count. */',
  '  setTimeout(loadFailedRefunds, 1200);',
  '})();'
].join('\n');

/* =====================================================================
 * DRIVER
 * ===================================================================*/

log('\nTapMyCar  Patch 53-admin-ui  failed-refunds tab\n');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(ADMIN_HTML)) fail('expected file not found: ' + ADMIN_HTML);
const original = fs.readFileSync(ADMIN_HTML, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(ADMIN_HTML + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const edits = [
  { label: 'sidebar nav button',           find: NAV_FIND,                replace: NAV_REPLACE              },
  { label: 'panel insert',                 find: PANEL_FIND,              replace: PANEL_REPLACE            },
  { label: 'TAB_TITLES entry',             find: TT_FIND,                 replace: TT_REPLACE               },
  { label: 'TAB_SUBS entry',               find: TS_FIND,                 replace: TS_REPLACE               },
  { label: 'JS append (loadFailedRefunds)',find: JS_FIND_AFTER_PATCH,     replace: JS_REPLACE_AFTER_PATCH   }
];
for (const e of edits) {
  const i = updated.indexOf(e.find);
  if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
  if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
  updated = updated.replace(e.find, () => e.replace);
}

if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(ADMIN_HTML, path.join(BACKUP_DIR, ADMIN_HTML));
fs.writeFileSync(ADMIN_HTML, updated, 'utf8');

/* syntax-check the embedded script block where we inserted the JS */
const s = fs.readFileSync(ADMIN_HTML, 'utf8');
const at = s.indexOf('TMC_PATCH53_ADMIN: failed-refunds tab logic');
if (at !== -1) {
  const a = s.lastIndexOf('<script>', at) + 8;
  const b = s.indexOf('</script>', at);
  fs.writeFileSync('/tmp/p53-admin-chk.js', s.slice(a, b));
  try {
    execSync('node --check /tmp/p53-admin-chk.js', { stdio: 'pipe' });
    log(ADMIN_HTML + ': patched, node --check OK');
  } catch (e) {
    fs.writeFileSync(ADMIN_HTML, original, 'utf8');
    fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
  }
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 53-admin-ui: failed-refunds tab"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Open the admin page, log in, click the new "Refunds" sidebar item.');
log('     Expect: empty list ("No failed refunds.") because none exist yet.');
log('     The red badge next to the nav label appears only when there are');
log('     unresolved entries.\n');
