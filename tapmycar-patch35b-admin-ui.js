// ============================================================================
// TapMyCar - Patch 35b: Admin UI for Gift Activate
//
// Adds the admin form for activating a physical tag as a gift, plus a
// gifts-history list showing all tags currently in is_gift=true state.
//
// Lives in the existing Promos tab (alongside the older "Gift plan by email"
// and "Generate promo code" cards). This is a complementary feature, not a
// replacement.
//
// Form fields:
//   - Tag token (TMC-XXXXXX)
//   - Plan: standard or premium
//   - Trial months: 1-12 (default 1)
//   - Recipient email (optional, for pre-linked gifts)
//   - Note (optional)
//   - "Activate as Gift" button -> POST /api/admin-gift-activate
//
// Gifts-history list below:
//   - Reads from /api/get-tags (existing endpoint) and filters client-side
//     to is_gift=true.
//   - Shows each gift with token, plan, months, recipient, note, status.
//
// Properties: idempotent, safeReplace, backs up files.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35b-${ts}`);

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
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 35b \u2014 admin UI for Gift Activate');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35B_GIFT_ADMIN';

const file = path.join(PUBLIC, 'admin.html');
const content = readFile(file);

let updated = content;
let alreadyHasMain = content.includes(MARKER);

if (alreadyHasMain) {
  skip('admin.html main sections (already patched) \u2014 will still check 35b.5 + 35b.6');
} else {
  backup(file);
}

// =============================================================================
// 35b.1  Insert the Gift Activate Tag card + gifts list HTML
//
// Anchor: end of the Promos panel just before its closing </div>.
// =============================================================================

if (!alreadyHasMain) {
const oldPromosEnd = `    <div class="gen-box">
      <h3>Generate promo code</h3>`;

const newPromosOpen = `    <!-- ${MARKER}: Gift Activate Tag card -->
    <div class="gen-box" style="border:2px solid rgba(255,107,0,0.18)">
      <h3 style="color:#FF6B00">\ud83c\udf81 Gift Activate Tag</h3>
      <p>Mark an unclaimed verified physical sticker as a gift. When the recipient scans it, the chosen plan activates free for the trial period \u2014 no payment required. After the trial expires, the user is prompted to subscribe yearly.</p>
      <div class="form-stack">
        <div class="field">
          <label class="field-label">Tag token</label>
          <input type="text" class="gen-input" id="p35b-token" placeholder="TMC-XXXXXX" oninput="this.value=this.value.toUpperCase()" maxlength="16">
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label">Plan</label>
            <select class="gen-input" id="p35b-plan">
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">Trial months</label>
            <input type="number" class="gen-input" id="p35b-months" min="1" max="12" value="1">
          </div>
        </div>
        <div class="field">
          <label class="field-label">Recipient email <span style="color:#9CA3AF;font-weight:400">(optional)</span></label>
          <input type="email" class="gen-input" id="p35b-email" placeholder="Leave blank for open gift (anyone can claim)">
          <div class="kpi-sub" style="margin-top:4px">If provided, only this user can claim. They must already have an account.</div>
        </div>
        <div class="field">
          <label class="field-label">Note <span style="color:#9CA3AF;font-weight:400">(optional)</span></label>
          <input type="text" class="gen-input" id="p35b-note" placeholder="e.g. NYC Auto Show 2026" maxlength="200">
        </div>
        <button class="gen-btn success full" onclick="p35bActivateGift()" id="p35b-activate-btn">Activate as Gift</button>
        <div id="p35b-result" style="margin-top:8px"></div>
      </div>
    </div>

    <div class="gen-box">
      <h3>Generate promo code</h3>`;

const r1 = safeReplace(updated, oldPromosEnd, newPromosOpen);
if (!r1) errExit('admin.html: Promos panel anchor not found');
updated = r1;
ok('Gift Activate Tag card inserted into Promos panel');

// =============================================================================
// 35b.2  Insert "Gifts in flight" list section at the END of the Promos panel
// =============================================================================

const oldPromosClose = `<!-- ORDERS TAB -->
<div class="panel" id="panel-orders">`;

const newGiftsListThenOrders = `
  <!-- ${MARKER}: Gifts in flight list -->
  <div style="margin-top:24px">
    <div class="asl">Gifts in flight</div>
    <div class="kpi-sub" style="margin-bottom:14px;padding:0 4px">All physical tags currently marked as gift-ready. Click a row to see details.</div>
    <div class="form-row" style="margin-bottom:14px">
      <input type="text" class="gen-input" id="p35b-search" placeholder="Search by token, email, note\u2026" oninput="p35bRenderGifts()">
      <button class="gen-btn" onclick="p35bLoadGifts()">Refresh</button>
    </div>
    <div id="p35b-gifts-list"><div class="empty">Loading gifts\u2026</div></div>
  </div>

</div>

<!-- ORDERS TAB -->
<div class="panel" id="panel-orders">`;

/* The first anchor already closes the panel-promos div (the </div> right
   before the ORDERS TAB comment). We instead inject the list before that
   closing </div>. The simplest way: replace the literal "</div>\n\n<!-- ORDERS TAB -->"
   pattern. */

const oldClose = `</div>

<!-- ORDERS TAB -->
<div class="panel" id="panel-orders">`;
const r2 = safeReplace(updated, oldClose, newGiftsListThenOrders);
if (!r2) errExit('admin.html: Promos closing </div> anchor not found');
updated = r2;
ok('Gifts list section added at end of Promos panel');

// =============================================================================
// 35b.3  Inject JavaScript: p35bActivateGift + p35bLoadGifts + p35bRenderGifts
//
// Anchor: just before the function navTo(id) definition.
// =============================================================================

const oldNavTo = `function navTo(id){`;

const newNavToBlock = `// ${MARKER}: Gift Activate Tag form handler + gifts-in-flight list
let p35bGiftsCache = [];

async function p35bActivateGift() {
  const tokenEl = document.getElementById('p35b-token');
  const planEl = document.getElementById('p35b-plan');
  const monthsEl = document.getElementById('p35b-months');
  const emailEl = document.getElementById('p35b-email');
  const noteEl = document.getElementById('p35b-note');
  const resultEl = document.getElementById('p35b-result');
  const btnEl = document.getElementById('p35b-activate-btn');

  const token = (tokenEl.value || '').trim().toUpperCase();
  const plan = planEl.value;
  const months = parseInt(monthsEl.value, 10);
  const email = (emailEl.value || '').trim().toLowerCase();
  const note = (noteEl.value || '').trim();

  if (!token) { resultEl.innerHTML = '<div class="p26-error">Token required</div>'; return; }
  if (!/^TMC-[A-Z0-9]{6,12}$/.test(token)) {
    resultEl.innerHTML = '<div class="p26-error">Token format must be TMC-XXXXXX</div>';
    return;
  }
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    resultEl.innerHTML = '<div class="p26-error">Months must be 1\u201312</div>';
    return;
  }

  btnEl.textContent = 'Activating\u2026';
  btnEl.disabled = true;
  resultEl.innerHTML = '';

  try {
    const body = { token: token, plan: plan, months: months };
    if (email) body.assigned_user_email = email;
    if (note) body.note = note;

    const res = await fetch('/api/admin-gift-activate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': getAdminKey()
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok && data && data.success) {
      const g = data.gift;
      const recipient = g.assigned_user_name
        ? (g.assigned_user_name + ' (' + g.assigned_user_email + ')')
        : 'Open gift \u2014 anyone who scans first claims it';
      resultEl.innerHTML =
        '<div class="p26-ok">' +
        '<strong>\u2705 ' + g.token + ' is now gift-ready.</strong><br>' +
        'Plan: ' + g.plan + ' \u00b7 Trial: ' + g.months + ' month' + (g.months > 1 ? 's' : '') + '<br>' +
        'Recipient: ' + recipient +
        '</div>';
      tokenEl.value = '';
      monthsEl.value = '1';
      emailEl.value = '';
      noteEl.value = '';
      /* Refresh the gifts list below */
      p35bLoadGifts();
    } else {
      resultEl.innerHTML = '<div class="p26-error">\u274c ' + p26Esc((data && data.error) || 'Failed to activate gift') + '</div>';
    }
  } catch (e) {
    resultEl.innerHTML = '<div class="p26-error">\u274c Network error: ' + p26Esc(e.message || '') + '</div>';
  } finally {
    btnEl.textContent = 'Activate as Gift';
    btnEl.disabled = false;
  }
}

async function p35bLoadGifts() {
  const listEl = document.getElementById('p35b-gifts-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty">Loading gifts\u2026</div>';
  try {
    /* Reuse the existing get-tags admin endpoint and filter client-side */
    const res = await fetch('/api/get-tags', {
      headers: { 'x-admin-key': getAdminKey() }
    });
    const data = await res.json();
    if (!data || !Array.isArray(data.tags)) {
      listEl.innerHTML = '<div class="empty">Failed to load tags</div>';
      return;
    }
    p35bGiftsCache = data.tags.filter(function(t) { return t.is_gift === true; });
    p35bRenderGifts();
  } catch (e) {
    listEl.innerHTML = '<div class="empty">Network error: ' + p26Esc(e.message || '') + '</div>';
  }
}

function p35bRenderGifts() {
  const listEl = document.getElementById('p35b-gifts-list');
  if (!listEl) return;
  const search = (document.getElementById('p35b-search').value || '').toLowerCase().trim();

  let rows = p35bGiftsCache;
  if (search) {
    rows = rows.filter(function(t) {
      return (t.token && t.token.toLowerCase().indexOf(search) >= 0) ||
             (t.gift_note && String(t.gift_note).toLowerCase().indexOf(search) >= 0);
    });
  }

  if (rows.length === 0) {
    listEl.innerHTML = '<div class="empty">No gifts in flight yet. Activate a tag above to get started.</div>';
    return;
  }

  /* Sort newest first by claimed_at (claimed) then by created_at */
  rows.sort(function(a, b) {
    const aT = a.claimed_at || a.created_at || '';
    const bT = b.claimed_at || b.created_at || '';
    return bT.localeCompare(aT);
  });

  listEl.innerHTML = rows.map(function(t) {
    const isClaimed = t.status === 'active';
    const isUnclaimed = t.status === 'unclaimed';
    const statusLabel = isClaimed
      ? '<span class="badge green">Claimed</span>'
      : (isUnclaimed
          ? '<span class="badge orange">Waiting for scan</span>'
          : '<span class="badge">' + p26Esc(t.status || '') + '</span>');
    const recipient = t.gift_assigned_to_user_id
      ? 'Pre-linked'
      : 'Open';
    const planLabel = t.gift_plan
      ? (t.gift_plan.charAt(0).toUpperCase() + t.gift_plan.slice(1))
      : '\u2014';
    const note = t.gift_note ? p26Esc(t.gift_note) : '';
    return '<div class="p26-setting-row" style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center">' +
      '<div>' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:4px">' + p26Esc(t.token) + ' ' + statusLabel + '</div>' +
        '<div class="kpi-sub" style="margin:0">' +
          'Plan: <strong>' + planLabel + '</strong> \u00b7 ' +
          'Trial: <strong>' + (t.gift_months || '?') + ' mo</strong> \u00b7 ' +
          'Recipient: <strong>' + recipient + '</strong>' +
          (note ? '<br><span style="color:#9CA3AF">Note: ' + note + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<button class="gen-btn" onclick="p35bRevokeGift(\\''+ p26Esc(t.token) +'\\')" ' +
              'style="font-size:11px;padding:8px 12px;background:#fff;color:#DC2626;border:1px solid #FCA5A5"' +
              (isClaimed ? ' disabled title="Already claimed"' : '') + '>Revoke</button>' +
    '</div>';
  }).join('');
}

async function p35bRevokeGift(token) {
  if (!confirm('Revoke gift on ' + token + '?\\n\\nThis will clear the gift flags. The tag will be available for regular claim or a fresh gift.')) return;
  try {
    const res = await fetch('/api/get-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        is_gift: false,
        gift_plan: null,
        gift_months: null,
        gift_assigned_to_user_id: null,
        gift_note: null,
        admin_key: getAdminKey()
      })
    });
    if (res.ok) {
      p35bLoadGifts();
    } else {
      alert('Revoke failed. Check console.');
    }
  } catch (e) {
    alert('Network error');
  }
}

/* Load gifts when Promos tab is opened */
(function() {
  const origNavTo = window.navTo;
  if (typeof origNavTo === 'function') {
    window.navTo = function(id) {
      const r = origNavTo.apply(this, arguments);
      if (id === 'promos' && typeof p35bLoadGifts === 'function') {
        p35bLoadGifts();
      }
      return r;
    };
  }
})();

function navTo(id){`;

const r3 = safeReplace(updated, oldNavTo, newNavToBlock);
if (!r3) errExit('admin.html: navTo anchor not found');
updated = r3;
ok('Gift Activate JS functions injected');

// =============================================================================
// 35b.4  Update TAB_TITLES + TAB_SUBS for promos to reflect gift activate
// =============================================================================

const oldTabSubsPromos = `"promos": "Gift plans and promo codes"`;
const newTabSubsPromos = `"promos": "Gift plans, gift-activate tags, and promo codes"`;
const r4 = safeReplace(updated, oldTabSubsPromos, newTabSubsPromos);
if (r4) { updated = r4; ok('Promos tab subtitle updated'); }
else { log('  \u00b7 Promos tab subtitle anchor not found (skipped, non-critical)'); }

writeFile(file, updated);
} /* end if (!alreadyHasMain) */

// =============================================================================
// 35b.5  Create api/admin-gift-revoke.js - revoke a gift before it's claimed
// =============================================================================

log('');
log('35b.5  api/admin-gift-revoke.js: new revoke endpoint');
{
  const revokeFile = path.join(ROOT, 'api', 'admin-gift-revoke.js');
  if (fs.existsSync(revokeFile)) {
    const existing = fs.readFileSync(revokeFile, 'utf8');
    if (existing.includes(MARKER)) {
      skip('admin-gift-revoke.js');
    } else {
      errExit('admin-gift-revoke.js exists without marker');
    }
  } else {
    const revokeBody = `// ${MARKER}
// POST /api/admin-gift-revoke
//
// Admin-only. Removes the gift flag from a tag that hasn't been claimed yet.
// Tags that have already been claimed (status='active') cannot be revoked
// from here - that requires a separate refund/cancel workflow.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

const TOKEN_RE = /^TMC-[A-Z0-9]{6,12}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = String((req.body && req.body.token) || '').trim().toUpperCase();
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).json({ error: 'Invalid token format' });
  }

  const { data: tag, error: tagErr } = await supabase
    .from('tags')
    .select('id, token, status, is_gift')
    .eq('token', token)
    .maybeSingle();

  if (tagErr) {
    console.error('tag lookup error:', tagErr.message);
    return res.status(500).json({ error: 'Tag lookup failed' });
  }
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  if (!tag.is_gift) return res.status(400).json({ error: 'Tag is not currently a gift' });
  if (tag.status === 'active') {
    return res.status(400).json({
      error: 'Tag is already claimed by a user. Cannot revoke from here.'
    });
  }

  const { error: updErr } = await supabase
    .from('tags')
    .update({
      is_gift: false,
      gift_plan: null,
      gift_months: null,
      gift_assigned_to_user_id: null,
      gift_note: null
    })
    .eq('id', tag.id);

  if (updErr) {
    console.error('revoke update error:', updErr.message);
    return res.status(500).json({ error: 'Failed to revoke gift' });
  }

  if (_audit) {
    try {
      await _audit({
        actor: 'admin',
        action: 'gift_revoke',
        target_type: 'tag',
        target_id: token,
        meta: {}
      });
    } catch (e) {}
  }

  return res.json({ success: true });
};
`;
    fs.writeFileSync(revokeFile, revokeBody, 'utf8');
    try {
      require('child_process').execSync('node --check "' + revokeFile + '"', { stdio: 'pipe' });
      ok('admin-gift-revoke.js: created and JS valid');
    } catch (e) {
      errExit('JS syntax error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// 35b.6  Update p35bRevokeGift in admin.html to use the new endpoint
// =============================================================================

log('');
log('35b.6  admin.html: rewire p35bRevokeGift to new endpoint');
{
  const adminContent = fs.readFileSync(file, 'utf8');
  const oldRevoke = `async function p35bRevokeGift(token) {
  if (!confirm('Revoke gift on ' + token + '?\\n\\nThis will clear the gift flags. The tag will be available for regular claim or a fresh gift.')) return;
  try {
    const res = await fetch('/api/get-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        is_gift: false,
        gift_plan: null,
        gift_months: null,
        gift_assigned_to_user_id: null,
        gift_note: null,
        admin_key: getAdminKey()
      })
    });
    if (res.ok) {
      p35bLoadGifts();
    } else {
      alert('Revoke failed. Check console.');
    }
  } catch (e) {
    alert('Network error');
  }
}`;
  const newRevoke = `async function p35bRevokeGift(token) {
  if (!confirm('Revoke gift on ' + token + '?\\n\\nThis will clear the gift flags. The tag will be available for regular claim or a fresh gift.')) return;
  try {
    const res = await fetch('/api/admin-gift-revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': getAdminKey()
      },
      body: JSON.stringify({ token: token })
    });
    const data = await res.json();
    if (res.ok && data && data.success) {
      p35bLoadGifts();
    } else {
      alert('Revoke failed: ' + ((data && data.error) || 'unknown'));
    }
  } catch (e) {
    alert('Network error');
  }
}`;
  if (adminContent.includes(oldRevoke)) {
    fs.writeFileSync(file, adminContent.replace(oldRevoke, () => newRevoke), 'utf8');
    ok('p35bRevokeGift rewired to /api/admin-gift-revoke');
  } else if (adminContent.includes(newRevoke)) {
    skip('p35bRevokeGift (already rewired)');
  } else {
    errExit('p35bRevokeGift anchor not found');
  }
}

log('');
log('==============================================================');
log('Patch 35b complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35b: admin UI for Gift Activate"');
log('  git push');
log('  Wait ~60 sec.');
log('');
log('Test plan:');
log('  1. Open https://tapmycar.io/admin.html');
log('  2. Click "Promos" in the sidebar (Operations group)');
log('  3. New orange-bordered card appears: "\ud83c\udf81 Gift Activate Tag"');
log('     - Token: enter a verified unclaimed tag (e.g. a fresh TMC-XXXXXX');
log('       from your Generate batch)');
log('     - Plan: Standard');
log('     - Months: 1');
log('     - Leave email + note blank for first test');
log('  4. Click "Activate as Gift"');
log('     Expected: green success box confirming gift activated');
log('  5. Below the form, "Gifts in flight" list should now show 1 entry');
log('     - Status: orange "Waiting for scan"');
log('     - Plan: Standard \u00b7 Trial: 1 mo \u00b7 Recipient: Open');
log('  6. Verify in Supabase:');
log('     SELECT token, is_gift, gift_plan, gift_months, gift_note');
log('     FROM tags WHERE token = (TMC-XXXXXX);');
log('     Should show is_gift=true, gift_plan=standard, gift_months=1');
log('  7. Try the Revoke button \u2192 confirms \u2192 row disappears from list.');
log('');
log('Next: Patch 35c \u2014 the recipient claim flow + expiry cron + emails.');
log('  When a recipient scans a tag with is_gift=true:');
log('   - Welcome banner: "\ud83c\udf81 You received a free TapMyCar sticker"');
log('   - On claim: apply trial (set user gift_plan_expires_at)');
log('   - Day 25+: dashboard banner about expiry');
log('   - Cron: daily downgrade of expired gifts');
log('   - Emails: 5d / 1d / day-of expiry reminders');
log('==============================================================');
