/* ============================================================================
 * TapMyCar  Patch 51b  pre-delete retention offer UI + admin stats
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch51b-retention-ui.js
 *
 * Built on top of Patch 51a (backend). This patch adds:
 *
 *   1. SETTINGS UI: intercept inside submitPreDelete() so that BEFORE the
 *      account actually gets deleted, the user sees a $3 retention offer.
 *      - If they accept: POST /api/grant-retention-credit, close the modal,
 *        show a toast, do NOT delete.
 *      - If they decline: POST /api/decline-retention-offer (to consume the
 *        one-time gate), then proceed to the existing delete-account call.
 *      - If they have already been shown the offer (retention_offer_shown_at
 *        already set on user), skip step 2 entirely and go straight to
 *        the existing delete flow.
 *
 *   2. ADMIN RETENTION TAB: a new "Retention offers" stat panel showing
 *      - Offers shown
 *      - Offers accepted (and acceptance rate)
 *      - Credit issued ($ total)
 *      - Last 10 acceptances with timestamps + exit reasons
 *
 * Backend endpoints used:
 *   - GET  /api/get-retention-offer-stats   NEW in this patch (admin only)
 *   - POST /api/grant-retention-credit       from Patch 51a
 *   - POST /api/decline-retention-offer      from Patch 51a
 *
 * Files:
 *   - api/get-retention-offer-stats.js       NEW
 *   - public/settings.html                   submitPreDelete intercepted
 *   - public/cmshaveaccesstouser2026-npmevy.html  Retention panel + JS
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH51B.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH51B';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch51b-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const STATS_EP   = path.join('api', 'get-retention-offer-stats.js');
const SETTINGS   = path.join('public', 'settings.html');
const ADMIN_HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* ========================================================================
 * NEW FILE  api/get-retention-offer-stats.js
 * ======================================================================*/

const STATS_BODY = [
  "// TMC_PATCH51B admin stats for the pre-delete retention offer.",
  "// Returns counts + recent accepted list. Last 90 days by default.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const days  = Math.min(parseInt((req.query && req.query.days) || '90', 10) || 90, 365);",
  "  const since = new Date(Date.now() - days * 86400000).toISOString();",
  "",
  "  /* Count offers shown in the window. */",
  "  const { count: shown, error: e1 } = await supabase",
  "    .from('users')",
  "    .select('id', { count: 'exact', head: true })",
  "    .gte('retention_offer_shown_at', since);",
  "  if (e1) return res.status(500).json({ error: e1.message });",
  "",
  "  /* Count + list accepted. */",
  "  const { data: accepted, error: e2 } = await supabase",
  "    .from('users')",
  "    .select('id, name, email, retention_offer_accepted_at, retention_offer_exit_reason')",
  "    .gte('retention_offer_accepted_at', since)",
  "    .order('retention_offer_accepted_at', { ascending: false })",
  "    .limit(10);",
  "  if (e2) return res.status(500).json({ error: e2.message });",
  "",
  "  /* Total accepted (for accurate rate, not just the 10 we listed). */",
  "  const { count: acceptedTotal, error: e3 } = await supabase",
  "    .from('users')",
  "    .select('id', { count: 'exact', head: true })",
  "    .gte('retention_offer_accepted_at', since);",
  "  if (e3) return res.status(500).json({ error: e3.message });",
  "",
  "  /* Credit issued: count RETENTION-coded referrals in the window. */",
  "  const { data: creditRows } = await supabase",
  "    .from('referrals')",
  "    .select('credit_amount, applied_at')",
  "    .eq('referral_code', 'RETENTION')",
  "    .gte('applied_at', since);",
  "  const creditIssuedCents = (creditRows || []).reduce(function (sum, r) {",
  "    return sum + Math.round((parseFloat(r.credit_amount) || 0) * 100);",
  "  }, 0);",
  "",
  "  return res.json({",
  "    ok: true,",
  "    window_days: days,",
  "    shown: shown || 0,",
  "    accepted: acceptedTotal || 0,",
  "    accept_rate: (shown && shown > 0) ? Math.round(((acceptedTotal || 0) / shown) * 100) : 0,",
  "    credit_issued_cents: creditIssuedCents,",
  "    recent_accepted: (accepted || []).map(function (u) {",
  "      return {",
  "        user_id:        u.id,",
  "        name:           u.name,",
  "        email:          u.email,",
  "        accepted_at:    u.retention_offer_accepted_at,",
  "        exit_reason:    u.retention_offer_exit_reason",
  "      };",
  "    })",
  "  });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * EDIT 1  settings.html  intercept submitPreDelete()
 * ======================================================================*/

const SET_FIND = [
  "async function submitPreDelete() {",
  "  var radio = document.querySelector('input[name=\"tmc-pd-reason\"]:checked');",
  "  var err = document.getElementById('tmc-pd-err');",
  "  if (!radio) { err.textContent = 'Please choose a reason.'; return; }",
  "  var reasonCode = radio.value;",
  "  var reasonText = (document.getElementById('tmc-pd-text').value || '').trim().slice(0, 1000);",
  "  var consent    = !!document.getElementById('tmc-pd-consent').checked;",
  "  var go = document.getElementById('tmc-pd-go');",
  "  go.disabled = true; go.textContent = 'Deleting…'; err.textContent = '';"
].join('\n');

const SET_REPLACE = [
  "/* TMC_PATCH51B: cache the user's step-1 answers so we can use them after",
  "   the retention offer step resolves. */",
  "var __tmcPreDeleteState = null;",
  "",
  "async function submitPreDelete() {",
  "  var radio = document.querySelector('input[name=\"tmc-pd-reason\"]:checked');",
  "  var err = document.getElementById('tmc-pd-err');",
  "  if (!radio) { err.textContent = 'Please choose a reason.'; return; }",
  "  var reasonCode = radio.value;",
  "  var reasonText = (document.getElementById('tmc-pd-text').value || '').trim().slice(0, 1000);",
  "  var consent    = !!document.getElementById('tmc-pd-consent').checked;",
  "  var go = document.getElementById('tmc-pd-go');",
  "",
  "  /* TMC_PATCH51B: if the user hasn't been shown the retention offer yet,",
  "     pause here and show step 2. The actual delete only runs after the user",
  "     either accepts the offer (which short-circuits delete entirely) or",
  "     declines it (which then proceeds with delete). */",
  "  try {",
  "    var probe = await fetch('/api/get-dashboard');",
  "    if (probe.ok) {",
  "      var probeData = await probe.json();",
  "      var alreadyShown = probeData && probeData.user && probeData.user.retention_offer_shown_at;",
  "      if (!alreadyShown) {",
  "        __tmcPreDeleteState = { reasonCode: reasonCode, reasonText: reasonText, consent: consent };",
  "        showRetentionOffer();",
  "        return;",
  "      }",
  "    }",
  "  } catch (e) { /* fall through to delete on probe failure */ }",
  "",
  "  go.disabled = true; go.textContent = 'Deleting…'; err.textContent = '';"
].join('\n');

/* ADD step 2 modal + helpers. Anchor: insert AFTER the closePreDelete function. */
const SET_HELPERS_FIND = "function closePreDelete() {";
const SET_HELPERS_REPLACE = [
  "/* TMC_PATCH51B: pre-delete retention offer (step 2) */",
  "function showRetentionOffer() {",
  "  /* Hide step-1 contents, show step-2 inside the SAME modal. */",
  "  var modal = document.getElementById('tmc-predelete-modal');",
  "  if (!modal) return;",
  "  var card = modal.querySelector('div');",
  "  if (!card) return;",
  "  card.innerHTML = '' +",
  "    '<div style=\"text-align:center;margin-bottom:14px\">' +",
  "      '<div style=\"font-size:32px;margin-bottom:4px\">\\uD83C\\uDF81</div>' +",
  "      '<div style=\"font-size:18px;font-weight:800;color:#111\">Wait \\u2014 here\\'s $3 off your next renewal</div>' +",
  "    '</div>' +",
  "    '<div style=\"font-size:13px;color:#6B7280;line-height:1.6;margin-bottom:16px;text-align:center\">As a thank-you for trying TapMyCar, we\\'d like to credit your account with $3 toward your next annual subscription renewal. Your tag stays active, no charge today.</div>' +",
  "    '<div style=\"background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:12px;margin-bottom:14px;font-size:12px;color:#15803D;text-align:center\">' +",
  "      '<b>$3.00 credit</b>  applies automatically at your next annual renewal' +",
  "    '</div>' +",
  "    '<div id=\"tmc-ret-err\" style=\"font-size:12px;color:#DC2626;min-height:18px;margin-bottom:6px;text-align:center\"></div>' +",
  "    '<div style=\"display:flex;flex-direction:column;gap:8px\">' +",
  "      '<button type=\"button\" id=\"tmc-ret-accept\" onclick=\"acceptRetentionOffer()\" style=\"width:100%;padding:13px;background:#FF6B00;color:#fff;border:0;border-radius:11px;font-weight:700;font-size:14px;cursor:pointer\">Yes, keep my account</button>' +",
  "      '<button type=\"button\" id=\"tmc-ret-decline\" onclick=\"declineRetentionOffer()\" style=\"width:100%;padding:11px;background:transparent;color:#6B7280;border:0;font-weight:600;font-size:13px;cursor:pointer\">No thanks, delete my account</button>' +",
  "    '</div>';",
  "}",
  "",
  "async function acceptRetentionOffer() {",
  "  var btn = document.getElementById('tmc-ret-accept');",
  "  var dec = document.getElementById('tmc-ret-decline');",
  "  var err = document.getElementById('tmc-ret-err');",
  "  if (btn) { btn.disabled = true; btn.textContent = 'Applying \\u2026'; }",
  "  if (dec) dec.disabled = true;",
  "  if (err) err.textContent = '';",
  "  try {",
  "    var res = await fetch('/api/grant-retention-credit', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json' },",
  "      body: JSON.stringify({ exit_reason: __tmcPreDeleteState && __tmcPreDeleteState.reasonCode })",
  "    });",
  "    var data = await res.json();",
  "    if (data && data.ok) {",
  "      closePreDelete();",
  "      showToast('$3 credit added to your account for next renewal!');",
  "      /* Refresh referrals card so the user sees something happened. */",
  "      try { if (typeof loadReferrals === 'function') loadReferrals(); } catch (e) {}",
  "      return;",
  "    }",
  "    /* If already_shown comes back, the user already used this offer.",
  "       Close the modal and fall through to delete  honest. */",
  "    if (data && data.reason === 'already_shown') {",
  "      if (err) err.textContent = 'You\\'ve already used this offer before.';",
  "      if (btn) { btn.disabled = false; btn.textContent = 'Yes, keep my account'; }",
  "      if (dec) dec.disabled = false;",
  "      return;",
  "    }",
  "    throw new Error((data && data.error) || 'Could not apply credit');",
  "  } catch (e) {",
  "    if (err) err.textContent = 'Something went wrong applying the credit. Try again or contact support@tapmycar.io';",
  "    if (btn) { btn.disabled = false; btn.textContent = 'Yes, keep my account'; }",
  "    if (dec) dec.disabled = false;",
  "  }",
  "}",
  "",
  "async function declineRetentionOffer() {",
  "  var st = __tmcPreDeleteState || { reasonCode: '', reasonText: '', consent: false };",
  "  /* Consume the one-time gate so they can\\'t come back and farm it. */",
  "  try {",
  "    await fetch('/api/decline-retention-offer', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json' },",
  "      body: JSON.stringify({ exit_reason: st.reasonCode })",
  "    });",
  "  } catch (e) { /* non-fatal */ }",
  "",
  "  /* Now actually proceed with the delete. We rebuild the spinner state",
  "     inside the modal so the user sees something is happening. */",
  "  var modal = document.getElementById('tmc-predelete-modal');",
  "  if (modal) {",
  "    var card = modal.querySelector('div');",
  "    if (card) card.innerHTML = '<div style=\"padding:30px;text-align:center;font-size:14px;color:#6B7280\">Deleting your account\\u2026</div>';",
  "  }",
  "  try {",
  "    var res = await fetch('/api/delete-account', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json' },",
  "      body: JSON.stringify({",
  "        user_id: s.token,",
  "        confirm: 'DELETE',",
  "        exit_reason_code: st.reasonCode,",
  "        exit_reason_text: st.reasonText,",
  "        marketing_consent: !!st.consent",
  "      })",
  "    });",
  "    var data = await res.json();",
  "    if (data && data.success) {",
  "      closePreDelete();",
  "      showToast('Account deleted. Goodbye!');",
  "      localStorage.clear();",
  "      setTimeout(function () { window.location.href = '/landing.html'; }, 1500);",
  "    } else {",
  "      closePreDelete();",
  "      alert((data && data.error) || 'Failed to delete. Please contact support@tapmycar.io.');",
  "    }",
  "  } catch (e) {",
  "    closePreDelete();",
  "    alert('Network error \\u2014 please try again.');",
  "  }",
  "}",
  "",
  "function closePreDelete() {"
].join('\n');

/* ========================================================================
 * EDIT 2  admin retention panel  add a "Retention offers" stat block
 * ======================================================================*/

const ADMIN_PANEL_FIND = '        <div id="ret-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px">';

const ADMIN_PANEL_REPLACE = [
  '        <!-- TMC_PATCH51B Retention offers section -->',
  '        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:18px">',
  '          <div style="font-weight:800;font-size:14px;margin-bottom:10px">Pre-delete retention offer (last 90 days)</div>',
  '          <div id="ret-offer-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">',
  '            <div style="background:#F9FAFB;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;letter-spacing:0.04em">Offers shown</div><div id="ret-offer-shown" style="font-size:22px;font-weight:800;color:#111;margin-top:4px">\u2026</div></div>',
  '            <div style="background:#F9FAFB;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;letter-spacing:0.04em">Accepted</div><div id="ret-offer-accepted" style="font-size:22px;font-weight:800;color:#15803D;margin-top:4px">\u2026</div></div>',
  '            <div style="background:#F9FAFB;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;letter-spacing:0.04em">Accept rate</div><div id="ret-offer-rate" style="font-size:22px;font-weight:800;color:#111;margin-top:4px">\u2026</div></div>',
  '            <div style="background:#F9FAFB;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;letter-spacing:0.04em">Credit issued</div><div id="ret-offer-credit" style="font-size:22px;font-weight:800;color:#FF6B00;margin-top:4px">\u2026</div></div>',
  '          </div>',
  '          <div id="ret-offer-recent" style="font-size:12px;color:#6B7280"></div>',
  '        </div>',
  '',
  '        <div id="ret-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px">'
].join('\n');

/* JS hook  append a loader for the new stats. Anchor on the existing
   retention tab loader marker. */
const ADMIN_JS_FIND = '// TMC_PATCH42 Retention tab logic';
const ADMIN_JS_REPLACE = [
  '// TMC_PATCH51B Retention offer stats loader',
  'async function loadRetentionOfferStats() {',
  '  try {',
  '    const res = await fetch("/api/get-retention-offer-stats");',
  '    if (!res.ok) return;',
  '    const d = await res.json();',
  '    if (!d || !d.ok) return;',
  '    const shownEl    = document.getElementById("ret-offer-shown");',
  '    const acceptedEl = document.getElementById("ret-offer-accepted");',
  '    const rateEl     = document.getElementById("ret-offer-rate");',
  '    const creditEl   = document.getElementById("ret-offer-credit");',
  '    const recentEl   = document.getElementById("ret-offer-recent");',
  '    if (shownEl)    shownEl.textContent    = String(d.shown);',
  '    if (acceptedEl) acceptedEl.textContent = String(d.accepted);',
  '    if (rateEl)     rateEl.textContent     = (d.shown > 0 ? d.accept_rate + "%" : "\u2014");',
  '    if (creditEl)   creditEl.textContent   = "$" + ((d.credit_issued_cents || 0) / 100).toFixed(2);',
  '    if (recentEl) {',
  '      if (!d.recent_accepted || d.recent_accepted.length === 0) {',
  '        recentEl.innerHTML = \'<div style="padding:6px 0;color:#9CA3AF;font-style:italic">No recent acceptances</div>\';',
  '      } else {',
  '        recentEl.innerHTML = \'<div style="font-weight:700;color:#111;margin-bottom:6px">Recent acceptances</div>\' +',
  '          d.recent_accepted.map(function (u) {',
  '            const when = u.accepted_at ? new Date(u.accepted_at).toLocaleDateString() : "";',
  '            const who  = (u.name || u.email || "unknown");',
  '            const why  = u.exit_reason ? \' \\u00b7 reason: \' + u.exit_reason : "";',
  '            return \'<div style="padding:4px 0;border-bottom:1px solid #F3F4F6">\' + when + \' \\u00b7 \' + who + why + \'</div>\';',
  '          }).join("");',
  '      }',
  '    }',
  '  } catch (e) { /* swallow */ }',
  '}',
  '',
  '/* Load retention-offer stats whenever the Retention tab is opened. */',
  '(function () {',
  '  if (window.__tmcRetOfferInit) return;',
  '  window.__tmcRetOfferInit = true;',
  '  document.addEventListener("click", function (e) {',
  '    const btn = e.target.closest && e.target.closest("[data-tab=\\"retention\\"]");',
  '    if (btn) setTimeout(loadRetentionOfferStats, 20);',
  '  });',
  '  setTimeout(loadRetentionOfferStats, 1200);',
  '})();',
  '',
  '// TMC_PATCH42 Retention tab logic'
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 51b  pre-delete retention offer UI + admin stats\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* NEW endpoint */
if (fs.existsSync(STATS_EP) && fs.readFileSync(STATS_EP, 'utf8').indexOf(MARKER) !== -1) {
  log(STATS_EP + ': skip (already present with marker)');
} else {
  if (fs.existsSync(STATS_EP)) {
    fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
    fs.copyFileSync(STATS_EP, path.join(BACKUP_DIR, STATS_EP));
  }
  fs.writeFileSync(STATS_EP, STATS_BODY, 'utf8');
  try {
    execSync('node --check "' + STATS_EP + '"', { stdio: 'pipe' });
    log(STATS_EP + ': written, node --check OK');
    changed++;
  } catch (e) {
    fail('node --check FAILED for ' + STATS_EP + '\n' + String(e.stderr || e.message));
  }
}

/* settings.html */
{
  const original = fs.readFileSync(SETTINGS, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(SETTINGS + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');

    const edits = [
      { label: 'settings: intercept submitPreDelete', find: SET_FIND,         replace: SET_REPLACE         },
      { label: 'settings: add helper functions',      find: SET_HELPERS_FIND, replace: SET_HELPERS_REPLACE }
    ];
    for (const e of edits) {
      const i = updated.indexOf(e.find);
      if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
      if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
      updated = updated.replace(e.find, () => e.replace);
    }
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(SETTINGS, original, updated);

    /* syntax-check the script block */
    const s = fs.readFileSync(SETTINGS, 'utf8');
    const at = s.indexOf('TMC_PATCH51B: cache the user');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p51b-settings-chk.js', s.slice(a, b));
      try {
        execSync('node --check /tmp/p51b-settings-chk.js', { stdio: 'pipe' });
        log(SETTINGS + ': patched, node --check OK');
      } catch (e) {
        fs.writeFileSync(SETTINGS, original, 'utf8');
        fail('node --check FAILED  settings restored.\n' + String(e.stderr || e.message));
      }
    }
    changed++;
  }
}

/* admin html */
{
  const original = fs.readFileSync(ADMIN_HTML, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(ADMIN_HTML + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');

    const edits = [
      { label: 'admin: insert offer panel', find: ADMIN_PANEL_FIND, replace: ADMIN_PANEL_REPLACE },
      { label: 'admin: insert loader JS',   find: ADMIN_JS_FIND,    replace: ADMIN_JS_REPLACE    }
    ];
    for (const e of edits) {
      const i = updated.indexOf(e.find);
      if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
      if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
      updated = updated.replace(e.find, () => e.replace);
    }
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(ADMIN_HTML, original, updated);

    const s = fs.readFileSync(ADMIN_HTML, 'utf8');
    const at = s.indexOf('TMC_PATCH51B Retention offer stats loader');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p51b-admin-chk.js', s.slice(a, b));
      try {
        execSync('node --check /tmp/p51b-admin-chk.js', { stdio: 'pipe' });
        log(ADMIN_HTML + ': patched, node --check OK');
      } catch (e) {
        fs.writeFileSync(ADMIN_HTML, original, 'utf8');
        fail('node --check FAILED  admin restored.\n' + String(e.stderr || e.message));
      }
    }
    changed++;
  }
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 51b: pre-delete retention offer UI + admin"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Test flow on a TEST account (NOT your main):');
  log('     a) Settings  Delete account  reason  Permanently delete');
  log('     b) Step 2 modal appears: $3 retention offer');
  log('     c) Click Yes  toast appears, account stays, $3 credit on next renewal');
  log('     d) Or click No thanks  account deletes as before');
  log('  5. Verify admin Retention tab shows the new Pre-delete retention');
  log('     offer stats panel above the existing Exit reasons.\n');
}
