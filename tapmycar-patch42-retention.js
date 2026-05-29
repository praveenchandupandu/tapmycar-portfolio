/* ============================================================================
 * TapMyCar  Patch 42  retention: pre-delete modal + lapsed cron + admin tab
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch42-retention.js
 *
 * Three independent parts. The driver applies them as separate "groups" —
 * if one group fails to match, the other groups still apply, so testing
 * issues with (say) the admin tab don't block the pre-delete modal.
 *
 *   GROUP 1: pre-delete modal in settings.html
 *      Replaces the existing deleteAccount() function (which uses two
 *      browser confirm/prompt dialogs) with a custom modal that captures:
 *        - exit_reason_code (radio button, one of 6 categories)
 *        - exit_reason (free text, optional)
 *        - email opt-in for future marketing (unchecked by default)
 *      Submits to the existing /api/delete-account with three new fields.
 *      Falls back gracefully if any field is missing (server-side defaults).
 *
 *   GROUP 2: api/delete-account.js — capture before deletion
 *      Before the existing cancel-cascade-delete sequence runs, write
 *      exit_reason_code, exit_reason, exit_reason_at to the user row, and
 *      set email_opt_out based on the new marketing_consent checkbox (the
 *      existing email_opt_out column is the source of truth — we DON'T
 *      use the marketing_consent column added in Patch 41; that one stays
 *      unused and harmless). Also writes a marketing_suppression row when
 *      the user did not opt in, so a re-registration with the same email
 *      stays suppressed.
 *
 *   GROUP 3: api/cron-lapsed-email.js — new file
 *      Daily cron at 10am UTC. Finds users matching:
 *        - created_at < 30 days ago
 *        - plan = 'etag'  AND  subscription_id IS NULL    (never paid)
 *        - email_opt_out = false                          (opted in)
 *        - lapsed_email_sent_at IS NULL                   (not yet emailed)
 *        - NOT in marketing_suppression by email
 *      Sends one email each via Resend, then sets lapsed_email_sent_at so
 *      they're never re-emailed. Capped at 50/run for safety.
 *      Protected by Bearer CRON_SECRET, same pattern as gift-expiry-cron.
 *      vercel.json cron entry added too.
 *
 *   GROUP 4: api/get-retention-stats.js  +  admin Retention tab
 *      New admin-only endpoint returning aggregated exit-reason counts
 *      (last 90 days), count of opted-in users, and count of lapsed
 *      emails sent in the last 30 days. New "Retention" sidebar item in
 *      the admin panel and a small panel-retention rendering those stats.
 *
 * SAFE TO RE-RUN: each file is skipped if it already contains TMC_PATCH42.
 * Two-pass per group: nothing in a group is written unless every pattern
 * in that group is found.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH42';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch42-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * GROUP 1  public/settings.html  — pre-delete modal
 * ======================================================================*/

const SETTINGS = path.join('public', 'settings.html');

const SETTINGS_FIND = [
  "async function deleteAccount() {",
  "  const first = confirm('Delete your TapMyCar account permanently?\\n\\nThis will:\\n• Cancel any active subscription\\n• Disable all your tags (scans will show \"inactive\")\\n• Permanently delete your personal data\\n\\nThis cannot be undone.');",
  "  if (!first) return;",
  "  const typed = prompt('To confirm, type DELETE (all caps) in the box below:');",
  "  if (typed !== 'DELETE') {",
  "    if (typed !== null) showToast('Delete cancelled — confirmation text did not match');",
  "    return;",
  "  }",
  "  try {",
  "    const res = await fetch('/api/delete-account', {",
  "      method: 'POST',",
  "      headers: {'Content-Type':'application/json'},",
  "      body: JSON.stringify({ user_id: s.token, confirm: 'DELETE' })",
  "    });",
  "    const data = await res.json();",
  "    if (data.success) {",
  "      showToast('Account deleted. Goodbye!');",
  "      localStorage.clear();",
  "      setTimeout(() => { window.location.href = '/landing.html'; }, 1500);",
  "    } else {",
  "      showToast(data.error || 'Failed to delete account. Please contact support@tapmycar.io.');",
  "    }",
  "  } catch(e) { showToast('Network error — please try again'); }",
  "}"
].join('\n');

const SETTINGS_REPLACE = [
  "/* TMC_PATCH42_PREDELETE: replaces the two-step confirm/prompt flow with a",
  "   single custom modal that also captures exit reason + email consent.",
  "   The existing /api/delete-account contract is preserved (still passes",
  "   confirm:'DELETE'); the three new fields are added alongside. */",
  "function deleteAccount() {",
  "  /* lazy-build the modal so settings.html doesn't carry its DOM until needed */",
  "  var existing = document.getElementById('tmc-predelete-modal');",
  "  if (existing) { existing.style.display = 'flex'; return; }",
  "",
  "  var ov = document.createElement('div');",
  "  ov.id = 'tmc-predelete-modal';",
  "  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif';",
  "  ov.innerHTML =",
  "    '<div style=\"background:#fff;max-width:440px;width:100%;border-radius:16px;padding:22px;max-height:92vh;overflow-y:auto\">' +",
  "      '<div style=\"font-size:18px;font-weight:800;color:#111;margin-bottom:6px\">Before you go</div>' +",
  "      '<div style=\"font-size:13px;color:#6B7280;line-height:1.55;margin-bottom:18px\">Deleting your account cancels any active subscription, disables your tags, and permanently removes your personal data. This cannot be undone.</div>' +",
  "      '<div style=\"font-size:13px;font-weight:700;color:#111;margin-bottom:8px\">Why are you leaving?</div>' +",
  "      '<div id=\"tmc-pd-reasons\" style=\"display:flex;flex-direction:column;gap:6px;margin-bottom:12px\">' +",
  "        reasonRow('too_expensive',     'It\\'s too expensive') +",
  "        reasonRow('no_longer_need',    'I no longer need it') +",
  "        reasonRow('not_as_expected',   'It didn\\'t work as I expected') +",
  "        reasonRow('privacy_concerns',  'Privacy concerns') +",
  "        reasonRow('found_alternative', 'I found an alternative') +",
  "        reasonRow('other',             'Other') +",
  "      '</div>' +",
  "      '<textarea id=\"tmc-pd-text\" placeholder=\"Anything else you\\'d like us to know? (optional)\" style=\"width:100%;box-sizing:border-box;min-height:60px;padding:10px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:13px;font-family:inherit;resize:vertical;margin-bottom:14px\"></textarea>' +",
  "      '<label style=\"display:flex;align-items:flex-start;gap:8px;padding:10px;border:1.5px solid #E5E7EB;border-radius:10px;margin-bottom:14px;cursor:pointer\">' +",
  "        '<input type=\"checkbox\" id=\"tmc-pd-consent\" style=\"margin-top:2px;flex-shrink:0\">' +",
  "        '<span style=\"font-size:12px;color:#374151;line-height:1.5\">It\\'s OK to email me about future offers and updates from TapMyCar.</span>' +",
  "      '</label>' +",
  "      '<div id=\"tmc-pd-err\" style=\"font-size:12px;color:#DC2626;min-height:18px;margin-bottom:8px\"></div>' +",
  "      '<div style=\"display:flex;gap:10px\">' +",
  "        '<button type=\"button\" onclick=\"closePreDelete()\" style=\"flex:1;padding:12px;border:1.5px solid #E5E7EB;background:#fff;border-radius:10px;font-weight:700;font-size:13px;color:#111;cursor:pointer\">Cancel</button>' +",
  "        '<button type=\"button\" id=\"tmc-pd-go\" onclick=\"submitPreDelete()\" style=\"flex:1;padding:12px;background:#DC2626;color:#fff;border:0;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer\">Permanently delete</button>' +",
  "      '</div>' +",
  "    '</div>';",
  "  document.body.appendChild(ov);",
  "  function reasonRow(code, label) {",
  "    return '<label style=\"display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:8px;cursor:pointer\">' +",
  "      '<input type=\"radio\" name=\"tmc-pd-reason\" value=\"' + code + '\" style=\"flex-shrink:0\">' +",
  "      '<span style=\"font-size:13px;color:#111\">' + label + '</span></label>';",
  "  }",
  "}",
  "",
  "function closePreDelete() {",
  "  var m = document.getElementById('tmc-predelete-modal');",
  "  if (m) m.remove();",
  "}",
  "",
  "async function submitPreDelete() {",
  "  var radio = document.querySelector('input[name=\"tmc-pd-reason\"]:checked');",
  "  var err = document.getElementById('tmc-pd-err');",
  "  if (!radio) { err.textContent = 'Please choose a reason.'; return; }",
  "  var reasonCode = radio.value;",
  "  var reasonText = (document.getElementById('tmc-pd-text').value || '').trim().slice(0, 1000);",
  "  var consent    = !!document.getElementById('tmc-pd-consent').checked;",
  "  var go = document.getElementById('tmc-pd-go');",
  "  go.disabled = true; go.textContent = 'Deleting…'; err.textContent = '';",
  "  try {",
  "    var res = await fetch('/api/delete-account', {",
  "      method: 'POST',",
  "      headers: {'Content-Type':'application/json'},",
  "      body: JSON.stringify({",
  "        user_id: s.token,",
  "        confirm: 'DELETE',",
  "        exit_reason_code: reasonCode,",
  "        exit_reason_text: reasonText,",
  "        marketing_consent: consent",
  "      })",
  "    });",
  "    var data = await res.json();",
  "    if (data.success) {",
  "      closePreDelete();",
  "      showToast('Account deleted. Goodbye!');",
  "      localStorage.clear();",
  "      setTimeout(function () { window.location.href = '/landing.html'; }, 1500);",
  "    } else {",
  "      go.disabled = false; go.textContent = 'Permanently delete';",
  "      err.textContent = data.error || 'Failed to delete. Please contact support@tapmycar.io.';",
  "    }",
  "  } catch (e) {",
  "    go.disabled = false; go.textContent = 'Permanently delete';",
  "    err.textContent = 'Network error — please try again.';",
  "  }",
  "}"
].join('\n');

/* ========================================================================
 * GROUP 2  api/delete-account.js  — capture exit reason + consent before delete
 * ======================================================================*/

const DELETE_ACCOUNT = path.join('api', 'delete-account.js');

const DELETE_FIND = [
  "  const { confirm } = req.body;",
  "  if (confirm !== \"DELETE\") {",
  "    return res.status(400).json({ error: \"Confirmation required. Pass confirm: 'DELETE' to proceed.\" });",
  "  }",
  "",
  "  const { data: user } = await supabase.from(\"users\").select(\"*\").eq(\"id\", user_id).single();",
  "  if (!user) return res.status(404).json({ error: \"User not found\" });",
  "",
  "  const userEmail = user.email;",
  "  const userName = user.name;"
].join('\n');

const DELETE_REPLACE = [
  "  const { confirm, exit_reason_code, exit_reason_text, marketing_consent } = req.body;",
  "  if (confirm !== \"DELETE\") {",
  "    return res.status(400).json({ error: \"Confirmation required. Pass confirm: 'DELETE' to proceed.\" });",
  "  }",
  "",
  "  const { data: user } = await supabase.from(\"users\").select(\"*\").eq(\"id\", user_id).single();",
  "  if (!user) return res.status(404).json({ error: \"User not found\" });",
  "",
  "  const userEmail = user.email;",
  "  const userName = user.name;",
  "",
  "  /* TMC_PATCH42_EXITREASON: capture exit reason + marketing consent BEFORE",
  "     the cascade-delete runs. Failures here are non-fatal — we never want",
  "     a logging hiccup to block a user's right to delete their account. */",
  "  try {",
  "    const VALID = ['too_expensive','no_longer_need','not_as_expected','privacy_concerns','found_alternative','other'];",
  "    const code = VALID.indexOf(exit_reason_code) !== -1 ? exit_reason_code : null;",
  "    const text = typeof exit_reason_text === 'string' ? exit_reason_text.slice(0, 1000) : null;",
  "    const consent = marketing_consent === true;",
  "    /* email_opt_out is the canonical opt-out flag the broadcast system",
  "       reads. consent === true means we may email them; opt_out = false. */",
  "    await supabase.from('users').update({",
  "      exit_reason: text,",
  "      exit_reason_code: code,",
  "      exit_reason_at: new Date().toISOString(),",
  "      marketing_consent: consent,",
  "      marketing_consent_at: new Date().toISOString(),",
  "      marketing_consent_source: 'pre_delete_modal',",
  "      email_opt_out: !consent",
  "    }).eq('id', user_id);",
  "    /* If they did NOT opt in, add a suppression row keyed by email so a",
  "       re-registration with the same email stays suppressed forever. */",
  "    if (!consent && userEmail) {",
  "      await supabase.from('marketing_suppression').insert({",
  "        email: userEmail,",
  "        reason: 'account_deleted',",
  "        source: 'pre_delete_modal'",
  "      });",
  "    }",
  "  } catch (e) {",
  "    console.warn('TMC_PATCH42 exit-reason capture failed (non-fatal):', e && e.message);",
  "  }"
].join('\n');

/* ========================================================================
 * GROUP 3  api/cron-lapsed-email.js  (new file) + vercel.json cron entry
 * ======================================================================*/

const CRON_FILE = path.join('api', 'cron-lapsed-email.js');
const CRON_BODY = [
  "// TMC_PATCH42_LAPSED",
  "// Daily cron at 10:00 UTC. Sends one re-engagement email to each user who:",
  "//   - signed up 30+ days ago",
  "//   - never paid (plan = 'etag' AND subscription_id is null)",
  "//   - opted-in (email_opt_out = false)",
  "//   - hasn't been emailed yet (lapsed_email_sent_at is null)",
  "//   - is NOT in marketing_suppression by email",
  "// Sets lapsed_email_sent_at after sending so they're never re-emailed.",
  "// Capped at 50 sends per run. Bearer CRON_SECRET auth.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { Resend } = require('resend');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "const resend   = new Resend(process.env.RESEND_API_KEY);",
  "",
  "const FROM = 'TapMyCar <noreply@tapmycar.io>';",
  "const SITE = 'https://tapmycar.io';",
  "const CAP  = 50;",
  "",
  "function htmlFor(user) {",
  "  const name = user.name ? user.name.split(' ')[0] : 'there';",
  "  const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(user.id) +",
  "                '&t=' + encodeURIComponent(user.unsubscribe_token || '');",
  "  return '' +",
  "    '<div style=\"font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111\">' +",
  "      '<div style=\"font-size:22px;font-weight:800;padding:12px 4px\">' +",
  "        'TapMyCar<span style=\"color:#FF6B00\">.</span></div>' +",
  "      '<div style=\"background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:26px 24px\">' +",
  "        '<h1 style=\"font-size:18px;font-weight:800;margin:0 0 12px\">Hi ' + name + ', still curious about TapMyCar?</h1>' +",
  "        '<p style=\"font-size:14px;line-height:1.65;color:#374151\">You signed up a while back but haven\\'t set up a tag yet. Most TapMyCar customers use it for one of these reasons:</p>' +",
  "        '<ul style=\"font-size:14px;line-height:1.7;color:#374151;padding-left:18px\">' +",
  "          '<li>Help a stranger reach them privately if their car is blocking traffic</li>' +",
  "          '<li>Get notified when someone is near their car</li>' +",
  "          '<li>Skip writing a phone number on a dashboard note</li>' +",
  "        '</ul>' +",
  "        '<p style=\"margin:22px 0 4px\"><a href=\"' + SITE + '/dashboard.html\" ' +",
  "          'style=\"background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +",
  "          'text-decoration:none;font-weight:700;font-size:14px\">See how it works</a></p>' +",
  "      '</div>' +",
  "      '<div style=\"font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6\">' +",
  "        '<a href=\"' + unsub + '\" style=\"color:#9CA3AF\">Unsubscribe</a> &middot; Praman Tech LLC, Connecticut, USA' +",
  "      '</div>' +",
  "    '</div>';",
  "}",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.headers.authorization !== ('Bearer ' + process.env.CRON_SECRET)) {",
  "    return res.status(401).json({ error: 'Unauthorized' });",
  "  }",
  "",
  "  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();",
  "",
  "  /* Find candidates. Server-side filtering keeps the payload small. */",
  "  const { data: candidates, error: qerr } = await supabase",
  "    .from('users')",
  "    .select('id, email, name, unsubscribe_token, created_at')",
  "    .eq('plan', 'etag')",
  "    .is('subscription_id', null)",
  "    .eq('email_opt_out', false)",
  "    .is('lapsed_email_sent_at', null)",
  "    .lt('created_at', cutoff)",
  "    .not('email', 'is', null)",
  "    .limit(CAP);",
  "",
  "  if (qerr) {",
  "    console.error('lapsed query error:', qerr.message);",
  "    return res.status(500).json({ error: qerr.message });",
  "  }",
  "  if (!candidates || !candidates.length) {",
  "    return res.json({ ok: true, sent: 0, skipped_suppressed: 0 });",
  "  }",
  "",
  "  /* Suppress anyone listed in marketing_suppression by their email. */",
  "  const emails = candidates.map(u => u.email).filter(Boolean);",
  "  const { data: suppressed } = await supabase",
  "    .from('marketing_suppression')",
  "    .select('email')",
  "    .in('email', emails);",
  "  const suppressedSet = new Set((suppressed || []).map(s => (s.email || '').toLowerCase()));",
  "",
  "  let sent = 0, skipped = 0, failed = 0;",
  "  for (const u of candidates) {",
  "    if (suppressedSet.has((u.email || '').toLowerCase())) { skipped++; continue; }",
  "    try {",
  "      await resend.emails.send({",
  "        from: FROM,",
  "        to: u.email,",
  "        subject: 'Still curious about TapMyCar?',",
  "        html: htmlFor(u)",
  "      });",
  "      await supabase.from('users').update({",
  "        lapsed_email_sent_at: new Date().toISOString()",
  "      }).eq('id', u.id);",
  "      sent++;",
  "    } catch (e) {",
  "      console.warn('lapsed send failed for ' + u.email + ':', e && e.message);",
  "      failed++;",
  "    }",
  "  }",
  "",
  "  return res.json({ ok: true, sent, skipped_suppressed: skipped, failed });",
  "};",
  ""
].join('\n');

const VERCEL = 'vercel.json';

/* ========================================================================
 * GROUP 4  api/get-retention-stats.js (new) + admin Retention tab edits
 * ======================================================================*/

const RETENTION_FILE = path.join('api', 'get-retention-stats.js');
const RETENTION_BODY = [
  "// TMC_PATCH42_RETENTION_STATS",
  "// Admin-only. Returns simple aggregated retention metrics:",
  "//   exit_reasons:   { code: count, ... } over last 90 days",
  "//   marketing_consented: total users with email_opt_out = false AND email IS NOT NULL",
  "//   lapsed_emails_sent_30d: count of users with lapsed_email_sent_at in last 30 days",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (!resolveAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const ninetyDays = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();",
  "  const thirtyDays = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();",
  "",
  "  try {",
  "    /* Exit reasons in last 90 days, grouped client-side (Supabase JS",
  "       doesn't expose group-by; the volumes are small enough that fetching",
  "       the rows and counting in JS is fine). */",
  "    const { data: exits } = await supabase",
  "      .from('users')",
  "      .select('exit_reason_code')",
  "      .gte('exit_reason_at', ninetyDays)",
  "      .not('exit_reason_code', 'is', null);",
  "    const exit_reasons = {};",
  "    (exits || []).forEach(r => {",
  "      const k = r.exit_reason_code || 'unknown';",
  "      exit_reasons[k] = (exit_reasons[k] || 0) + 1;",
  "    });",
  "",
  "    const { count: opted_in } = await supabase",
  "      .from('users')",
  "      .select('id', { count: 'exact', head: true })",
  "      .eq('email_opt_out', false)",
  "      .not('email', 'is', null);",
  "",
  "    const { count: lapsed_30d } = await supabase",
  "      .from('users')",
  "      .select('id', { count: 'exact', head: true })",
  "      .gte('lapsed_email_sent_at', thirtyDays);",
  "",
  "    return res.json({",
  "      ok: true,",
  "      exit_reasons,",
  "      exit_total_90d: (exits || []).length,",
  "      marketing_consented: opted_in || 0,",
  "      lapsed_emails_sent_30d: lapsed_30d || 0",
  "    });",
  "  } catch (e) {",
  "    return res.status(500).json({ error: e.message });",
  "  }",
  "};",
  ""
].join('\n');

const ADMIN_HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* sidebar button — inserted right after the Audit button */
const ADMIN_SIDEBAR_FIND =
  "    <button class=\"sb-item\" data-tab=\"broadcast\" onclick=\"navTo('broadcast')\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 11l18-8-8 18-2-8-8-2z\"/></svg><span>Broadcast</span></button><!-- TMC_PATCH44_BROADCAST -->";

const ADMIN_SIDEBAR_REPLACE = ADMIN_SIDEBAR_FIND + "\r\n" +
  "    <button class=\"sb-item\" data-tab=\"retention\" onclick=\"navTo('retention')\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 6L9 17l-5-5\"/></svg><span>Retention</span></button><!-- TMC_PATCH42 -->";

/* TAB_TITLES / TAB_SUBS additions */
const ADMIN_TITLES_FIND =
  "const TAB_TITLES = {\"home\": \"Home\", \"users\": \"Users\", \"orders\": \"Orders\", \"leads\": \"Leads\", \"tags\": \"Tags\", \"analytics\": \"Analytics\", \"scans\": \"Scans\", \"upgrade\": \"Upgrade tracker\", \"reviews\": \"Reviews\", \"generate\": \"Generate\", \"receive\": \"Receive\", \"inventory\": \"Inventory\", \"promos\": \"Promos\", \"audit\": \"Audit\", \"broadcast\": \"Broadcast\"};";
const ADMIN_TITLES_REPLACE =
  "const TAB_TITLES = {\"home\": \"Home\", \"users\": \"Users\", \"orders\": \"Orders\", \"leads\": \"Leads\", \"tags\": \"Tags\", \"analytics\": \"Analytics\", \"scans\": \"Scans\", \"upgrade\": \"Upgrade tracker\", \"reviews\": \"Reviews\", \"generate\": \"Generate\", \"receive\": \"Receive\", \"inventory\": \"Inventory\", \"promos\": \"Promos\", \"audit\": \"Audit\", \"broadcast\": \"Broadcast\", \"retention\": \"Retention\"}; /* TMC_PATCH42 */";

const ADMIN_SUBS_FIND =
  "const TAB_SUBS = {\"home\": \"At-a-glance view of the business\", \"users\": \"Search, manage, and gift plans\", \"orders\": \"Physical shipping and fulfillment\", \"leads\": \"Feedback emails captured on contact pages\", \"tags\": \"All tokens in the system\", \"analytics\": \"Revenue, scans, and growth metrics\", \"scans\": \"Raw scan history\", \"upgrade\": \"Users approaching day 30 auto-upgrade\", \"reviews\": \"Approve reviews, toggle visibility, feature on landing\", \"generate\": \"Create new NFC/QR token batches\", \"receive\": \"Verify stickers received from manufacturer\", \"inventory\": \"Stock levels by batch\", \"promos\": \"Gift plans, gift-activate tags, and promo codes\", \"audit\": \"Admin actions and system health\", \"broadcast\": \"Compose and send notifications to users\"};";
const ADMIN_SUBS_REPLACE =
  "const TAB_SUBS = {\"home\": \"At-a-glance view of the business\", \"users\": \"Search, manage, and gift plans\", \"orders\": \"Physical shipping and fulfillment\", \"leads\": \"Feedback emails captured on contact pages\", \"tags\": \"All tokens in the system\", \"analytics\": \"Revenue, scans, and growth metrics\", \"scans\": \"Raw scan history\", \"upgrade\": \"Users approaching day 30 auto-upgrade\", \"reviews\": \"Approve reviews, toggle visibility, feature on landing\", \"generate\": \"Create new NFC/QR token batches\", \"receive\": \"Verify stickers received from manufacturer\", \"inventory\": \"Stock levels by batch\", \"promos\": \"Gift plans, gift-activate tags, and promo codes\", \"audit\": \"Admin actions and system health\", \"broadcast\": \"Compose and send notifications to users\", \"retention\": \"Exit reasons, opt-in counts, lapsed emails\"}; /* TMC_PATCH42 */";

/* the panel itself + render JS — append before </main> (or after the broadcast panel) */
const ADMIN_PANEL_FIND =
  "      <!-- TMC_PATCH44_BROADCAST panel -->";

const ADMIN_PANEL_REPLACE =
  "      <!-- TMC_PATCH42 Retention panel -->\r\n" +
  "      <div class=\"panel\" id=\"panel-retention\">\r\n" +
  "        <div id=\"ret-stats\" style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px\">\r\n" +
  "          <div class=\"empty\">Loading…</div>\r\n" +
  "        </div>\r\n" +
  "        <div style=\"margin-top:18px\">\r\n" +
  "          <div style=\"font-weight:800;font-size:14px;margin-bottom:10px\">Why users are leaving (last 90 days)</div>\r\n" +
  "          <div id=\"ret-reasons\"><div class=\"empty\">Loading…</div></div>\r\n" +
  "        </div>\r\n" +
  "      </div>\r\n" +
  "\r\n" +
  "      <!-- TMC_PATCH44_BROADCAST panel -->";

/* render JS — inserted just before the broadcast tab logic */
const ADMIN_RENDER_FIND =
  "// TMC_PATCH44_BROADCAST - admin broadcast tab logic";

const ADMIN_RENDER_REPLACE = [
  "// TMC_PATCH42 Retention tab logic",
  "(function () {",
  "  var LABEL = {",
  "    too_expensive:     'Too expensive',",
  "    no_longer_need:    'No longer need it',",
  "    not_as_expected:   'Did not work as expected',",
  "    privacy_concerns:  'Privacy concerns',",
  "    found_alternative: 'Found an alternative',",
  "    other:             'Other',",
  "    unknown:           'Not specified'",
  "  };",
  "  function escHTML(s) { return String(s == null ? '' : s).replace(/[&<>\"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'})[c]; }); }",
  "  function stat(label, value) {",
  "    return '<div style=\"padding:14px;background:rgba(0,0,0,0.25);border-radius:10px\">' +",
  "      '<div style=\"font-size:22px;font-weight:800;color:#FF6B00\">' + (value == null ? '—' : value) + '</div>' +",
  "      '<div style=\"font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.04em;margin-top:2px\">' + label + '</div>' +",
  "    '</div>';",
  "  }",
  "  function renderReasons(reasons, total) {",
  "    var keys = Object.keys(reasons || {});",
  "    if (!keys.length || !total) return '<div class=\"empty\">No exit reasons captured yet.</div>';",
  "    keys.sort(function (a, b) { return reasons[b] - reasons[a]; });",
  "    var rows = keys.map(function (k) {",
  "      var n = reasons[k]; var pct = Math.round((n / total) * 100);",
  "      return '<div style=\"display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(0,0,0,0.25);border-radius:8px;margin-bottom:6px\">' +",
  "        '<div style=\"flex:1;font-size:13px;color:#E2E8F0\">' + escHTML(LABEL[k] || k) + '</div>' +",
  "        '<div style=\"font-size:12px;color:#94A3B8\">' + pct + '%</div>' +",
  "        '<div style=\"font-size:13px;font-weight:700;color:#FF6B00;min-width:30px;text-align:right\">' + n + '</div>' +",
  "      '</div>';",
  "    }).join('');",
  "    return rows;",
  "  }",
  "  function load() {",
  "    var stats = document.getElementById('ret-stats');",
  "    var reasons = document.getElementById('ret-reasons');",
  "    fetch('/api/get-retention-stats').then(function (r) { return r.json(); }).then(function (d) {",
  "      if (!d || !d.ok) {",
  "        stats.innerHTML = '<div class=\"empty\">Could not load stats.</div>';",
  "        reasons.innerHTML = '';",
  "        return;",
  "      }",
  "      stats.innerHTML =",
  "        stat('Exits captured (90d)', d.exit_total_90d) +",
  "        stat('Opted-in users',       d.marketing_consented) +",
  "        stat('Lapsed emails (30d)',  d.lapsed_emails_sent_30d);",
  "      reasons.innerHTML = renderReasons(d.exit_reasons, d.exit_total_90d);",
  "    }).catch(function () {",
  "      stats.innerHTML = '<div class=\"empty\">Network error.</div>';",
  "      reasons.innerHTML = '';",
  "    });",
  "  }",
  "  /* hook into the existing tab-change flow by polling once after navTo. */",
  "  var prevNav = window.navTo;",
  "  if (typeof prevNav === 'function' && !window.__tmcRetentionHooked) {",
  "    window.__tmcRetentionHooked = true;",
  "    window.navTo = function (tab) {",
  "      var r = prevNav.apply(this, arguments);",
  "      if (tab === 'retention') { try { load(); } catch (e) {} }",
  "      return r;",
  "    };",
  "  }",
  "})();",
  "",
  "// TMC_PATCH44_BROADCAST - admin broadcast tab logic"
].join('\r\n');

/* ========================================================================
 * DRIVER  (group-by-group, line-ending-agnostic)
 * ======================================================================*/

log('\nTapMyCar  Patch 42  retention features');
log('Backups -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

function applyEditsToFile(file, edits) {
  if (!fs.existsSync(file)) throw new Error('expected file not found: ' + file);
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) return { skipped: true };
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');
  for (const edit of edits) {
    const i = updated.indexOf(edit.find);
    if (i === -1) throw new Error('pattern NOT FOUND in ' + file + ' ["' + edit.label + '"]');
    if (updated.indexOf(edit.find, i + 1) !== -1) throw new Error('pattern found MORE THAN ONCE in ' + file + ' ["' + edit.label + '"]');
    updated = updated.replace(edit.find, function () { return edit.replace; });
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  return { original, updated };
}

const GROUPS = [];

/* Group 1: pre-delete modal */
GROUPS.push({
  name: 'Group 1 — pre-delete modal (settings.html)',
  run: function () {
    const r = applyEditsToFile(SETTINGS, [
      { label: 'replace deleteAccount with modal', find: SETTINGS_FIND, replace: SETTINGS_REPLACE }
    ]);
    if (r.skipped) { log('   - skipped (already patched)'); return false; }
    backupAndWrite(SETTINGS, r.original, r.updated);
    return true;
  }
});

/* Group 2: delete-account.js capture */
GROUPS.push({
  name: 'Group 2 — delete-account.js (capture exit reason + consent)',
  run: function () {
    const r = applyEditsToFile(DELETE_ACCOUNT, [
      { label: 'capture exit reason + consent', find: DELETE_FIND, replace: DELETE_REPLACE }
    ]);
    if (r.skipped) { log('   - skipped (already patched)'); return false; }
    backupAndWrite(DELETE_ACCOUNT, r.original, r.updated);
    execSync('node --check "' + DELETE_ACCOUNT + '"', { stdio: 'pipe' });
    return true;
  }
});

/* Group 3: lapsed cron — new file + vercel.json entry */
GROUPS.push({
  name: 'Group 3 — lapsed-email cron (new file + vercel.json)',
  run: function () {
    let wrote = false;
    if (!fs.existsSync(CRON_FILE)) {
      fs.writeFileSync(CRON_FILE, CRON_BODY, 'utf8');
      execSync('node --check "' + CRON_FILE + '"', { stdio: 'pipe' });
      log('   - created ' + CRON_FILE);
      wrote = true;
    } else {
      log('   - ' + CRON_FILE + ' already exists, leaving as-is');
    }
    /* vercel.json: append a cron entry. We do it by string-edit because
       JSON.parse/stringify would reformat the file and lose comments / order. */
    const vj = fs.readFileSync(VERCEL, 'utf8');
    if (vj.indexOf('/api/cron-lapsed-email') !== -1) {
      log('   - vercel.json already lists the cron, leaving as-is');
      return wrote;
    }
    const cronFind  = '    {\n      \"path\": \"/api/gift-expiry-cron\",\n      \"schedule\": \"0 9 * * *\"\n    }';
    const cronAdd   = cronFind + ',\n    {\n      \"path\": \"/api/cron-lapsed-email\",\n      \"schedule\": \"0 10 * * *\"\n    }';
    if (vj.indexOf(cronFind) === -1) throw new Error('vercel.json cron anchor not found');
    const nv = vj.replace(cronFind, cronAdd);
    backupAndWrite(VERCEL, vj, nv);
    log('   - registered cron in vercel.json (10:00 UTC daily)');
    return true;
  }
});

/* Group 4: retention stats endpoint + admin Retention tab */
GROUPS.push({
  name: 'Group 4 — get-retention-stats endpoint + admin Retention tab',
  run: function () {
    let wrote = false;
    if (!fs.existsSync(RETENTION_FILE)) {
      fs.writeFileSync(RETENTION_FILE, RETENTION_BODY, 'utf8');
      execSync('node --check "' + RETENTION_FILE + '"', { stdio: 'pipe' });
      log('   - created ' + RETENTION_FILE);
      wrote = true;
    } else {
      log('   - ' + RETENTION_FILE + ' already exists, leaving as-is');
    }
    /* admin html: 5 edits — sidebar, titles, subs, panel, render */
    const r = applyEditsToFile(ADMIN_HTML, [
      { label: 'sidebar: add Retention',    find: ADMIN_SIDEBAR_FIND, replace: ADMIN_SIDEBAR_REPLACE },
      { label: 'TAB_TITLES: add retention', find: ADMIN_TITLES_FIND,  replace: ADMIN_TITLES_REPLACE },
      { label: 'TAB_SUBS: add retention',   find: ADMIN_SUBS_FIND,    replace: ADMIN_SUBS_REPLACE },
      { label: 'insert panel-retention',    find: ADMIN_PANEL_FIND,   replace: ADMIN_PANEL_REPLACE },
      { label: 'insert retention render JS',find: ADMIN_RENDER_FIND,  replace: ADMIN_RENDER_REPLACE }
    ]);
    if (r.skipped) { log('   - admin html: skipped (already patched)'); return wrote; }
    backupAndWrite(ADMIN_HTML, r.original, r.updated);
    /* sanity: extract the script block around the new render JS and node --check it */
    const s = r.updated;
    const at = s.indexOf('TMC_PATCH42 Retention tab logic');
    const start = s.lastIndexOf('<script>', at) + 8;
    const end   = s.indexOf('</script>', at);
    fs.writeFileSync('/tmp/p42-chk.js', s.slice(start, end));
    execSync('node --check /tmp/p42-chk.js', { stdio: 'pipe' });
    return true;
  }
});

/* ---- run groups independently; collect successes and failures --------- */
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let okCount = 0, failCount = 0;
for (const g of GROUPS) {
  log(g.name);
  try {
    const changed = g.run();
    if (changed) okCount++;
  } catch (e) {
    failCount++;
    log('   - FAILED: ' + (e && e.message));
    log('   - skipping this group; other groups will still attempt.');
  }
}

log('');
if (failCount === 0) {
  log('Done. All groups applied (' + okCount + ' made changes).\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 42: pre-delete modal, lapsed-email cron, retention admin tab"');
  log('  3. git push   (wait ~60s for Vercel)');
  log('  4. Test  see the verification notes.\n');
} else {
  log('Partial success: ' + okCount + ' group(s) applied, ' + failCount + ' failed.');
  log('Inspect the FAILED messages above. The applied groups are deployable on their own.\n');
  process.exit(1);
}
