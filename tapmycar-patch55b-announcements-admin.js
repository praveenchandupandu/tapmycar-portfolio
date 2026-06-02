/* ============================================================================
 * TapMyCar  Patch 55b  admin UI for announcements
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch55b-announcements-admin.js
 *
 * Adds a new "Announcements" admin tab so you can:
 *   - Create an announcement with title, body, start_date, end_date, audience
 *   - List all announcements (active + disabled) with status and seen-count
 *   - Disable a row (soft, sets active=false  recoverable)
 *
 * Three new endpoints:
 *   - POST /api/admin-create-announcement
 *   - GET  /api/admin-list-announcements
 *   - POST /api/admin-disable-announcement
 *
 * One admin page modified: public/cmshaveaccesstouser2026-npmevy.html
 *   - New sidebar item after Newsletter
 *   - New panel with form (title, body, dates, audience) + list
 *   - JS to fetch/render/submit
 *
 * SAFE TO RE-RUN: each file skipped if already contains TMC_PATCH55B.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH55B';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch55b-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CREATE_EP  = path.join('api', 'admin-create-announcement.js');
const LIST_EP    = path.join('api', 'admin-list-announcements.js');
const DISABLE_EP = path.join('api', 'admin-disable-announcement.js');
const ADMIN_HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* ========================================================================
 * NEW: admin-create-announcement.js
 * ======================================================================*/

const CREATE_BODY = [
  "// TMC_PATCH55B admin: create an announcement.",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const { title, body, start_date, end_date, audience } = req.body || {};",
  "",
  "  if (!body || typeof body !== 'string' || !body.trim()) {",
  "    return res.status(400).json({ error: 'Body is required' });",
  "  }",
  "  if (!start_date || !end_date) {",
  "    return res.status(400).json({ error: 'start_date and end_date are required' });",
  "  }",
  "  const startMs = Date.parse(start_date);",
  "  const endMs   = Date.parse(end_date);",
  "  if (isNaN(startMs) || isNaN(endMs)) {",
  "    return res.status(400).json({ error: 'Invalid date format' });",
  "  }",
  "  if (endMs <= startMs) {",
  "    return res.status(400).json({ error: 'end_date must be after start_date' });",
  "  }",
  "  const aud = (audience === 'existing') ? 'existing' : 'all';",
  "",
  "  const { data, error } = await supabase.from('announcements').insert({",
  "    title: (typeof title === 'string') ? title.trim().slice(0, 200) : null,",
  "    body:  body.trim().slice(0, 2000),",
  "    active: true,",
  "    start_date: new Date(startMs).toISOString(),",
  "    end_date:   new Date(endMs).toISOString(),",
  "    audience: aud",
  "  }).select('id').single();",
  "",
  "  if (error) {",
  "    console.error('admin-create-announcement error:', error.message);",
  "    return res.status(500).json({ error: error.message });",
  "  }",
  "  return res.json({ ok: true, id: data && data.id });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * NEW: admin-list-announcements.js
 * ======================================================================*/

const LIST_BODY = [
  "// TMC_PATCH55B admin: list all announcements + dismiss counts.",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const { data: rows, error } = await supabase",
  "    .from('announcements')",
  "    .select('id, title, body, active, start_date, end_date, audience, created_at')",
  "    .order('created_at', { ascending: false })",
  "    .limit(50);",
  "  if (error) return res.status(500).json({ error: error.message });",
  "",
  "  if (!rows || rows.length === 0) return res.json({ ok: true, announcements: [] });",
  "",
  "  /* Pull dismiss counts per announcement. */",
  "  const ids = rows.map(r => r.id);",
  "  const { data: seenRows } = await supabase",
  "    .from('announcement_seen')",
  "    .select('announcement_id')",
  "    .in('announcement_id', ids);",
  "  const seenCount = {};",
  "  (seenRows || []).forEach(s => {",
  "    seenCount[s.announcement_id] = (seenCount[s.announcement_id] || 0) + 1;",
  "  });",
  "",
  "  const nowMs = Date.now();",
  "  const out = rows.map(r => {",
  "    const startMs = r.start_date ? Date.parse(r.start_date) : 0;",
  "    const endMs   = r.end_date   ? Date.parse(r.end_date)   : 0;",
  "    let status;",
  "    if (!r.active)            status = 'disabled';",
  "    else if (nowMs < startMs) status = 'scheduled';",
  "    else if (nowMs > endMs)   status = 'expired';",
  "    else                      status = 'live';",
  "    return {",
  "      id:           r.id,",
  "      title:        r.title,",
  "      body:         r.body,",
  "      active:       r.active,",
  "      start_date:   r.start_date,",
  "      end_date:     r.end_date,",
  "      audience:     r.audience || 'all',",
  "      created_at:   r.created_at,",
  "      status:       status,",
  "      dismiss_count: seenCount[r.id] || 0",
  "    };",
  "  });",
  "  return res.json({ ok: true, announcements: out });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * NEW: admin-disable-announcement.js
 * ======================================================================*/

const DISABLE_BODY = [
  "// TMC_PATCH55B admin: soft-disable an announcement (sets active=false).",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const { id, active } = req.body || {};",
  "  if (typeof id === 'undefined' || id === null) {",
  "    return res.status(400).json({ error: 'id required' });",
  "  }",
  "  const newActive = (active === true);",
  "",
  "  const { error } = await supabase.from('announcements')",
  "    .update({ active: newActive })",
  "    .eq('id', id);",
  "  if (error) return res.status(500).json({ error: error.message });",
  "  return res.json({ ok: true, id: id, active: newActive });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * Admin HTML edits
 * ======================================================================*/

/* Sidebar nav item after Newsletter (TMC_PATCH52). */
const NAV_FIND = '<button class="sb-item" data-tab="newsletter" onclick="navTo(\'newsletter\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg><span>Newsletter</span></button><!-- TMC_PATCH52 -->';
const NAV_REPLACE = [
  NAV_FIND,
  '    <button class="sb-item" data-tab="announcements" onclick="navTo(\'announcements\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-8-8-2z"/><path d="M11 13l5-2"/></svg><span>Announcements</span></button><!-- TMC_PATCH55B -->'
].join('\n');

/* TAB_TITLES + TAB_SUBS entries (Newsletter was last in Patch 52). */
const TT_FIND = '"retention": "Retention", "refunds": "Refunds", "newsletter": "Newsletter"}; /* TMC_PATCH42 */';
const TT_REPLACE = '"retention": "Retention", "refunds": "Refunds", "newsletter": "Newsletter", "announcements": "Announcements"}; /* TMC_PATCH42 */';

const TS_FIND = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review", "newsletter": "Post-deletion newsletter signups  export to CSV for Mailchimp/Beehiiv"}; /* TMC_PATCH42 */';
const TS_REPLACE = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review", "newsletter": "Post-deletion newsletter signups  export to CSV for Mailchimp/Beehiiv", "announcements": "Create and manage in-app popup announcements"}; /* TMC_PATCH42 */';

/* Panel: insert before Newsletter panel comment. */
const PANEL_FIND = '      <!-- TMC_PATCH52 Newsletter panel -->';
const PANEL_REPLACE = [
  '      <!-- TMC_PATCH55B Announcements panel -->',
  '      <div class="panel" id="panel-announcements">',
  '        <div class="section">',
  '          <div class="section-head">',
  '            <div class="section-title">Create announcement</div>',
  '            <span class="section-link" onclick="loadAnnouncements()" style="cursor:pointer">Refresh list</span>',
  '          </div>',
  '          <div style="font-size:12px;color:#6B7280;margin:6px 0 14px;line-height:1.5">Popup that appears in-app for users during the active date window. Dismissals are tracked  each user sees an announcement at most once.</div>',
  '          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:24px">',
  '            <div style="display:grid;grid-template-columns:1fr;gap:10px">',
  '              <div>',
  '                <label style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em">Title (optional)</label>',
  '                <input type="text" id="ann-title" maxlength="200" placeholder="e.g. New feature available" style="margin-top:4px;width:100%;border:1px solid #D1D5DB;border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;box-sizing:border-box;color:#111;background:#fff;-webkit-text-fill-color:#111">',
  '              </div>',
  '              <div>',
  '                <label style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em">Body *</label>',
  '                <textarea id="ann-body" maxlength="2000" rows="3" placeholder="What do you want users to know?" style="margin-top:4px;width:100%;border:1px solid #D1D5DB;border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;box-sizing:border-box;resize:vertical;color:#111;background:#fff;-webkit-text-fill-color:#111"></textarea>',
  '              </div>',
  '              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">',
  '                <div>',
  '                  <label style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em">Start</label>',
  '                  <input type="datetime-local" id="ann-start" style="margin-top:4px;width:100%;border:1px solid #D1D5DB;border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;box-sizing:border-box;color:#111;background:#fff;-webkit-text-fill-color:#111">',
  '                </div>',
  '                <div>',
  '                  <label style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em">End</label>',
  '                  <input type="datetime-local" id="ann-end" style="margin-top:4px;width:100%;border:1px solid #D1D5DB;border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;box-sizing:border-box;color:#111;background:#fff;-webkit-text-fill-color:#111">',
  '                </div>',
  '              </div>',
  '              <div>',
  '                <label style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em">Audience</label>',
  '                <select id="ann-audience" style="margin-top:4px;width:100%;border:1px solid #D1D5DB;border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;box-sizing:border-box;color:#111;background:#fff;-webkit-text-fill-color:#111">',
  '                  <option value="all">All users</option>',
  '                  <option value="existing">Existing users only (signed up before this announcement)</option>',
  '                </select>',
  '              </div>',
  '              <div id="ann-create-err" style="font-size:12px;color:#DC2626;min-height:16px"></div>',
  '              <button type="button" id="ann-create-btn" onclick="createAnnouncement()" style="width:100%;padding:12px;background:#FF6B00;color:#fff;border:0;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer">Create announcement</button>',
  '            </div>',
  '          </div>',
  '',
  '          <div style="font-weight:800;font-size:14px;margin-bottom:10px">All announcements</div>',
  '          <div id="ann-list" style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden"></div>',
  '        </div>',
  '      </div>',
  '',
  '      <!-- TMC_PATCH52 Newsletter panel -->'
].join('\n');

/* JS loader + create + disable. Anchor: insert before the newsletter loader. */
const JS_FIND = '/* TMC_PATCH52 newsletter tab loader */';
const JS_REPLACE = [
  '/* TMC_PATCH55B announcements tab logic */',
  'function annStatusBadge(status) {',
  '  const map = {',
  '    live:      { bg: "#D1FAE5", fg: "#065F46", text: "Live" },',
  '    scheduled: { bg: "#DBEAFE", fg: "#1E40AF", text: "Scheduled" },',
  '    expired:   { bg: "#F3F4F6", fg: "#6B7280", text: "Expired" },',
  '    disabled:  { bg: "#FEE2E2", fg: "#7F1D1D", text: "Disabled" }',
  '  };',
  '  const c = map[status] || map.disabled;',
  '  return \'<span style="background:\' + c.bg + \';color:\' + c.fg + \';font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">\' + c.text + \'</span>\';',
  '}',
  'function annEscape(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }',
  '',
  'function setAnnCreateDefaults() {',
  '  const startEl = document.getElementById("ann-start");',
  '  const endEl   = document.getElementById("ann-end");',
  '  if (!startEl || !endEl) return;',
  '  /* If already set (e.g. user typed something), don\'t overwrite. */',
  '  if (startEl.value) return;',
  '  const now    = new Date();',
  '  const later  = new Date(now.getTime() + 14 * 86400000);',
  '  function toLocal(d) {',
  '    const pad = function (n) { return String(n).padStart(2, "0"); };',
  '    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) +',
  '           "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());',
  '  }',
  '  startEl.value = toLocal(now);',
  '  endEl.value   = toLocal(later);',
  '}',
  '',
  'async function loadAnnouncements() {',
  '  const listEl = document.getElementById("ann-list");',
  '  if (!listEl) return;',
  '  listEl.innerHTML = \'<div style="padding:18px;font-size:13px;color:#6B7280;text-align:center">Loading\\u2026</div>\';',
  '  try {',
  '    const res = await fetch("/api/admin-list-announcements");',
  '    if (!res.ok) throw new Error("admin auth required");',
  '    const d = await res.json();',
  '    const rows = (d && d.announcements) || [];',
  '    if (rows.length === 0) {',
  '      listEl.innerHTML = \'<div style="padding:24px;font-size:13px;color:#6B7280;text-align:center">No announcements yet.</div>\';',
  '      return;',
  '    }',
  '    listEl.innerHTML = rows.map(function (r, i) {',
  '      const border = (i < rows.length - 1) ? "border-bottom:1px solid #F3F4F6;" : "";',
  '      const titleHtml = r.title ? (\'<b>\' + annEscape(r.title) + \'</b><br>\') : "";',
  '      const bodyHtml = annEscape((r.body || "").slice(0, 200));',
  '      const start = r.start_date ? new Date(r.start_date).toLocaleDateString() : "?";',
  '      const end   = r.end_date   ? new Date(r.end_date).toLocaleDateString()   : "?";',
  '      const audLabel = (r.audience === "existing") ? "Existing users only" : "All users";',
  '      const actionBtn = r.active',
  '        ? \'<button type="button" onclick="toggleAnnouncement(\\\'\' + r.id + \'\\\',false)" style="background:#FEE2E2;color:#7F1D1D;border:0;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">Disable</button>\'',
  '        : \'<button type="button" onclick="toggleAnnouncement(\\\'\' + r.id + \'\\\',true)" style="background:#D1FAE5;color:#065F46;border:0;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">Re-enable</button>\';',
  '      return \'<div style="padding:14px;\' + border + \'">\' +',
  '        \'<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:6px">\' +',
  '          \'<div style="flex:1;min-width:0;font-size:13px;color:#111;line-height:1.5">\' + titleHtml + bodyHtml + \'</div>\' +',
  '          annStatusBadge(r.status) +',
  '        \'</div>\' +',
  '        \'<div style="font-size:11px;color:#6B7280;margin-bottom:10px">\' + start + \' \\u2192 \' + end + \' \\u00b7 \' + audLabel + \' \\u00b7 \' + r.dismiss_count + \' dismissed\' + \'</div>\' +',
  '        actionBtn +',
  '      \'</div>\';',
  '    }).join("");',
  '  } catch (e) {',
  '    listEl.innerHTML = \'<div style="padding:18px;font-size:13px;color:#DC2626;text-align:center">Could not load announcements.</div>\';',
  '  }',
  '}',
  '',
  'async function createAnnouncement() {',
  '  const titleEl = document.getElementById("ann-title");',
  '  const bodyEl  = document.getElementById("ann-body");',
  '  const startEl = document.getElementById("ann-start");',
  '  const endEl   = document.getElementById("ann-end");',
  '  const audEl   = document.getElementById("ann-audience");',
  '  const errEl   = document.getElementById("ann-create-err");',
  '  const btnEl   = document.getElementById("ann-create-btn");',
  '  if (errEl) errEl.textContent = "";',
  '',
  '  const body = (bodyEl && bodyEl.value || "").trim();',
  '  if (!body) { if (errEl) errEl.textContent = "Body is required"; return; }',
  '  const startVal = startEl && startEl.value;',
  '  const endVal   = endEl   && endEl.value;',
  '  if (!startVal || !endVal) { if (errEl) errEl.textContent = "Both start and end dates are required"; return; }',
  '  /* datetime-local values are local timezone strings without offset.',
  '     new Date() parses them as local time, which is what we want. */',
  '  const startIso = new Date(startVal).toISOString();',
  '  const endIso   = new Date(endVal).toISOString();',
  '  if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {',
  '    if (errEl) errEl.textContent = "End must be after start"; return;',
  '  }',
  '',
  '  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Creating\\u2026"; }',
  '  try {',
  '    const res = await fetch("/api/admin-create-announcement", {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({',
  '        title:      (titleEl && titleEl.value || "").trim(),',
  '        body:       body,',
  '        start_date: startIso,',
  '        end_date:   endIso,',
  '        audience:   (audEl && audEl.value) || "all"',
  '      })',
  '    });',
  '    const data = await res.json();',
  '    if (data && data.ok) {',
  '      if (titleEl) titleEl.value = "";',
  '      if (bodyEl)  bodyEl.value  = "";',
  '      if (audEl)   audEl.value   = "all";',
  '      /* Re-prime defaults for the next create. */',
  '      if (startEl) startEl.value = "";',
  '      if (endEl)   endEl.value   = "";',
  '      setAnnCreateDefaults();',
  '      loadAnnouncements();',
  '    } else {',
  '      if (errEl) errEl.textContent = (data && data.error) || "Could not create";',
  '    }',
  '  } catch (e) {',
  '    if (errEl) errEl.textContent = "Network error";',
  '  }',
  '  if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Create announcement"; }',
  '}',
  '',
  'async function toggleAnnouncement(id, active) {',
  '  const verb = active ? "re-enable" : "disable";',
  '  if (!confirm(verb.charAt(0).toUpperCase() + verb.slice(1) + " this announcement?")) return;',
  '  try {',
  '    const res = await fetch("/api/admin-disable-announcement", {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({ id: id, active: !!active })',
  '    });',
  '    if (!res.ok) throw new Error();',
  '    loadAnnouncements();',
  '  } catch (e) {',
  '    alert("Could not " + verb + ". Try again.");',
  '  }',
  '}',
  '',
  '(function () {',
  '  if (window.__tmcAnnInit) return;',
  '  window.__tmcAnnInit = true;',
  '  document.addEventListener("click", function (e) {',
  '    const btn = e.target.closest && e.target.closest("[data-tab=\\"announcements\\"]");',
  '    if (btn) setTimeout(function () { setAnnCreateDefaults(); loadAnnouncements(); }, 20);',
  '  });',
  '})();',
  '',
  '/* TMC_PATCH52 newsletter tab loader */'
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 55b  announcements admin UI\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* New endpoints */
for (const [pp, body] of [[CREATE_EP, CREATE_BODY], [LIST_EP, LIST_BODY], [DISABLE_EP, DISABLE_BODY]]) {
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

/* Admin HTML */
{
  const original = fs.readFileSync(ADMIN_HTML, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(ADMIN_HTML + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');

    const edits = [
      { label: 'nav button',       find: NAV_FIND,    replace: NAV_REPLACE    },
      { label: 'TAB_TITLES',       find: TT_FIND,     replace: TT_REPLACE     },
      { label: 'TAB_SUBS',         find: TS_FIND,     replace: TS_REPLACE     },
      { label: 'panel markup',     find: PANEL_FIND,  replace: PANEL_REPLACE  },
      { label: 'JS loader',        find: JS_FIND,     replace: JS_REPLACE     }
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
    const at = s.indexOf('TMC_PATCH55B announcements tab logic');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p55b-admin-chk.js', s.slice(a, b));
      try {
        execSync('node --check /tmp/p55b-admin-chk.js', { stdio: 'pipe' });
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
  log('  2. git commit -m "Patch 55b: announcements admin UI"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Open admin  new Announcements sidebar item.');
  log('     - Title, Body, Start, End, Audience  Create');
  log('     - Status badges: Live / Scheduled / Expired / Disabled');
  log('     - Disable / Re-enable buttons');
  log('     - Defaults: start=now, end=now+14d');
  log('     - Create one with audience=All  hard-refresh dashboard.html  popup');
  log('       appears. Dismiss  reload  popup gone (dismiss tracking confirmed).\n');
}
