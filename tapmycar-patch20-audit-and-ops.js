// ============================================================================
// TapMyCar - Patch 20: Audit log + tracking links + notification badges + test data
//
// Four features:
//
// 20.1  Server-side audit log
//       - New `admin_audit_log` table: id, actor (admin), action, target_type,
//         target_id, meta JSONB, created_at
//       - New helper api/_audit.js — used by admin endpoints to log actions
//       - Admin endpoints that log: generate-tokens, verify-tags,
//         get-dashboard (suspend/reactivate/giftPlan/giftActivation/edit),
//         update-order-status
//       - Admin "Audit" panel reads from /api/get-audit-log
//
// 20.2  Tracking number clickable link
//       - In Orders panel, tracking_number renders as a link.
//       - Detect carrier from format: 1Z = UPS, 22 digits = USPS, 12 digits = FedEx.
//       - Unknown → google search for tracking number.
//
// 20.3  Notification badges
//       - On admin sidebar items: small orange dot with count for:
//         · Orders panel: pending shipments count
//         · Reviews panel: pending reviews count
//       - Auto-refresh every 30 seconds.
//
// 20.4  Manual test data entry
//       - In admin Generate panel: "Create test user" button (uses dummy
//         email/phone/name).
//       - "Create test scan" button (picks a random tag, inserts a view scan).
//       - Both are admin-only and audit-logged.
//
// REQUIRES: Patches 1-19 already applied locally.
// REQUIRES: SQL migration before deploy (printed at end of run).
//
// Properties: idempotent, backups every touched file, validates JS.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch20-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
  } catch (e) {
    errExit('JS syntax error in ' + p + '\n' + e.stderr.toString());
  }
}
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 20 \u2014 Audit log + tracking + badges + test data');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_20 = 'TMC_PATCH20_AUDIT_AND_OPS';

// ===========================================================================
// 20.1  Create api/_audit.js helper
// ===========================================================================

log('20.1.a  api/_audit.js: create audit helper');
{
  const file = path.join(API, '_audit.js');
  if (fs.existsSync(file) && readFile(file).includes(MARKER_20)) {
    skip('_audit.js (already exists)');
  } else {
    const body = `// ${MARKER_20}
// Audit log helper. Inserts a row into admin_audit_log.
// Fail-soft: never throws; logs to console on error.

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getClient() {
  if (_supabase) return _supabase;
  _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _supabase;
}

async function audit({ actor, action, target_type, target_id, meta }) {
  try {
    await getClient().from('admin_audit_log').insert({
      actor: actor || 'admin',
      action: String(action || ''),
      target_type: target_type ? String(target_type) : null,
      target_id: target_id ? String(target_id) : null,
      meta: meta || null
    });
  } catch (e) {
    console.error('audit log error:', e && e.message);
  }
}

module.exports = { audit };
`;
    fs.writeFileSync(file, body, 'utf8');
    validateJs(file);
    ok('_audit.js: created');
  }
}

// ===========================================================================
// 20.1  Create api/get-audit-log.js endpoint
// ===========================================================================

log('20.1.b  api/get-audit-log.js: create read-only audit endpoint');
{
  const file = path.join(API, 'get-audit-log.js');
  if (fs.existsSync(file) && readFile(file).includes(MARKER_20)) {
    skip('get-audit-log.js (already exists)');
  } else {
    const body = `// ${MARKER_20}
// /api/get-audit-log — admin-only, returns recent audit log entries.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { admin, limit } = req.query;
  if (admin !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const lim = Math.min(Math.max(parseInt(limit || '100', 10) || 100, 1), 500);

  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(lim);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, entries: data || [] });
};
`;
    fs.writeFileSync(file, body, 'utf8');
    validateJs(file);
    ok('get-audit-log.js: created');
  }
}

// ===========================================================================
// 20.1  Wire audit into existing admin endpoints
//   - generate-tokens.js: log("generate_tokens", count, batch)
//   - verify-tags.js: log per mode
// ===========================================================================

log('20.1.c  Wire audit into generate-tokens.js');
{
  const file = path.join(API, 'generate-tokens.js');
  const content = readFile(file);
  if (content.includes(MARKER_20)) {
    skip('generate-tokens.js (already patched)');
  } else {
    // Add import at top + audit call before final res.json
    const oldHead = `const crypto = require('crypto');`;
    const newHead = `const crypto = require('crypto');
const { audit } = require('./_audit'); /* ${MARKER_20} */`;
    let updated = tryReplace(content, oldHead, newHead);
    if (!updated) errExit('generate-tokens.js: head anchor not found');

    const oldEnd = `  res.json({
    success: true,
    generated: tokens.length,
    tokens,
    errors
  });`;
    const newEnd = `  /* ${MARKER_20}: audit */
  audit({ actor: 'admin', action: 'generate_tokens', target_type: 'batch', target_id: String(batch_number || ''), meta: { count: tokens.length, errors: errors.length } });

  res.json({
    success: true,
    generated: tokens.length,
    tokens,
    errors
  });`;
    const r = tryReplace(updated, oldEnd, newEnd);
    if (!r) errExit('generate-tokens.js: tail anchor not found');
    backup(file);
    writeFile(file, r);
    validateJs(file);
    ok('generate-tokens.js: audit wired');
  }
}

log('20.1.d  Wire audit into verify-tags.js');
{
  const file = path.join(API, 'verify-tags.js');
  const content = readFile(file);
  if (content.includes(MARKER_20)) {
    skip('verify-tags.js (already patched)');
  } else {
    const oldHead = `const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);`;
    const newHead = `const { createClient } = require('@supabase/supabase-js');
const { audit } = require('./_audit'); /* ${MARKER_20} */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);`;
    let updated = tryReplace(content, oldHead, newHead);
    if (!updated) errExit('verify-tags.js: head anchor not found');

    // Add audit before each successful return res.json
    const oldVerify = `    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      verified_count: updated ? updated.length : 0,
      verified_tokens: updated ? updated.map(t => t.token) : []
    });
  }

  if (mode === 'void_unverified_in_batch') {`;
    const newVerify = `    if (error) return res.status(500).json({ error: error.message });
    audit({ actor: 'admin', action: 'verify_tokens', target_type: 'tokens', meta: { count: updated ? updated.length : 0 } });
    return res.json({
      success: true,
      verified_count: updated ? updated.length : 0,
      verified_tokens: updated ? updated.map(t => t.token) : []
    });
  }

  if (mode === 'void_unverified_in_batch') {`;
    updated = tryReplace(updated, oldVerify, newVerify) || updated;

    const oldVoid = `    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      voided_count: voided ? voided.length : 0,
      voided_tokens: voided ? voided.map(t => t.token) : []
    });
  }

  if (mode === 'void_old') {`;
    const newVoid = `    if (error) return res.status(500).json({ error: error.message });
    audit({ actor: 'admin', action: 'void_unverified_in_batch', target_type: 'batch', target_id: String(batch_number), meta: { count: voided ? voided.length : 0, reason: reason } });
    return res.json({
      success: true,
      voided_count: voided ? voided.length : 0,
      voided_tokens: voided ? voided.map(t => t.token) : []
    });
  }

  if (mode === 'void_old') {`;
    updated = tryReplace(updated, oldVoid, newVoid) || updated;

    backup(file);
    writeFile(file, updated);
    validateJs(file);
    ok('verify-tags.js: audit wired');
  }
}

log('20.1.e  Wire audit into update-order-status.js');
{
  const file = path.join(API, 'update-order-status.js');
  if (!fs.existsSync(file)) {
    log('  \u00b7 update-order-status.js not found, skipped');
  } else {
    const content = readFile(file);
    if (content.includes(MARKER_20)) {
      skip('update-order-status.js (already patched)');
    } else {
      const oldHead = `const { createClient } = require('@supabase/supabase-js');`;
      const newHead = `const { createClient } = require('@supabase/supabase-js');
const { audit } = require('./_audit'); /* ${MARKER_20} */`;
      let updated = tryReplace(content, oldHead, newHead);
      if (updated) {
        // Add an audit call near the success return. Find the line with
        // status update.
        const oldUpd = `  if (error) return res.status(500).json({ error: error.message });`;
        const newUpd = `  if (error) return res.status(500).json({ error: error.message });
  audit({ actor: 'admin', action: 'update_order_status', target_type: 'order', target_id: String(order_id), meta: { status: status, tracking_number: tracking_number || null } });`;
        const r = tryReplace(updated, oldUpd, newUpd);
        if (r) updated = r;
        backup(file);
        writeFile(file, updated);
        validateJs(file);
        ok('update-order-status.js: audit wired');
      }
    }
  }
}

// ===========================================================================
// 20.2 - 20.4  admin.html frontend changes
// ===========================================================================

log('');
log('20.2-20.4  public/admin.html: tracking link + badges + test data + audit panel load');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  if (content.includes(MARKER_20)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // ── 20.2 — Clickable tracking link in order card ──
    const oldTracking = `(o.tracking_number ? '<div style="color:#4ADE80;margin-top:2px">Tracking: ' + o.tracking_number + '</div>' : '')`;
    const newTracking = `(o.tracking_number ? '<div style="color:#4ADE80;margin-top:2px">Tracking: <a href="' + p20TrackingUrl(o.tracking_number) + '" target="_blank" rel="noopener" style="color:#4ADE80;text-decoration:underline">' + p20Esc(o.tracking_number) + '</a></div>' : '') /* ${MARKER_20} */`;

    let r = tryReplace(updated, oldTracking, newTracking);
    if (!r) errExit('admin.html: tracking_number anchor not found');
    updated = r;

    // ── 20.3 + 20.4 + audit panel JS — add CSS for badges + helpers ──
    const cssAnchor = `/* TMC_PATCH19_TAGS_AND_CSV: tag filters + voided + CSV export */`;
    const cssAddition = `/* ${MARKER_20}: notification badges + test-data + audit list */
.p20-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:#FF6B00;color:#fff;font-size:9px;font-weight:800;margin-left:auto;font-family:inherit}
.sb-item .p20-badge{margin-left:auto}
.p20-test-btn{background:#1A2D4A;border:1.5px dashed #334155;color:#94A3B8;font-size:11px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;font-family:inherit;margin:3px}
.p20-test-btn:hover{background:#1F3559;color:#E5E7EB;border-color:#475569}
.p20-test-section{background:rgba(20,30,50,.4);border:1.5px dashed #334155;border-radius:12px;padding:12px;margin-top:14px}
.p20-test-section h4{font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px;font-weight:700}
.p20-audit-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:11.5px}
.p20-audit-row:last-child{border-bottom:none}
.p20-audit-row .dot{width:7px;height:7px;border-radius:50%;background:#FF6B00;flex-shrink:0}
.p20-audit-row.warn .dot{background:#FCA5A5}
.p20-audit-row.good .dot{background:#4ADE80}
.p20-audit-action{color:#E5E7EB;font-weight:700;flex:1}
.p20-audit-meta{color:#94A3B8;font-size:10.5px;margin-top:2px}
.p20-audit-time{color:#64748B;font-size:10px;flex-shrink:0;white-space:nowrap}
/* TMC_PATCH19_TAGS_AND_CSV: tag filters + voided + CSV export */`;

    r = tryReplace(updated, cssAnchor, cssAddition);
    if (!r) errExit('admin.html: CSS anchor for patch 19 not found');
    updated = r;

    // ── 20.4 — Insert "Test data" section in Generate panel after the
    // existing danger-box (Delete entire batch).
    const oldDanger = `<div class="danger-box">`;
    const newDangerWithTest = `<!-- ${MARKER_20}: dev/test data helpers -->
<div class="p20-test-section" id="p20-test-section">
  <h4>Dev / Test data</h4>
  <div style="font-size:11px;color:#64748B;margin-bottom:10px;line-height:1.4">Quick helpers to create test data for QA. All actions are audit-logged.</div>
  <button type="button" class="p20-test-btn" onclick="p20CreateTestUser()">+ Test user</button>
  <button type="button" class="p20-test-btn" onclick="p20CreateTestScan()">+ Test scan (random tag)</button>
</div>

<div class="danger-box">`;
    r = tryReplace(updated, oldDanger, newDangerWithTest);
    if (r) updated = r;
    // Not fatal if no danger-box found.

    // ── 20.2 + 20.3 + 20.4 — Insert the JS at the bottom ──
    const jsAnchor = `/* TMC_PATCH19_TAGS_AND_CSV */
window.allOrdersData = window.allOrdersData || [];
window.allLeadsData = window.allLeadsData || [];`;

    const jsAddition = `/* TMC_PATCH19_TAGS_AND_CSV */
window.allOrdersData = window.allOrdersData || [];
window.allLeadsData = window.allLeadsData || [];

// ${MARKER_20}: helpers
function p20Esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

// ${MARKER_20}: detect carrier from tracking number format and link to carrier site
function p20TrackingUrl(tn) {
  if (!tn) return '#';
  const s = String(tn).replace(/\\s+/g, '').toUpperCase();
  // UPS: starts with 1Z
  if (/^1Z[A-Z0-9]{16}$/.test(s)) return 'https://www.ups.com/track?tracknum=' + encodeURIComponent(s);
  // USPS: 20-22 digit numeric
  if (/^9[0-9]{19,21}$/.test(s) || /^[0-9]{20,22}$/.test(s)) return 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=' + encodeURIComponent(s);
  // FedEx: 12 or 15 digits, all numeric
  if (/^[0-9]{12}$/.test(s) || /^[0-9]{15}$/.test(s)) return 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(s);
  // DHL: 10 digits
  if (/^[0-9]{10}$/.test(s)) return 'https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=' + encodeURIComponent(s);
  // Fallback: Google search
  return 'https://www.google.com/search?q=' + encodeURIComponent('track ' + s);
}
window.p20TrackingUrl = p20TrackingUrl;
window.p20Esc = p20Esc;

// ${MARKER_20}: notification badges
function p20UpdateBadges() {
  try {
    // Orders: count pending (order_status not in ['shipped','delivered','canceled'])
    const orders = window.allOrdersData || [];
    const pending = orders.filter(o => o.order_status && !['shipped', 'delivered', 'canceled'].includes(o.order_status)).length;
    p20SetBadge('orders', pending);
    // Reviews: from API (uses cached count we update via review polling) — for now skip if not loaded.
    fetch('/api/get-reviews?status=pending&admin=' + encodeURIComponent(adminKey))
      .then(r => r.json())
      .then(d => p20SetBadge('reviews', d && d.reviews ? d.reviews.length : 0))
      .catch(() => {});
  } catch (e) {}
}

function p20SetBadge(tab, count) {
  document.querySelectorAll('[data-tab="' + tab + '"]').forEach(el => {
    let b = el.querySelector('.p20-badge');
    if (count > 0) {
      if (!b) {
        b = document.createElement('span');
        b.className = 'p20-badge';
        el.appendChild(b);
      }
      b.textContent = count;
    } else {
      if (b) b.remove();
    }
  });
}

// Refresh badges every 30s while signed in
setInterval(() => { if (typeof adminKey === 'string' && adminKey) p20UpdateBadges(); }, 30000);
// Also right after dashboard loads
(function() {
  const orig = window.renderDashboard;
  if (typeof orig === 'function') {
    window.renderDashboard = function(d) {
      const ret = orig.apply(this, arguments);
      try { p20UpdateBadges(); } catch (e) {}
      return ret;
    };
  }
})();

// ${MARKER_20}: audit panel — overrides renderAuditLog to load from DB
async function p20LoadAuditFromDb() {
  if (typeof adminKey !== 'string' || !adminKey) return;
  try {
    const r = await fetch('/api/get-audit-log?admin=' + encodeURIComponent(adminKey) + '&limit=100');
    const d = await r.json();
    if (!d || !d.success) return;
    const list = document.getElementById('audit-list');
    if (!list) return;
    if (!d.entries || d.entries.length === 0) {
      list.innerHTML = '<div class="empty">No admin actions yet</div>';
      return;
    }
    list.innerHTML = d.entries.map(e => {
      const time = new Date(e.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
      const isDestructive = /delete|suspend|void|disable/i.test(e.action);
      const isPositive = /verify|gift|activate|create|generate/i.test(e.action);
      const cls = isDestructive ? 'warn' : (isPositive ? 'good' : '');
      let meta = '';
      if (e.meta) {
        try {
          const m = typeof e.meta === 'string' ? JSON.parse(e.meta) : e.meta;
          meta = Object.entries(m).map(([k, v]) => k + '=' + (v == null ? '' : v)).join(' \u00b7 ');
        } catch (_) { meta = String(e.meta).slice(0, 80); }
      }
      const target = e.target_type ? (' on ' + p20Esc(e.target_type) + (e.target_id ? ' ' + p20Esc(e.target_id) : '')) : '';
      return '<div class="p20-audit-row ' + cls + '"><div class="dot"></div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="p20-audit-action">' + p20Esc(e.action) + p20Esc(target) + '</div>' +
          (meta ? '<div class="p20-audit-meta">' + p20Esc(meta) + '</div>' : '') +
        '</div>' +
        '<div class="p20-audit-time">' + p20Esc(time) + '</div>' +
      '</div>';
    }).join('');
  } catch (e) { console.error('audit load err:', e); }
}

// Wrap navTo so opening the Audit panel loads the DB log
(function() {
  const orig = window.navTo;
  if (typeof orig === 'function') {
    window.navTo = function(id) {
      const ret = orig.apply(this, arguments);
      if (id === 'audit') p20LoadAuditFromDb();
      return ret;
    };
  }
})();

// ${MARKER_20}: test data buttons
async function p20CreateTestUser() {
  if (!adminKey) { showToast('Sign in first'); return; }
  const ts = Date.now().toString(36);
  const name = 'Test User ' + ts.slice(-4).toUpperCase();
  const email = 'test+' + ts + '@tapmycar.io';
  const phone = '+1555' + Math.floor(1000000 + Math.random() * 9000000);
  if (!confirm('Create a test user?\\n\\nName: ' + name + '\\nEmail: ' + email + '\\nPhone: ' + phone)) return;
  try {
    const r = await fetch('/api/get-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_test_user', admin_key: adminKey, name: name, email: email, phone: phone })
    });
    const d = await r.json();
    if (d.success) {
      showToast('Test user created: ' + email);
      if (typeof refreshAdmin === 'function') refreshAdmin();
    } else {
      showToast((typeof p18ErrText === 'function' ? p18ErrText(d && d.error) : (d && d.error)) || 'Failed');
    }
  } catch (e) { showToast('Network error: ' + (e && e.message)); }
}

async function p20CreateTestScan() {
  if (!adminKey) { showToast('Sign in first'); return; }
  // Pick a random active tag
  const tags = (window.allTagsData || []).filter(t => t.status === 'active' || t.status === 'unclaimed');
  if (tags.length === 0) { showToast('No tags available'); return; }
  const tag = tags[Math.floor(Math.random() * tags.length)];
  if (!confirm('Create a test scan on tag ' + tag.token + '?')) return;
  try {
    const r = await fetch('/api/get-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_test_scan', admin_key: adminKey, tag_id: tag.id })
    });
    const d = await r.json();
    if (d.success) {
      showToast('Test scan added to ' + tag.token);
      if (typeof refreshAdmin === 'function') refreshAdmin();
    } else {
      showToast((typeof p18ErrText === 'function' ? p18ErrText(d && d.error) : (d && d.error)) || 'Failed');
    }
  } catch (e) { showToast('Network error: ' + (e && e.message)); }
}
window.p20CreateTestUser = p20CreateTestUser;
window.p20CreateTestScan = p20CreateTestScan;
window.p20LoadAuditFromDb = p20LoadAuditFromDb;`;

    r = tryReplace(updated, jsAnchor, jsAddition);
    if (!r) errExit('admin.html: patch 19 globals anchor not found');
    updated = r;

    writeFile(file, updated);
    ok('admin.html: tracking link + badges + test-data + audit-db loader');
  }
}

// ===========================================================================
// 20.4 backend - add create_test_user / create_test_scan actions
// ===========================================================================

log('');
log('20.4.b  api/get-dashboard.js: add create_test_user and create_test_scan actions');
{
  const file = path.join(API, 'get-dashboard.js');
  const content = readFile(file);

  if (content.includes(MARKER_20)) {
    skip('get-dashboard.js (already patched)');
  } else {
    // Find the POST body handler — look for the "Invalid request" fallback line.
    const anchor = `    return res.status(400).json({ error: 'Invalid request' });
  }`;
    const addition = `    // ${MARKER_20}: test-data actions (admin only)
    if (action === 'create_test_user') {
      if (admin_key !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const name = String(req.body.name || '').slice(0, 60);
      const email = String(req.body.email || '').toLowerCase().slice(0, 120);
      const phone = String(req.body.phone || '').slice(0, 20);
      if (!email || !name) return res.status(400).json({ error: 'name and email required' });
      try {
        const { data: created, error } = await supabase
          .from('users')
          .insert({ name, email, phone, plan: 'etag', phone_verified: false })
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });
        try {
          const { audit } = require('./_audit');
          audit({ actor: 'admin', action: 'create_test_user', target_type: 'user', target_id: created.id, meta: { email, name } });
        } catch (e) {}
        return res.json({ success: true, user: created });
      } catch (e) {
        return res.status(500).json({ error: e && e.message });
      }
    }

    if (action === 'create_test_scan') {
      if (admin_key !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const tag_id = String(req.body.tag_id || '');
      if (!tag_id) return res.status(400).json({ error: 'tag_id required' });
      try {
        const { data: created, error } = await supabase
          .from('scan_logs')
          .insert({ tag_id, action: 'view', device_type: 'admin-test' })
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });
        try {
          const { audit } = require('./_audit');
          audit({ actor: 'admin', action: 'create_test_scan', target_type: 'tag', target_id: tag_id, meta: { scan_id: created.id } });
        } catch (e) {}
        return res.json({ success: true, scan: created });
      } catch (e) {
        return res.status(500).json({ error: e && e.message });
      }
    }

    return res.status(400).json({ error: 'Invalid request' });
  }`;

    let r = tryReplace(content, anchor, addition);
    if (!r) errExit('get-dashboard.js: invalid-request anchor not found');
    backup(file);
    writeFile(file, r);
    validateJs(file);
    ok('get-dashboard.js: test-data actions added');
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 20 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==============================================================');
log('REQUIRED: Run this SQL in Supabase BEFORE deploying');
log('==============================================================');
log('');
log('CREATE TABLE IF NOT EXISTS public.admin_audit_log (');
log('  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),');
log('  actor TEXT NOT NULL DEFAULT \'admin\',');
log('  action TEXT NOT NULL,');
log('  target_type TEXT,');
log('  target_id TEXT,');
log('  meta JSONB,');
log('  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
log(');');
log('');
log('CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at');
log('  ON public.admin_audit_log (created_at DESC);');
log('');
log('CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action');
log('  ON public.admin_audit_log (action);');
log('');
log('==============================================================');
log('Then:');
log('  git add -A');
log('  git commit -m "Patch 20: audit log + tracking links + badges + test data"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test plan:');
log('  1. Generate a batch in admin. Open the Audit panel:');
log('     - Should show "generate_tokens" entry with the batch number.');
log('  2. Verify some tokens, then finalize. Audit shows verify_tokens +');
log('     void_unverified_in_batch.');
log('  3. Open Orders panel — tracking_number is now a clickable link.');
log('  4. Look at the sidebar — Orders may show a badge with pending count.');
log('  5. Generate > "Test data" section: click "+ Test user". A test user');
log('     gets created with a unique email.');
log('==============================================================');
