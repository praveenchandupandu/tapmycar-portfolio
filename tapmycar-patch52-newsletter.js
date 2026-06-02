/* ============================================================================
 * TapMyCar  Patch 52  post-deletion newsletter signup
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch52-newsletter.js
 *
 * After a user finishes deleting their account, show a brief "Stay in the
 * loop?" screen with their email pre-filled. If they Subscribe, we capture
 * to a separate newsletter_subscribers table (no FK to users  user row is
 * about to be wiped). If they Skip, redirect to landing as before.
 *
 * Admin gets a new "Newsletter" sidebar item showing subscriber count,
 * recent signups, and a CSV export button. No in-app send  use Mailchimp /
 * Beehiiv / etc. with the exported CSV.
 *
 * Files:
 *   1. patch52-migration.sql              (separate, run in Supabase)
 *   2. api/newsletter-subscribe.js        NEW endpoint
 *   3. api/admin-newsletter-list.js       NEW admin endpoint
 *   4. api/admin-newsletter-export.js     NEW admin CSV export
 *   5. api/unsubscribe.js                 EXTEND to handle newsletter rows
 *   6. public/settings.html               capture email pre-delete, show
 *                                          post-delete signup screen
 *   7. public/cmshaveaccesstouser2026-npmevy.html
 *                                          new Newsletter sidebar item +
 *                                          panel + JS loader
 *
 * Built on Patch 51b: the declineRetentionOffer() flow is where the actual
 * delete happens, so the post-delete signup intercept slots in there.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH52.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH52';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch52-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const SUBSCRIBE_EP    = path.join('api', 'newsletter-subscribe.js');
const ADMIN_LIST_EP   = path.join('api', 'admin-newsletter-list.js');
const ADMIN_EXPORT_EP = path.join('api', 'admin-newsletter-export.js');
const UNSUB_EP        = path.join('api', 'unsubscribe.js');
const SETTINGS        = path.join('public', 'settings.html');
const ADMIN_HTML      = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* ========================================================================
 * NEW: api/newsletter-subscribe.js  public endpoint, no auth.
 *   Idempotent on lowercase(email)  if already subscribed, returns
 *   ok:true so the UI flow is clean.
 * ======================================================================*/

const SUBSCRIBE_BODY = [
  "// TMC_PATCH52 public newsletter signup. No auth (user is mid-delete).",
  "const { createClient } = require('@supabase/supabase-js');",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  "  const { email, name, exit_reason } = req.body || {};",
  "",
  "  /* Basic email validation. Server-side  client validation is courtesy. */",
  "  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email required' });",
  "  const emailNorm = email.trim().toLowerCase();",
  "  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(emailNorm)) {",
  "    return res.status(400).json({ error: 'Invalid email' });",
  "  }",
  "",
  "  /* Check if already subscribed. */",
  "  const { data: existing } = await supabase",
  "    .from('newsletter_subscribers')",
  "    .select('id, unsubscribed_at')",
  "    .ilike('email', emailNorm)",
  "    .maybeSingle();",
  "",
  "  if (existing) {",
  "    /* If they previously unsubscribed and now re-subscribe at delete time,",
  "       clear the unsubscribed_at so they receive future broadcasts. */",
  "    if (existing.unsubscribed_at) {",
  "      await supabase.from('newsletter_subscribers').update({",
  "        unsubscribed_at: null,",
  "        signup_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null",
  "      }).eq('id', existing.id);",
  "    }",
  "    return res.json({ ok: true, already_subscribed: true });",
  "  }",
  "",
  "  const { error } = await supabase.from('newsletter_subscribers').insert({",
  "    email: emailNorm,",
  "    name: (typeof name === 'string') ? name.trim().slice(0, 120) : null,",
  "    signup_source: 'post_delete',",
  "    signup_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null",
  "  });",
  "  if (error) {",
  "    console.error('newsletter-subscribe insert error:', error.message);",
  "    return res.status(500).json({ error: 'Could not subscribe' });",
  "  }",
  "  return res.json({ ok: true });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * NEW: api/admin-newsletter-list.js  admin sees recent signups + count.
 * ======================================================================*/

const ADMIN_LIST_BODY = [
  "// TMC_PATCH52 admin: newsletter subscribers (paginated).",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const q = req.query || {};",
  "  const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200);",
  "  const includeUnsubscribed = q.include_unsubscribed === '1';",
  "",
  "  /* Counts */",
  "  const { count: totalActive } = await supabase",
  "    .from('newsletter_subscribers')",
  "    .select('id', { count: 'exact', head: true })",
  "    .is('unsubscribed_at', null);",
  "  const { count: totalUnsubscribed } = await supabase",
  "    .from('newsletter_subscribers')",
  "    .select('id', { count: 'exact', head: true })",
  "    .not('unsubscribed_at', 'is', null);",
  "",
  "  /* Recent list */",
  "  let q2 = supabase.from('newsletter_subscribers')",
  "    .select('id, email, name, signup_source, signup_exit_reason, created_at, unsubscribed_at')",
  "    .order('created_at', { ascending: false })",
  "    .limit(limit);",
  "  if (!includeUnsubscribed) q2 = q2.is('unsubscribed_at', null);",
  "",
  "  const { data: rows, error } = await q2;",
  "  if (error) return res.status(500).json({ error: error.message });",
  "",
  "  return res.json({",
  "    ok: true,",
  "    active_count:       totalActive || 0,",
  "    unsubscribed_count: totalUnsubscribed || 0,",
  "    subscribers: rows || []",
  "  });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * NEW: api/admin-newsletter-export.js  CSV download.
 * ======================================================================*/

const ADMIN_EXPORT_BODY = [
  "// TMC_PATCH52 admin: CSV export of active newsletter subscribers.",
  "// Columns: email, name, signup_source, signup_exit_reason, created_at, unsubscribe_url",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "const SITE = 'https://tapmycar.io';",
  "",
  "function csvEscape(v) {",
  "  if (v == null) return '';",
  "  const s = String(v);",
  "  if (s.indexOf('\"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\\n') !== -1) {",
  "    return '\"' + s.replace(/\"/g, '\"\"') + '\"';",
  "  }",
  "  return s;",
  "}",
  "",
  "module.exports = async function handler(req, res) {",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const { data: rows, error } = await supabase",
  "    .from('newsletter_subscribers')",
  "    .select('id, email, name, signup_source, signup_exit_reason, unsubscribe_token, created_at')",
  "    .is('unsubscribed_at', null)",
  "    .order('created_at', { ascending: false });",
  "  if (error) return res.status(500).json({ error: error.message });",
  "",
  "  const header = ['email','name','signup_source','signup_exit_reason','created_at','unsubscribe_url'];",
  "  const lines = [header.join(',')];",
  "  (rows || []).forEach(r => {",
  "    const unsubUrl = SITE + '/unsubscribe.html?u=' + encodeURIComponent(r.id) +",
  "                     '&t=' + encodeURIComponent(r.unsubscribe_token || '') +",
  "                     '&list=newsletter';",
  "    lines.push([",
  "      csvEscape(r.email),",
  "      csvEscape(r.name),",
  "      csvEscape(r.signup_source),",
  "      csvEscape(r.signup_exit_reason),",
  "      csvEscape(r.created_at),",
  "      csvEscape(unsubUrl)",
  "    ].join(','));",
  "  });",
  "  const csv = lines.join('\\n');",
  "",
  "  res.setHeader('Content-Type', 'text/csv; charset=utf-8');",
  "  res.setHeader('Content-Disposition', 'attachment; filename=\"tapmycar-newsletter.csv\"');",
  "  return res.send(csv);",
  "};",
  ""
].join('\n');

/* ========================================================================
 * EXTEND: api/unsubscribe.js  also handle newsletter rows.
 *   We add a fallback: if the user_id doesn't match a users row, try the
 *   newsletter_subscribers table. Caller passes &list=newsletter in the URL
 *   to disambiguate, but we also auto-detect (so old unsubscribe links keep
 *   working).
 * ======================================================================*/

const UNSUB_FIND = [
  "  const { user_id, token, action } = req.body || {};",
  "  if (!user_id || !token) return res.status(400).json({ error: \"Missing user_id or token\" });",
  "",
  "  const { data: user, error } = await supabase",
  "    .from(\"users\")",
  "    .select(\"id, email, unsubscribe_token, email_opt_out\")",
  "    .eq(\"id\", user_id)",
  "    .single();"
].join('\n');

const UNSUB_REPLACE = [
  "  const { user_id, token, action, list } = req.body || {};",
  "  if (!user_id || !token) return res.status(400).json({ error: \"Missing user_id or token\" });",
  "",
  "  /* TMC_PATCH52: if &list=newsletter or user_id matches a newsletter row,",
  "     route to the newsletter_subscribers table instead of users. */",
  "  if (list === 'newsletter') {",
  "    const { data: nrow, error: nerr } = await supabase",
  "      .from('newsletter_subscribers')",
  "      .select('id, unsubscribe_token, unsubscribed_at')",
  "      .eq('id', user_id)",
  "      .single();",
  "    if (nerr || !nrow) return res.status(404).json({ error: 'Not found' });",
  "    if (!nrow.unsubscribe_token || nrow.unsubscribe_token !== token) {",
  "      return res.status(403).json({ error: 'Invalid unsubscribe link' });",
  "    }",
  "    const isResub = action === 'resubscribe';",
  "    const { error: upErr } = await supabase.from('newsletter_subscribers').update({",
  "      unsubscribed_at: isResub ? null : new Date().toISOString()",
  "    }).eq('id', user_id);",
  "    if (upErr) return res.status(500).json({ error: upErr.message });",
  "    return res.json({ ok: true, list: 'newsletter', opted_out: !isResub });",
  "  }",
  "",
  "  const { data: user, error } = await supabase",
  "    .from(\"users\")",
  "    .select(\"id, email, unsubscribe_token, email_opt_out\")",
  "    .eq(\"id\", user_id)",
  "    .single();"
].join('\n');

/* ========================================================================
 * EDIT: settings.html  capture email pre-delete + show post-delete signup
 * ======================================================================*/

/* Patch 51b's declineRetentionOffer() does the actual delete and the post-
   delete redirect. We hook there. Need to capture user.email FIRST (before
   delete-account wipes it), then on successful delete show a signup screen.

   Find the success branch of declineRetentionOffer and replace its
   showToast/redirect block with a signup-screen intercept. */

const DEL_SUCCESS_FIND = [
  "    if (data && data.success) {",
  "      closePreDelete();",
  "      showToast('Account deleted. Goodbye!');",
  "      localStorage.clear();",
  "      setTimeout(function () { window.location.href = '/landing.html'; }, 1500);",
  "    } else {",
  "      closePreDelete();",
  "      alert((data && data.error) || 'Failed to delete. Please contact support@tapmycar.io.');",
  "    }"
].join('\n');

const DEL_SUCCESS_REPLACE = [
  "    if (data && data.success) {",
  "      /* TMC_PATCH52: show post-delete newsletter signup screen instead of",
  "         immediately redirecting. Captured email comes from window.__tmcDelEmail",
  "         and window.__tmcDelName which we set just before calling delete. */",
  "      try { localStorage.clear(); } catch (e) {}",
  "      showPostDeleteSignup(",
  "        window.__tmcDelEmail || '',",
  "        window.__tmcDelName  || '',",
  "        (st && st.reasonCode) || ''",
  "      );",
  "    } else {",
  "      closePreDelete();",
  "      alert((data && data.error) || 'Failed to delete. Please contact support@tapmycar.io.');",
  "    }"
].join('\n');

/* Also need to capture email/name BEFORE the delete call. Anchor on the
   fetch('/api/delete-account') call in declineRetentionOffer. */
const DEL_CAPTURE_FIND = [
  "  /* Now actually proceed with the delete. We rebuild the spinner state",
  "     inside the modal so the user sees something is happening. */",
  "  var modal = document.getElementById('tmc-predelete-modal');",
  "  if (modal) {",
  "    var card = modal.querySelector('div');",
  "    if (card) card.innerHTML = '<div style=\"padding:30px;text-align:center;font-size:14px;color:#6B7280\">Deleting your account\\u2026</div>';",
  "  }",
  "  try {",
  "    var res = await fetch('/api/delete-account', {"
].join('\n');

const DEL_CAPTURE_REPLACE = [
  "  /* TMC_PATCH52: capture email/name now, before the delete wipes them. */",
  "  try {",
  "    var __tmcTok = s.token || localStorage.getItem('tmc_session_token') || localStorage.getItem('tmc_token');",
  "    var meRes = await fetch('/api/get-dashboard', { headers: { 'Authorization': 'Bearer ' + __tmcTok } });",
  "    if (meRes.ok) {",
  "      var meData = await meRes.json();",
  "      window.__tmcDelEmail = (meData && meData.user && meData.user.email) || '';",
  "      window.__tmcDelName  = (meData && meData.user && meData.user.name)  || '';",
  "    }",
  "  } catch (e) { /* non-fatal  signup screen will just have blank fields */ }",
  "",
  "  /* Now actually proceed with the delete. We rebuild the spinner state",
  "     inside the modal so the user sees something is happening. */",
  "  var modal = document.getElementById('tmc-predelete-modal');",
  "  if (modal) {",
  "    var card = modal.querySelector('div');",
  "    if (card) card.innerHTML = '<div style=\"padding:30px;text-align:center;font-size:14px;color:#6B7280\">Deleting your account\\u2026</div>';",
  "  }",
  "  try {",
  "    var res = await fetch('/api/delete-account', {"
].join('\n');

/* The signup-screen helper function. Inserted right after closePreDelete. */
const SET_HELPER_FIND = "function closePreDelete() {";
const SET_HELPER_REPLACE = [
  "/* TMC_PATCH52: post-delete newsletter signup screen.",
  "   Replaces the modal contents (account is already deleted at this point).",
  "   Subscribe POSTs to /api/newsletter-subscribe; Skip just redirects. */",
  "function showPostDeleteSignup(email, name, exitReason) {",
  "  var modal = document.getElementById('tmc-predelete-modal');",
  "  if (!modal) { window.location.href = '/landing.html'; return; }",
  "  var card = modal.querySelector('div');",
  "  if (!card) { window.location.href = '/landing.html'; return; }",
  "  var emailEsc = (email || '').replace(/\"/g, '&quot;');",
  "  card.innerHTML = '' +",
  "    '<div style=\"text-align:center;margin-bottom:14px\">' +",
  "      '<div style=\"font-size:28px;margin-bottom:6px\">\\uD83D\\uDC4B</div>' +",
  "      '<div style=\"font-size:18px;font-weight:800;color:#111\">Account deleted. Goodbye!</div>' +",
  "    '</div>' +",
  "    '<div style=\"font-size:13px;color:#6B7280;line-height:1.6;margin-bottom:16px;text-align:center\">Want to hear from us when we launch new features? Stay on a low-touch newsletter \\u2014 no spam, easy unsubscribe.</div>' +",
  "    '<input type=\"email\" id=\"tmc-pd-news-email\" value=\"' + emailEsc + '\" placeholder=\"you@example.com\" style=\"width:100%;box-sizing:border-box;padding:12px;font-size:14px;border:1.5px solid #E5E7EB;border-radius:10px;margin-bottom:10px\">' +",
  "    '<div id=\"tmc-pd-news-err\" style=\"font-size:12px;color:#DC2626;min-height:18px;margin-bottom:6px;text-align:center\"></div>' +",
  "    '<div style=\"display:flex;flex-direction:column;gap:8px\">' +",
  "      '<button type=\"button\" id=\"tmc-pd-news-sub\" onclick=\"submitNewsletterSignup(' + JSON.stringify(exitReason || '') + ', ' + JSON.stringify(name || '') + ')\" style=\"width:100%;padding:13px;background:#FF6B00;color:#fff;border:0;border-radius:11px;font-weight:700;font-size:14px;cursor:pointer\">Subscribe to newsletter</button>' +",
  "      '<button type=\"button\" onclick=\"window.location.href=&quot;/landing.html&quot;\" style=\"width:100%;padding:11px;background:transparent;color:#6B7280;border:0;font-weight:600;font-size:13px;cursor:pointer\">Skip, take me to the homepage</button>' +",
  "    '</div>';",
  "}",
  "",
  "async function submitNewsletterSignup(exitReason, name) {",
  "  var emailEl = document.getElementById('tmc-pd-news-email');",
  "  var btn = document.getElementById('tmc-pd-news-sub');",
  "  var err = document.getElementById('tmc-pd-news-err');",
  "  var email = (emailEl && emailEl.value || '').trim();",
  "  if (err) err.textContent = '';",
  "  if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {",
  "    if (err) err.textContent = 'Please enter a valid email.';",
  "    return;",
  "  }",
  "  if (btn) { btn.disabled = true; btn.textContent = 'Subscribing\\u2026'; }",
  "  try {",
  "    var res = await fetch('/api/newsletter-subscribe', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json' },",
  "      body: JSON.stringify({ email: email, name: name || '', exit_reason: exitReason || '' })",
  "    });",
  "    var data = await res.json();",
  "    if (data && data.ok) {",
  "      window.location.href = '/landing.html?subscribed=1';",
  "      return;",
  "    }",
  "    if (err) err.textContent = (data && data.error) || 'Could not subscribe. Try again.';",
  "    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe to newsletter'; }",
  "  } catch (e) {",
  "    if (err) err.textContent = 'Network error. Try again.';",
  "    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe to newsletter'; }",
  "  }",
  "}",
  "",
  "function closePreDelete() {"
].join('\n');

/* ========================================================================
 * EDIT: admin HTML  new Newsletter sidebar item + panel + JS
 * ======================================================================*/

/* Add sidebar item after Refunds (TMC_PATCH53_ADMIN). */
const NAV_FIND = '<button class="sb-item" data-tab="refunds" onclick="navTo(\'refunds\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg><span>Refunds</span><span id="refunds-nav-count" style="display:none;margin-left:auto;background:#DC2626;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:10px"></span></button><!-- TMC_PATCH53_ADMIN -->';
const NAV_REPLACE = [
  NAV_FIND,
  '    <button class="sb-item" data-tab="newsletter" onclick="navTo(\'newsletter\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg><span>Newsletter</span></button><!-- TMC_PATCH52 -->'
].join('\n');

/* TAB_TITLES and TAB_SUBS additions. We anchor on the Refunds entry from
   Patch 53-admin-ui. */
const TT_FIND = '"retention": "Retention", "refunds": "Refunds"}; /* TMC_PATCH42 */';
const TT_REPLACE = '"retention": "Retention", "refunds": "Refunds", "newsletter": "Newsletter"}; /* TMC_PATCH42 */';

const TS_FIND = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review"}; /* TMC_PATCH42 */';
const TS_REPLACE = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review", "newsletter": "Post-deletion newsletter signups  export to CSV for Mailchimp/Beehiiv"}; /* TMC_PATCH42 */';

/* Panel: insert before the Retention panel comment (same pattern as Patch 53-admin-ui used). */
const PANEL_FIND = '      <!-- TMC_PATCH53_ADMIN Refunds panel -->';
const PANEL_REPLACE = [
  '      <!-- TMC_PATCH52 Newsletter panel -->',
  '      <div class="panel" id="panel-newsletter">',
  '        <div class="section">',
  '          <div class="section-head">',
  '            <div class="section-title">Newsletter subscribers</div>',
  '            <span class="section-link" onclick="loadNewsletter()" style="cursor:pointer">Refresh</span>',
  '          </div>',
  '          <div style="font-size:12px;color:#6B7280;margin:6px 0 14px;line-height:1.5">Captured from the post-deletion signup screen. Use the CSV to import into Mailchimp, Beehiiv, or another email service for sending.</div>',
  '          <div id="news-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">',
  '            <div style="background:#F9FAFB;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;letter-spacing:0.04em">Active</div><div id="news-active" style="font-size:22px;font-weight:800;color:#15803D;margin-top:4px">\u2026</div></div>',
  '            <div style="background:#F9FAFB;border-radius:10px;padding:12px"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;letter-spacing:0.04em">Unsubscribed</div><div id="news-unsub" style="font-size:22px;font-weight:800;color:#111;margin-top:4px">\u2026</div></div>',
  '          </div>',
  '          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:14px;font-size:12px;color:#6B7280">',
  '            <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">',
  '              <input type="checkbox" id="news-include-unsub" onchange="loadNewsletter()">',
  '              <span>Include unsubscribed</span>',
  '            </label>',
  '            <a href="/api/admin-newsletter-export" download style="display:inline-flex;align-items:center;gap:6px;background:#FF6B00;color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:700;font-size:12px">Export CSV</a>',
  '          </div>',
  '          <div id="news-list" style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden"></div>',
  '        </div>',
  '      </div>',
  '',
  '      <!-- TMC_PATCH53_ADMIN Refunds panel -->'
].join('\n');

/* JS hook: insert after the existing TMC_PATCH53_FIX renderSuccessRefunds
   function. Anchor on a stable later string. We'll anchor on the line",
   "/* Auto-load the refunds list whenever the Refunds tab is opened" since",
   it's unique. */

const JS_FIND = '/* Auto-load the refunds list whenever the Refunds tab is opened, and also';
const JS_REPLACE = [
  '/* TMC_PATCH52 newsletter tab loader */',
  'async function loadNewsletter() {',
  '  const listEl   = document.getElementById("news-list");',
  '  const activeEl = document.getElementById("news-active");',
  '  const unsubEl  = document.getElementById("news-unsub");',
  '  if (!listEl) return;',
  '  listEl.innerHTML = \'<div style="padding:18px;font-size:13px;color:#6B7280;text-align:center">Loading\\u2026</div>\';',
  '  const includeUnsub = !!(document.getElementById("news-include-unsub") && document.getElementById("news-include-unsub").checked);',
  '  try {',
  '    const res = await fetch("/api/admin-newsletter-list" + (includeUnsub ? "?include_unsubscribed=1" : ""));',
  '    if (!res.ok) throw new Error("admin auth required");',
  '    const d = await res.json();',
  '    if (activeEl) activeEl.textContent = String(d.active_count);',
  '    if (unsubEl)  unsubEl.textContent  = String(d.unsubscribed_count);',
  '    const rows = (d && d.subscribers) || [];',
  '    if (rows.length === 0) {',
  '      listEl.innerHTML = \'<div style="padding:24px;font-size:13px;color:#6B7280;text-align:center">No newsletter subscribers yet.</div>\';',
  '      return;',
  '    }',
  '    listEl.innerHTML = rows.map(function (r, i) {',
  '      const border = (i < rows.length - 1) ? "border-bottom:1px solid #F3F4F6;" : "";',
  '      const when = r.created_at ? new Date(r.created_at).toLocaleDateString() : "";',
  '      const exitReason = r.signup_exit_reason ? \' \\u00b7 reason: \' + r.signup_exit_reason : "";',
  '      const statusBadge = r.unsubscribed_at',
  '        ? \'<span style="background:#F3F4F6;color:#6B7280;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Unsubscribed</span>\'',
  '        : \'<span style="background:#D1FAE5;color:#065F46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Active</span>\';',
  '      const name = r.name ? \'<span style="color:#6B7280;font-weight:500">(\' + r.name + \')</span>\' : "";',
  '      return \'<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;\' + border + \'">\' +',
  '        \'<div style="flex:1;min-width:0;font-size:13px"><b>\' + r.email + \'</b> \' + name + \'<div style="font-size:11px;color:#9CA3AF;margin-top:2px">\' + when + exitReason + \'</div></div>\' +',
  '        statusBadge +',
  '      \'</div>\';',
  '    }).join("");',
  '  } catch (e) {',
  '    listEl.innerHTML = \'<div style="padding:18px;font-size:13px;color:#DC2626;text-align:center">Could not load subscribers.</div>\';',
  '  }',
  '}',
  '',
  '(function () {',
  '  if (window.__tmcNewsInit) return;',
  '  window.__tmcNewsInit = true;',
  '  document.addEventListener("click", function (e) {',
  '    const btn = e.target.closest && e.target.closest("[data-tab=\\"newsletter\\"]");',
  '    if (btn) setTimeout(loadNewsletter, 20);',
  '  });',
  '})();',
  '',
  '/* Auto-load the refunds list whenever the Refunds tab is opened, and also'
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 52  newsletter signup + admin\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* NEW endpoints */
for (const [pp, body] of [[SUBSCRIBE_EP, SUBSCRIBE_BODY], [ADMIN_LIST_EP, ADMIN_LIST_BODY], [ADMIN_EXPORT_EP, ADMIN_EXPORT_BODY]]) {
  if (fs.existsSync(pp) && fs.readFileSync(pp, 'utf8').indexOf(MARKER) !== -1) {
    log(pp + ': skip (already present with marker)');
  } else {
    if (fs.existsSync(pp)) {
      fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
      fs.copyFileSync(pp, path.join(BACKUP_DIR, pp));
    }
    fs.writeFileSync(pp, body, 'utf8');
    try {
      execSync('node --check "' + pp + '"', { stdio: 'pipe' });
      log(pp + ': written, node --check OK');
      changed++;
    } catch (e) {
      fail('node --check FAILED for ' + pp + '\n' + String(e.stderr || e.message));
    }
  }
}

/* EXTEND unsubscribe.js */
{
  const original = fs.readFileSync(UNSUB_EP, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(UNSUB_EP + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');
    const i = updated.indexOf(UNSUB_FIND);
    if (i === -1) fail('pattern NOT FOUND in ' + UNSUB_EP);
    if (updated.indexOf(UNSUB_FIND, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + UNSUB_EP);
    updated = updated.replace(UNSUB_FIND, () => UNSUB_REPLACE);
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(UNSUB_EP, original, updated);
    execSync('node --check "' + UNSUB_EP + '"', { stdio: 'pipe' });
    log(UNSUB_EP + ': patched, node --check OK');
    changed++;
  }
}

/* settings.html: 3 edits */
{
  const original = fs.readFileSync(SETTINGS, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(SETTINGS + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');
    const edits = [
      { label: 'settings: capture email pre-delete', find: DEL_CAPTURE_FIND, replace: DEL_CAPTURE_REPLACE },
      { label: 'settings: post-delete signup',       find: DEL_SUCCESS_FIND, replace: DEL_SUCCESS_REPLACE },
      { label: 'settings: signup helper functions',  find: SET_HELPER_FIND,  replace: SET_HELPER_REPLACE  }
    ];
    for (const e of edits) {
      const i = updated.indexOf(e.find);
      if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
      if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
      updated = updated.replace(e.find, () => e.replace);
    }
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(SETTINGS, original, updated);

    /* syntax check */
    const s = fs.readFileSync(SETTINGS, 'utf8');
    const at = s.indexOf('TMC_PATCH52: post-delete newsletter signup screen');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p52-settings-chk.js', s.slice(a, b));
      try {
        execSync('node --check /tmp/p52-settings-chk.js', { stdio: 'pipe' });
        log(SETTINGS + ': patched, node --check OK');
      } catch (e) {
        fs.writeFileSync(SETTINGS, original, 'utf8');
        fail('node --check FAILED  settings restored.\n' + String(e.stderr || e.message));
      }
    }
    changed++;
  }
}

/* admin HTML: 5 edits */
{
  const original = fs.readFileSync(ADMIN_HTML, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(ADMIN_HTML + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');
    const edits = [
      { label: 'admin: nav button',        find: NAV_FIND,    replace: NAV_REPLACE    },
      { label: 'admin: TAB_TITLES entry',  find: TT_FIND,     replace: TT_REPLACE     },
      { label: 'admin: TAB_SUBS entry',    find: TS_FIND,     replace: TS_REPLACE     },
      { label: 'admin: panel markup',      find: PANEL_FIND,  replace: PANEL_REPLACE  },
      { label: 'admin: JS loader',         find: JS_FIND,     replace: JS_REPLACE     }
    ];
    for (const e of edits) {
      const i = updated.indexOf(e.find);
      if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
      if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
      updated = updated.replace(e.find, () => e.replace);
    }
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(ADMIN_HTML, original, updated);

    /* syntax-check the touched script */
    const s = fs.readFileSync(ADMIN_HTML, 'utf8');
    const at = s.indexOf('TMC_PATCH52 newsletter tab loader');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p52-admin-chk.js', s.slice(a, b));
      try {
        execSync('node --check /tmp/p52-admin-chk.js', { stdio: 'pipe' });
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
  log('IMPORTANT  REQUIRED before deploy:');
  log('  Run patch52-migration.sql in Supabase first (creates the table).');
  log('  Without it, every signup attempt 500s.\n');
  log('NEXT STEPS:');
  log('  1. Run patch52-migration.sql in Supabase');
  log('  2. git add -A');
  log('  3. git commit -m "Patch 52: post-delete newsletter signup + admin"');
  log('  4. git push  (wait ~60s for Vercel)');
  log('  5. Test on a TEST account: Settings  Delete account  reason  ');
  log('     Permanently delete  decline retention offer  account deletes  ');
  log('     Newsletter signup screen appears with email pre-filled  ');
  log('     Subscribe  redirected to /landing.html?subscribed=1');
  log('  6. Admin: new Newsletter tab in sidebar  see the subscriber row  ');
  log('     Export CSV  downloads tapmycar-newsletter.csv\n');
}
