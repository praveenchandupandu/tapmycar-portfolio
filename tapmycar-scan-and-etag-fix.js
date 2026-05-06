// ═══════════════════════════════════════════════════════════════
// TapMyCar — fix scan regression + eTag activation flow
// ═══════════════════════════════════════════════════════════════
// Two bugs to fix from previous patches:
//
//   BUG 1: Stranger scanning a physical sticker sees "Invalid Tag"
//   ─────────────────────────────────────────────────────────────
//   Root cause: the V6 bundle added welcome_message to the users
//   join in api/get-tag.js. If the column doesn't exist yet (or
//   PostgREST schema cache hasn't refreshed), the entire query
//   fails and the stranger sees "Invalid Tag".
//
//   Fix: try the full query first, fall back to a query without
//   welcome_message if the join errors. Backwards compatible
//   with both schema states.
//
//   BUG 2: etag.html shows the physical sticker, not the eTag
//   ─────────────────────────────────────────────────────────────
//   Root cause: etag.html uses data.tags[0]. After the physical-
//   priority patch, physical tags often come first.
//
//   Fix: explicitly find the eTag (token starts with TMC-ET) and
//   show that, regardless of ordering.
//
// New behavior the user requested:
//
//   • etag.html ALWAYS shows the eTag, even when inactive
//   • If eTag status is 'inactive' (because user activated a
//     physical), show a disabled banner and "Reactivate" button
//   • Reactivating an eTag while you have an active physical
//     enables it for 30 days only (set expires_at = now + 30d)
//   • Reactivating an eTag without a physical has no expiration
//   • get-tag.js GET checks expires_at and auto-disables if past
//
// Run from project root: node tapmycar-scan-and-etag-fix.js
// Idempotent. Safe to re-run.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const TARGETS = {
  getTag: path.join(API, 'get-tag.js'),
  etagHtml: path.join(PUBLIC, 'etag.html'),
  reactivateEtag: path.join(API, 'reactivate-etag.js'),
};

if (!fs.existsSync(TARGETS.getTag)) {
  console.error('ERROR: api/get-tag.js not found.');
  process.exit(1);
}
if (!fs.existsSync(TARGETS.etagHtml)) {
  console.error('ERROR: public/etag.html not found.');
  process.exit(1);
}

// ─── BACKUP ──────────────────────────────────────────────────
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-scan-etag-' + stamp);
fs.mkdirSync(path.join(BACKUP, 'public'), { recursive: true });
fs.mkdirSync(path.join(BACKUP, 'api'), { recursive: true });
fs.copyFileSync(TARGETS.getTag, path.join(BACKUP, 'api', 'get-tag.js'));
fs.copyFileSync(TARGETS.etagHtml, path.join(BACKUP, 'public', 'etag.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');


// ════════════════════════════════════════════════════════════
// STEP 1 — Make get-tag.js GET resilient to welcome_message
//          and add expires_at auto-expire logic
// ════════════════════════════════════════════════════════════
console.log('━━━ Step 1: Fix get-tag.js GET path ━━━');
{
  let js = fs.readFileSync(TARGETS.getTag, 'utf8');

  if (js.indexOf('TMC_GET_TAG_RESILIENT') !== -1) {
    console.log('  get-tag.js: already patched, skipping');
  } else {
    // Match the ENTIRE GET tag-fetch block (with or without welcome_message
    // in the join, with or without the auto-deactivate-on-read block from
    // the prior physical-priority patch). We replace it with a unified
    // resilient version.
    //
    // Anchor points:
    //   start: "if (token) {"  inside the GET handler
    //   end:   "return res.json({ tag, scan_id });"  followed by "}"
    //
    // Between those anchors is everything we need to replace.

    const startMarker = 'if (token) {';
    const endMarker = 'return res.json({ tag, scan_id });';

    const startIdx = js.indexOf(startMarker, js.lastIndexOf("'GET'"));
    const endIdx = js.indexOf(endMarker, startIdx);

    if (startIdx === -1 || endIdx === -1) {
      console.error('  ERROR: get-tag.js — could not locate GET tag-fetch block.');
      console.error('  Looked for: "if (token) {" ... "return res.json({ tag, scan_id });"');
      process.exit(1);
    }

    // Find the closing brace of the if(token){...} block by scanning forward
    // from endMarker until we find the matching brace.
    let i = endIdx + endMarker.length;
    while (i < js.length && js[i] !== '\n') i++;
    while (i < js.length && js[i] !== '}') i++; // closing brace of if(token)
    const blockEnd = i + 1;

    const newBlock = `if (token) {
    // TMC_GET_TAG_RESILIENT
    const cleanToken = token.toUpperCase().trim();

    // Try the full query (with welcome_message). If the column doesn't
    // exist yet (e.g. schema migration hasn't run, or PostgREST cache
    // is stale), retry without welcome_message so strangers can still
    // scan the tag. This protects against silent regressions.
    let tag = null;
    let queryError = null;

    try {
      const r = await supabase
        .from('tags')
        .select('*, users(name, phone, emergency_contact, emergency_name, welcome_message)')
        .eq('token', cleanToken)
        .single();
      if (r.error) queryError = r.error;
      else tag = r.data;
    } catch (e) {
      queryError = e;
    }

    if (!tag) {
      // Fallback: query without welcome_message
      try {
        const r2 = await supabase
          .from('tags')
          .select('*, users(name, phone, emergency_contact, emergency_name)')
          .eq('token', cleanToken)
          .single();
        if (!r2.error && r2.data) {
          tag = r2.data;
          if (tag.users) tag.users.welcome_message = null;
        } else {
          queryError = r2.error || queryError;
        }
      } catch (e) {
        queryError = e;
      }
    }

    if (!tag) {
      console.error('get-tag GET error for', cleanToken, ':', queryError?.message || queryError);
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Auto-expire: if tag has expires_at set and it's past, mark inactive.
    // This handles eTags that were reactivated for 30 days as a backup.
    try {
      if (tag.expires_at) {
        const exp = new Date(tag.expires_at).getTime();
        if (Number.isFinite(exp) && exp < Date.now() && tag.status === 'active') {
          await supabase.from('tags')
            .update({ status: 'inactive' })
            .eq('id', tag.id);
          tag.status = 'inactive';
          console.log('Auto-expired tag', tag.token, '(expires_at passed)');
        }
      }
    } catch (expErr) {
      console.error('expires_at check error (non-fatal):', expErr);
    }

    // Auto-deactivate-on-read: if this is an eTag and the owner has an
    // active physical, mark this eTag inactive — UNLESS the eTag has an
    // expires_at set, which means the user explicitly reactivated it as
    // a 30-day backup. In that case, leave it active.
    try {
      const tokenUpper = (tag.token || '').toUpperCase();
      const isEtag = tokenUpper.startsWith('TMC-ET') || tag.tag_type === 'etag';
      const hasGracePeriod = !!tag.expires_at;
      if (isEtag && tag.owner_id && tag.status === 'active' && !hasGracePeriod) {
        const { data: physicalTags } = await supabase
          .from('tags')
          .select('token, status')
          .eq('owner_id', tag.owner_id)
          .eq('status', 'active')
          .neq('id', tag.id);
        const hasActivePhysical = physicalTags && physicalTags.some(t => {
          const tk = (t.token || '').toUpperCase();
          return !tk.startsWith('TMC-ET');
        });
        if (hasActivePhysical) {
          await supabase
            .from('tags')
            .update({ status: 'inactive' })
            .eq('id', tag.id);
          tag.status = 'inactive';
          console.log('Auto-deactivated eTag', tag.token, '(owner has active physical, no grace period)');
        }
      }
    } catch (autoDeactivateErr) {
      console.error('Auto-deactivate-on-read error (non-fatal):', autoDeactivateErr);
    }

    // Log scan
    let scan_id = null;
    if (tag.status === 'active' || tag.status === 'paused') {
      const userAgent = req.headers['user-agent'] || '';
      const deviceType = /mobile|android|iphone|ipad/i.test(userAgent) ? 'mobile' : 'desktop';

      const { data: scan } = await supabase
        .from('scan_logs')
        .insert({
          tag_id: tag.id,
          action: 'view',
          device_type: deviceType
        })
        .select()
        .single();

      scan_id = scan?.id;
    }

    return res.json({ tag, scan_id });
  }`;

    js = js.substring(0, startIdx) + newBlock + js.substring(blockEnd);
    fs.writeFileSync(TARGETS.getTag, js, 'utf8');
    console.log('  get-tag.js: GET path now resilient + handles expires_at');
  }
}


// ════════════════════════════════════════════════════════════
// STEP 2 — Fix etag.html to pick the eTag specifically and
//          show disabled state + Reactivate button when needed
// ════════════════════════════════════════════════════════════
console.log('');
console.log('━━━ Step 2: Fix etag.html ━━━');
{
  let html = fs.readFileSync(TARGETS.etagHtml, 'utf8');

  if (html.indexOf('TMC_ETAG_PICKER') !== -1) {
    console.log('  etag.html: already patched, skipping');
  } else {
    // The current loadTagData picks data.tags[0] which can be a physical.
    // Replace the entire function with one that:
    //   (a) finds the eTag specifically (token starts with TMC-ET)
    //   (b) shows a status banner if eTag is inactive
    //   (c) shows a "Backup · expires in N days" banner if expires_at set
    //   (d) hides the activate banner if eTag is already active (no expires)
    //   (e) wires the new "Reactivate" button to /api/reactivate-etag

    const oldFn = /async function loadTagData\(\) \{[\s\S]*?\}\s*\}\s*catch\(e\) \{ console\.error\(e\); \}\s*\}/;

    const newFn = `async function loadTagData() {
  // TMC_ETAG_PICKER
  try {
    const res = await fetch('/api/get-dashboard?user_id=' + s.token);
    const data = await res.json();
    if (!data.tags || data.tags.length === 0) return;

    // Pick the eTag specifically. Token format rule: TMC-ET... = eTag,
    // anything else = physical. Fall back to tag_type if column exists.
    const etag = data.tags.find(t => {
      const tk = (t.token || '').toUpperCase();
      return tk.startsWith('TMC-ET') || t.tag_type === 'etag';
    });

    if (!etag) {
      // No eTag for this user (shouldn't normally happen). Just show
      // a small message instead of pretending the physical IS an eTag.
      const nameEl = document.getElementById('tag-name');
      if (nameEl) nameEl.textContent = 'No free eTag available';
      const skTok = document.getElementById('sticker-token');
      if (skTok) skTok.textContent = '#-----';
      return;
    }

    // Set tag display
    const tag = etag;
    tagToken = tag.token.includes("-") ? tag.token : "TMC-" + tag.token.replace(/^TMC/i,"");
    tagURL = 'https://tapmycar.io/tag/' + tag.token;
    const label = tag.vehicle_label || s.name || 'Your eTag';
    document.getElementById('tag-name').textContent = label + '  #' + tagToken;
    document.getElementById('sticker-token').textContent = '#' + tagToken;

    document.getElementById('qr-preview').innerHTML = '';
    new QRCode(document.getElementById('qr-preview'), {
      text: tagURL, width: 90, height: 90,
      colorDark: '#111111', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    document.getElementById('qr-hidden').innerHTML = '';
    new QRCode(document.getElementById('qr-hidden'), {
      text: tagURL, width: 400, height: 400,
      colorDark: '#111111', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    document.getElementById('qr-app').innerHTML = '';
    new QRCode(document.getElementById('qr-app'), {
      text: 'https://tapmycar.io', width: 300, height: 300,
      colorDark: '#111111', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    // Show status banner based on eTag state
    const banner = document.getElementById('etag-status-banner');
    if (banner) {
      const status = tag.status || 'unclaimed';
      const expiresAt = tag.expires_at ? new Date(tag.expires_at) : null;

      if (status === 'inactive' || status === 'disabled') {
        // eTag is currently disabled — likely because user activated a
        // physical sticker. Show banner with Reactivate option.
        banner.style.display = 'block';
        banner.style.background = '#FEF3C7';
        banner.style.border = '1px solid #FDE68A';
        banner.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-radius:13px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div style="font-size:12px;color:#78350F;font-weight:500;flex:1;line-height:1.5">This eTag is currently disabled. Reactivate to use it as a 30-day backup.</div><button onclick="reactivateEtag()" id="reactivate-btn" style="font-size:12px;font-weight:700;color:#fff;background:#F59E0B;border:none;padding:8px 14px;border-radius:9px;cursor:pointer;font-family:inherit;flex-shrink:0">Reactivate</button></div>';
      } else if (status === 'active' && expiresAt) {
        // eTag is active as a backup — show countdown
        const msLeft = expiresAt.getTime() - Date.now();
        const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
        banner.style.display = 'block';
        banner.style.background = '#DCFCE7';
        banner.style.border = '1px solid #BBF7D0';
        banner.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-radius:13px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg><div style="font-size:12px;color:#14532D;font-weight:500;flex:1;line-height:1.5">Backup eTag is active. Expires in <strong>' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '</strong>.</div></div>';
      } else if (status === 'active') {
        // Normal active eTag — no banner
        banner.style.display = 'none';
      } else {
        // Other states (unclaimed, paused) — keep banner hidden
        banner.style.display = 'none';
      }
    }

    // Hide the "Activate to enable masked calls" prompt if the eTag
    // is already active or if there's a physical (in which case the
    // user shouldn't be activating the eTag normally — they'd use Reactivate)
    const oldActivatePrompt = document.getElementById('etag-activate-prompt');
    if (oldActivatePrompt) {
      const status = tag.status || 'unclaimed';
      const hasPhysical = data.tags.some(t => {
        const tk = (t.token || '').toUpperCase();
        return !tk.startsWith('TMC-ET') && (t.status === 'active');
      });
      if (status === 'active' || status === 'inactive' || hasPhysical) {
        oldActivatePrompt.style.display = 'none';
      } else {
        oldActivatePrompt.style.display = 'flex';
      }
    }

  } catch(e) { console.error(e); }
}

async function reactivateEtag() {
  const btn = document.getElementById('reactivate-btn');
  if (btn) { btn.textContent = 'Reactivating...'; btn.disabled = true; }
  try {
    const res = await fetch('/api/reactivate-etag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: s.token })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof showToast === 'function') {
        showToast(data.expires_at ? 'eTag reactivated for 30 days' : 'eTag reactivated');
      }
      // Reload to refresh status
      setTimeout(() => loadTagData(), 600);
    } else {
      if (typeof showToast === 'function') showToast(data.error || 'Could not reactivate');
      if (btn) { btn.textContent = 'Reactivate'; btn.disabled = false; }
    }
  } catch(e) {
    if (typeof showToast === 'function') showToast('Network error');
    if (btn) { btn.textContent = 'Reactivate'; btn.disabled = false; }
  }
}`;

    if (!oldFn.test(html)) {
      console.error('  ERROR: etag.html — could not match loadTagData function');
      process.exit(1);
    }
    html = html.replace(oldFn, newFn);

    // Add the status banner DIV above the "tag-name" element so it
    // appears between the QR sticker and the action buttons.
    const tagNameAnchor = '<div style="text-align:center"><div style="font-size:17px;font-weight:800;color:var(--bk);margin-bottom:3px" id="tag-name">';
    if (html.indexOf(tagNameAnchor) === -1) {
      console.error('  ERROR: etag.html — could not find tag-name anchor');
      process.exit(1);
    }
    const bannerDiv = '<div id="etag-status-banner" style="display:none;border-radius:13px;margin-bottom:12px"></div>\n  ';
    html = html.replace(tagNameAnchor, bannerDiv + tagNameAnchor);

    // Tag the existing "Activate to enable masked calls" wrapper with an id
    // so we can selectively hide it. The wrapper currently has no id.
    const oldActivateWrapper = '<div onclick="window.location.href=\'/activate.html\'" style="width:100%;display:flex;align-items:center;gap:10px;background:var(--orl);border-radius:13px;padding:13px 16px;border:.5px solid var(--orl2);cursor:pointer">';
    if (html.indexOf(oldActivateWrapper) !== -1) {
      const newActivateWrapper = '<div id="etag-activate-prompt" onclick="window.location.href=\'/activate.html\'" style="width:100%;display:flex;align-items:center;gap:10px;background:var(--orl);border-radius:13px;padding:13px 16px;border:.5px solid var(--orl2);cursor:pointer">';
      html = html.replace(oldActivateWrapper, newActivateWrapper);
    }

    fs.writeFileSync(TARGETS.etagHtml, html, 'utf8');
    console.log('  etag.html: now picks eTag explicitly + shows status banner + Reactivate button');
  }
}


// ════════════════════════════════════════════════════════════
// STEP 3 — Create new /api/reactivate-etag endpoint
// ════════════════════════════════════════════════════════════
console.log('');
console.log('━━━ Step 3: Create /api/reactivate-etag.js ━━━');
{
  if (fs.existsSync(TARGETS.reactivateEtag)) {
    console.log('  reactivate-etag.js: already exists, skipping');
  } else {
    const code = `// TapMyCar — /api/reactivate-etag
// Reactivates a user's eTag. If the user has an active physical sticker,
// the eTag is reactivated as a 30-day backup (expires_at = now + 30d).
// Otherwise, the eTag becomes active with no expiration.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    // Find user's tags
    const { data: tags, error: tagsErr } = await supabase
      .from('tags')
      .select('id, token, status, tag_type')
      .eq('owner_id', user_id);

    if (tagsErr) {
      console.error('reactivate-etag fetch tags error:', tagsErr);
      return res.status(500).json({ error: 'Could not fetch tags' });
    }

    // Find the eTag (token starts with TMC-ET, or tag_type='etag')
    const etag = (tags || []).find(t => {
      const tk = (t.token || '').toUpperCase();
      return tk.startsWith('TMC-ET') || t.tag_type === 'etag';
    });

    if (!etag) {
      return res.status(404).json({ error: 'No eTag found for this user' });
    }

    // Find any active physical
    const hasActivePhysical = (tags || []).some(t => {
      const tk = (t.token || '').toUpperCase();
      return !tk.startsWith('TMC-ET') && t.status === 'active';
    });

    // Build update — set status to active. If physical exists, set 30-day expiry.
    const updates = { status: 'active' };
    if (hasActivePhysical) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      updates.expires_at = expiresAt.toISOString();
    } else {
      updates.expires_at = null;
    }

    const { error: updateErr } = await supabase
      .from('tags')
      .update(updates)
      .eq('id', etag.id);

    if (updateErr) {
      // expires_at column may not exist yet — try again without it
      if (updateErr.message && updateErr.message.toLowerCase().includes('expires_at')) {
        const { error: fallbackErr } = await supabase
          .from('tags')
          .update({ status: 'active' })
          .eq('id', etag.id);
        if (fallbackErr) {
          console.error('reactivate-etag fallback error:', fallbackErr);
          return res.status(500).json({ error: fallbackErr.message });
        }
        return res.json({
          success: true,
          expires_at: null,
          warning: 'expires_at column missing — eTag reactivated without expiration. Run the SQL migration.'
        });
      }
      console.error('reactivate-etag update error:', updateErr);
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json({ success: true, expires_at: updates.expires_at });

  } catch (e) {
    console.error('reactivate-etag fatal:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
`;
    fs.writeFileSync(TARGETS.reactivateEtag, code, 'utf8');
    console.log('  reactivate-etag.js: created');
  }
}


// ════════════════════════════════════════════════════════════
// STEP 4 — Generate / update SQL migration file
// ════════════════════════════════════════════════════════════
console.log('');
console.log('━━━ Step 4: SQL migration ━━━');
{
  const sqlPath = path.join(ROOT, 'tapmycar-scan-etag-migration.sql');
  const sql = `-- TapMyCar — schema additions for eTag 30-day backup mechanism
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/_/sql

-- expires_at: when an eTag is reactivated alongside an active physical,
-- it gets a 30-day expiration. NULL means no expiration (default).
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Helpful index for lookups (optional but nice for performance)
CREATE INDEX IF NOT EXISTS tags_expires_at_idx ON public.tags(expires_at)
  WHERE expires_at IS NOT NULL;

-- Done.
`;
  fs.writeFileSync(sqlPath, sql, 'utf8');
  console.log('  Wrote: tapmycar-scan-etag-migration.sql');
}


// ════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  SCAN + ETAG FIX BUNDLE COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Files modified / created:');
console.log('  ✓ api/get-tag.js              — resilient query + expires_at handling');
console.log('  ✓ public/etag.html            — picks eTag explicitly, status banner, Reactivate button');
console.log('  ✓ api/reactivate-etag.js      — NEW: handles 30-day backup logic');
console.log('  ✓ tapmycar-scan-etag-migration.sql — adds expires_at column to tags');
console.log('');
console.log('Manual step:');
console.log('  Open Supabase SQL editor → paste this → Run:');
console.log('');
console.log('    ALTER TABLE public.tags');
console.log('      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;');
console.log('');
console.log('  (Or open tapmycar-scan-etag-migration.sql for the full version.)');
console.log('');
console.log('Then deploy:');
console.log('  git add api/get-tag.js api/reactivate-etag.js public/etag.html');
console.log('  git commit -m "Fix scan regression + add eTag 30-day backup flow"');
console.log('  git push');
console.log('');
console.log('After deploy, test:');
console.log('  1. Stranger scans your physical sticker URL → should show contact page');
console.log('  2. Visit etag.html → should show your eTag (TMC-ET token), not the physical');
console.log('  3. eTag banner says "disabled" with Reactivate button');
console.log('  4. Click Reactivate → banner changes to "active for 30 days"');
console.log('  5. Stranger can scan the eTag URL during the 30-day window');
