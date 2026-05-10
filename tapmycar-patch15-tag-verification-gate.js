// ============================================================================
// TapMyCar - Patch 15: Tag verification gate (anti-fraud)
//
// Concept: tokens generated for the manufacturer can be misused. If you send
// 100 tokens to your manufacturer but only receive 90 back, the other 10 are
// still in your DB as valid unclaimed tokens — anyone (including a corrupt
// manufacturer employee) could activate them or print fake stickers and sell
// them. You lose money and trust.
//
// This patch adds a verification step:
//
//   1. Tokens are generated as before, but they're NOT yet activatable.
//      They sit in `unclaimed` status with `verified=false`.
//
//   2. When stickers physically arrive at your warehouse, you go to the
//      admin "Verify received stickers" panel and either:
//        - Type each token (TMC-XXXXXX), or
//        - Use the camera scanner to scan each sticker's QR code.
//      Each scanned token gets `verified=true, verified_at=NOW()`.
//
//   3. When you're done scanning, click "Done — void unverified in this
//      batch". Any unscanned tokens in that batch get marked
//      `status='voided'` with `voided_at` and `void_reason`. Voided tokens
//      are kept in the DB for audit (you can see them in the new "Voided
//      tags" tab) but cannot be activated.
//
//   4. When a customer scans an unverified or voided sticker, they see a
//      friendly message: "This sticker hasn't been activated by TapMyCar
//      yet. If you bought this from us, please contact support."
//      No claim/activation possible.
//
// Bonus admin UI fixes (since we're touching admin.html):
//   - Form labels were too faint (--text-3 = #9CA3AF). Brightened to
//     --text-2 (#D8DCE6) for proper dark-mode contrast.
//   - Chrome's autofill was making inputs white-on-light-gray (placeholder
//     invisible). Added webkit-autofill override to keep inputs dark.
//
// Bonus security fix:
//   - get-tag.js status_override path had NO admin auth — anyone could
//     POST {token, status_override: 'deleted'} to delete any tag.
//     Now requires x-admin-key header.
//
// Schema changes:
//   ALTER TABLE tags ADD verified BOOLEAN DEFAULT false;
//   ALTER TABLE tags ADD verified_at TIMESTAMPTZ;
//   ALTER TABLE tags ADD voided_at TIMESTAMPTZ;
//   ALTER TABLE tags ADD void_reason TEXT;
//   UPDATE tags SET verified = true, verified_at = NOW()
//     WHERE verified = false;  -- grandfather everything existing
//
// Existing tokens are grandfathered to verified=true. Only NEW tokens
// generated AFTER this patch ships go through the verification flow.
//
// REQUIRES: Patches 1-14 already applied locally.
//
// Properties:
//   - Idempotent
//   - Backups every touched file to backup-patch15-{timestamp}/
//   - Validates JS syntax with node --check
//   - Prints SQL migration to run BEFORE deploying patched code
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch15-tag-verification-gate.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch15-tag-verification-gate.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch15-tag-verification-gate.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch15-${ts}`);

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
log('TapMyCar Patch 15 \u2014 Tag verification gate');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_15 = 'TMC_PATCH15_VERIFY_GATE';

// ===========================================================================
// 15.1  generate-tokens.js — new tokens default to verified=false
// ===========================================================================

log('15.1  api/generate-tokens.js: new tokens default to unverified');
{
  const file = path.join(API, 'generate-tokens.js');
  const content = readFile(file);

  if (content.includes(MARKER_15)) {
    skip('generate-tokens.js (already patched)');
  } else {
    const oldInsert = `      .insert({
        token,
        status: 'unclaimed',
        batch_number: batch_number || null,
        tag_type: 'physical'
      })`;
    const newInsert = `      .insert({
        token,
        status: 'unclaimed',
        batch_number: batch_number || null,
        tag_type: 'physical',
        verified: false /* ${MARKER_15}: must be verified by admin before activation */
      })`;

    const r = tryReplace(content, oldInsert, newInsert);
    if (!r) errExit('generate-tokens.js: insert block not found');
    backup(file);
    writeFile(file, r);
    validateJs(file);
    ok('generate-tokens.js: new tokens insert with verified=false');
  }
}

// ===========================================================================
// 15.2  get-tag.js — block claim of unverified tokens + admin-auth status_override
// ===========================================================================

log('');
log('15.2  api/get-tag.js: verification gate at activation + admin auth on status_override');
{
  const file = path.join(API, 'get-tag.js');
  const content = readFile(file);

  if (content.includes(MARKER_15)) {
    skip('get-tag.js (already patched)');
  } else {
    let updated = content;

    // 15.2.a — Add admin-auth check to DESTRUCTIVE status_override values
    // ('deleted' and 'voided'). Other values like 'paused', 'inactive',
    // 'active' remain user-accessible because owners legitimately use them
    // from their own dashboard to pause/resume their own tags. Adding admin
    // auth here would break user-facing flows in app.js, dashboard.html,
    // and activate.html.
    const oldStatusOverride = `    // Handle status override (deactivate, delete, etc.)
    if (status_override) {`;
    const newStatusOverride = `    // Handle status override (deactivate, delete, etc.)
    if (status_override) {
      // ${MARKER_15}: destructive overrides require admin auth. Other status
      // changes ('paused', 'inactive', 'active') remain user-accessible.
      if (status_override === 'deleted' || status_override === 'voided') {
        const _adminKey = req.headers['x-admin-key'] || (req.body && req.body.admin_key) || '';
        if (_adminKey !== process.env.ADMIN_SECRET_KEY) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }`;

    let r1 = tryReplace(updated, oldStatusOverride, newStatusOverride);
    if (!r1) errExit('get-tag.js: status_override anchor not found');
    updated = r1;

    // 15.2.b — Add verification gate just before the claim/activation update.
    // The natural place: just before `const updates = { owner_id: user_id, ...}`
    // around line 159. We insert a verified check.
    const oldUpdates = `    const updates = {
      owner_id: user_id,
      status: 'active',
      claimed_at: new Date().toISOString(),
      activated_at: new Date().toISOString()
    };`;

    const newUpdates = `    // ${MARKER_15}: verification gate
    // Block activation of tokens that haven't been verified by admin yet.
    // Tokens flow:  generated (verified=false) -> admin scans (verified=true) -> customer can activate.
    // Voided tokens (status='voided') are never activatable.
    try {
      const { data: vtag } = await supabase
        .from('tags')
        .select('verified, status, tag_type')
        .eq('token', cleanToken)
        .maybeSingle();
      if (!vtag) {
        return res.status(404).json({ error: 'Tag not found.' });
      }
      if (vtag.status === 'voided') {
        return res.status(403).json({
          error: 'This sticker has been voided and cannot be activated. If you bought this from TapMyCar, please contact support.',
          voided: true
        });
      }
      // eTags are auto-issued by the system, never go to a manufacturer,
      // so they're inherently trusted. Only physical tags need verification.
      if (vtag.tag_type === 'physical' && !vtag.verified) {
        return res.status(403).json({
          error: 'This sticker has not been activated by TapMyCar yet. If you bought this from us, please contact support@tapmycar.io.',
          unverified: true
        });
      }
    } catch (e) {
      console.error('verification gate error:', e && e.message);
      // Fail closed on errors — better to delay a real customer than
      // accidentally allow an unverified tag.
      return res.status(500).json({ error: 'Verification check failed. Please try again.' });
    }

    const updates = {
      owner_id: user_id,
      status: 'active',
      claimed_at: new Date().toISOString(),
      activated_at: new Date().toISOString()
    };`;

    let r2 = tryReplace(updated, oldUpdates, newUpdates);
    if (!r2) errExit('get-tag.js: updates anchor not found');
    updated = r2;

    backup(file);
    writeFile(file, updated);
    validateJs(file);
    ok('get-tag.js: verification gate added + status_override admin-auth');
  }
}

// ===========================================================================
// 15.3  Create new endpoint api/verify-tags.js
// ===========================================================================

log('');
log('15.3  api/verify-tags.js: new admin-only endpoint for verify and void');
{
  const file = path.join(API, 'verify-tags.js');
  if (fs.existsSync(file) && readFile(file).includes(MARKER_15)) {
    skip('verify-tags.js (already exists)');
  } else {
    const body = `// ${MARKER_15}
// /api/verify-tags
// Admin-only endpoint to mark tokens as verified or void unverified ones.
//
// Modes:
//   POST { mode: 'verify', tokens: ['TMC-AB12CD', ...] }
//     -> marks listed tokens as verified=true, verified_at=NOW()
//     -> only affects tokens currently unclaimed AND unverified
//
//   POST { mode: 'void_unverified_in_batch', batch_number: 2 }
//     -> finds all tokens in batch where verified=false AND status='unclaimed'
//     -> sets status='voided', voided_at=NOW(), void_reason='not received from manufacturer'
//
//   POST { mode: 'void_old', days: 30 }
//     -> manual backstop: voids unverified tokens older than N days
//
// Auth: requires x-admin-key header matching ADMIN_SECRET_KEY.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { mode } = req.body || {};

  if (mode === 'verify') {
    const tokens = (req.body && req.body.tokens) || [];
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: 'tokens array required' });
    }
    if (tokens.length > 1000) {
      return res.status(400).json({ error: 'Max 1000 tokens per request' });
    }
    // Normalize tokens
    const cleanTokens = tokens.map(t => String(t).toUpperCase().trim()).filter(t => /^TMC-[A-Z0-9]+$/.test(t));
    if (cleanTokens.length === 0) {
      return res.status(400).json({ error: 'No valid token formats provided' });
    }

    // Only verify tokens that are currently unclaimed AND unverified
    const { data: updated, error } = await supabase
      .from('tags')
      .update({ verified: true, verified_at: new Date().toISOString() })
      .in('token', cleanTokens)
      .eq('status', 'unclaimed')
      .eq('verified', false)
      .select('token');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      verified_count: updated ? updated.length : 0,
      verified_tokens: updated ? updated.map(t => t.token) : []
    });
  }

  if (mode === 'void_unverified_in_batch') {
    const batch_number = parseInt(req.body.batch_number, 10);
    if (!Number.isFinite(batch_number) || batch_number < 1) {
      return res.status(400).json({ error: 'Valid batch_number required' });
    }
    const reason = String(req.body.void_reason || 'not received from manufacturer').slice(0, 200);

    const { data: voided, error } = await supabase
      .from('tags')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        void_reason: reason
      })
      .eq('batch_number', batch_number)
      .eq('verified', false)
      .eq('status', 'unclaimed')
      .select('token');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      voided_count: voided ? voided.length : 0,
      voided_tokens: voided ? voided.map(t => t.token) : []
    });
  }

  if (mode === 'void_old') {
    const days = parseInt(req.body.days, 10);
    if (!Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'Valid days required (minimum 1)' });
    }
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const reason = 'unverified for ' + days + '+ days';

    const { data: voided, error } = await supabase
      .from('tags')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        void_reason: reason
      })
      .eq('verified', false)
      .eq('status', 'unclaimed')
      .lt('created_at', cutoff)
      .select('token');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      voided_count: voided ? voided.length : 0,
      voided_tokens: voided ? voided.map(t => t.token) : []
    });
  }

  return res.status(400).json({ error: 'Invalid mode. Expected: verify | void_unverified_in_batch | void_old' });
};
`;
    fs.writeFileSync(file, body, 'utf8');
    validateJs(file);
    ok('verify-tags.js: created with verify / void_unverified_in_batch / void_old modes');
  }
}

// ===========================================================================
// 15.4  admin.html — UI updates
//   - Brighten faint form labels
//   - Override Chrome autofill
//   - Replace finalizeReceive() with new void semantics
//   - Add camera scanner option (html5-qrcode CDN)
//   - Add "Voided" tab in tags panel
// ===========================================================================

log('');
log('15.4  public/admin.html: UI fixes + new verify/void semantics + camera scanner');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  if (content.includes(MARKER_15)) {
    skip('admin.html (already patched)');
  } else {
    let updated = content;

    // 15.4.a — Brighten faint form labels.
    const oldLabel = `.field-label { font-size: 12px; color: var(--text-3); font-weight: 600; }`;
    const newLabel = `.field-label { font-size: 12px; color: var(--text-2); font-weight: 600; } /* ${MARKER_15} */`;
    let r = tryReplace(updated, oldLabel, newLabel);
    if (!r) errExit('admin.html: field-label rule not found');
    updated = r;

    // 15.4.b — Override Chrome autofill on .gen-input and add new styles.
    // Insert just before the closing </style> of the main inline stylesheet.
    // We anchor on .gen-input::placeholder which is line 581.
    const oldPlaceholder = `.gen-input::placeholder { color: var(--text-4); }`;
    const newPlaceholder = `.gen-input::placeholder { color: var(--text-4); }
/* ${MARKER_15}: keep autofill in dark theme */
.gen-input:-webkit-autofill,
.gen-input:-webkit-autofill:hover,
.gen-input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--text);
  -webkit-box-shadow: 0 0 0px 1000px var(--bg-elev) inset;
  caret-color: var(--text);
  transition: background-color 5000s ease-in-out 0s;
}
/* ${MARKER_15}: camera scanner */
.p15-scan-toggle{display:flex;gap:8px;margin-bottom:14px}
.p15-scan-toggle button{flex:1;height:40px;border-radius:var(--r);border:1.5px solid var(--border);background:var(--bg-elev);color:var(--text-2);font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;transition:all .15s}
.p15-scan-toggle button.active{background:var(--brand);color:#fff;border-color:var(--brand)}
.p15-camera-box{display:none;background:#000;border-radius:var(--r);overflow:hidden;margin-bottom:14px;position:relative}
.p15-camera-box.show{display:block}
.p15-camera-box video{width:100%;display:block}
.p15-camera-status{position:absolute;top:8px;left:8px;right:8px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:6px 10px;border-radius:6px;text-align:center}
.p15-voided-list{margin-top:12px}
.p15-voided-item{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px}
.p15-voided-item:last-child{border-bottom:none}
.p15-voided-token{font-family:'SF Mono',Monaco,Consolas,monospace;font-size:13px;color:var(--text-2)}
.p15-voided-meta{font-size:11px;color:var(--text-3);margin-top:2px}`;
    r = tryReplace(updated, oldPlaceholder, newPlaceholder);
    if (!r) errExit('admin.html: placeholder rule not found');
    updated = r;

    // 15.4.c — Add camera scanner toggle UI just before the existing scan-entry div.
    const oldScanEntry = `    <div class="scan-entry">
      <input type="text" class="scan-input" id="scan-token" placeholder="Scan or type token\u2026" onkeydown="if(event.key==='Enter')scanToken()">
      <button class="gen-btn success" onclick="scanToken()">Scan</button>
    </div>`;

    const newScanEntry = `    <!-- ${MARKER_15}: scan mode toggle (manual vs camera) -->
    <div class="p15-scan-toggle">
      <button type="button" id="p15-mode-manual" class="active" onclick="p15SetScanMode('manual')">Type / paste</button>
      <button type="button" id="p15-mode-camera" onclick="p15SetScanMode('camera')">Camera scan</button>
    </div>
    <div class="p15-camera-box" id="p15-camera-box">
      <div class="p15-camera-status" id="p15-camera-status">Starting camera\u2026</div>
      <div id="p15-camera-reader" style="width:100%;min-height:240px"></div>
    </div>
    <div class="scan-entry">
      <input type="text" class="scan-input" id="scan-token" placeholder="Scan or type token\u2026" onkeydown="if(event.key==='Enter')scanToken()">
      <button class="gen-btn success" onclick="scanToken()">Scan</button>
    </div>`;

    r = tryReplace(updated, oldScanEntry, newScanEntry);
    if (!r) errExit('admin.html: scan-entry block not found');
    updated = r;

    // 15.4.d — Replace finalizeReceive() body to call new verify-tags endpoint.
    const oldFinalize = `async function finalizeReceive() {
  if (!currentVerifyBatch) return;
  const batchTokens = batchTokensMap[currentVerifyBatch] || [];
  const unscanned = batchTokens.filter(t => !scannedTokens.has(t.token));

  if (unscanned.length === 0) {
    showToast('All tokens received  nothing to delete!');
    return;
  }`;

    const newFinalize = `async function finalizeReceive() {
  if (!currentVerifyBatch) return;
  // ${MARKER_15}: use new verify-tags endpoint to verify scanned + void unverified
  const batchTokens = batchTokensMap[currentVerifyBatch] || [];
  const scannedArr = Array.from(scannedTokens);
  const unscanned = batchTokens.filter(t => !scannedTokens.has(t.token));

  if (scannedArr.length === 0 && unscanned.length === 0) {
    showToast('Nothing to do.');
    return;
  }`;

    r = tryReplace(updated, oldFinalize, newFinalize);
    if (!r) errExit('admin.html: finalizeReceive opening not found');
    updated = r;

    // Replace the rest of the function body to use verify-tags endpoint.
    const oldFinalizeMid = `  const confirmed = confirm(
    \`Delete \${unscanned.length} unscanned token(s) from Batch \${currentVerifyBatch} ONLY?\\n\\n\` +
    \`Tokens to delete:\\n\${unscanned.map(t => '#' + t.token).join('\\n')}\\n\\n\` +
    \`Other batches are NOT touched. This cannot be undone.\`
  );
  if (!confirmed) return;

  const btn = document.getElementById('finalize-btn');
  btn.textContent = 'Deleting...'; btn.disabled = true;

  let deleted = 0, errors = 0;
  for (const t of unscanned) {
    try {
      const res = await fetch('/api/get-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t.token, user_id: 'admin-delete', status_override: 'deleted' })
      });
      const data = await res.json();
      if (data.success) deleted++; else errors++;
    } catch(e) { errors++; }
  }

  showToast(\`Deleted \${deleted} unscanned tokens from Batch \${currentVerifyBatch}\` + (errors ? \` (\${errors} errors)\` : ''));`;

    const newFinalizeMid = `  const msg = 'Finalize Batch ' + currentVerifyBatch + '?\\n\\n' +
    'Verify ' + scannedArr.length + ' scanned token(s) (will become activatable).\\n' +
    'Void ' + unscanned.length + ' unscanned token(s) (kept for audit, but cannot be activated).\\n\\n' +
    'Other batches are NOT touched.';
  if (!confirm(msg)) return;

  const btn = document.getElementById('finalize-btn');
  btn.textContent = 'Finalizing...'; btn.disabled = true;
  let verifiedCount = 0, voidedCount = 0, errs = 0;

  // Step 1: verify scanned tokens
  if (scannedArr.length > 0) {
    try {
      const res = await fetch('/api/verify-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ mode: 'verify', tokens: scannedArr })
      });
      const data = await res.json();
      if (data.success) verifiedCount = data.verified_count || 0;
      else errs++;
    } catch (e) { errs++; }
  }

  // Step 2: void unverified in this batch
  if (unscanned.length > 0) {
    try {
      const res = await fetch('/api/verify-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ mode: 'void_unverified_in_batch', batch_number: currentVerifyBatch, void_reason: 'not received from manufacturer' })
      });
      const data = await res.json();
      if (data.success) voidedCount = data.voided_count || 0;
      else errs++;
    } catch (e) { errs++; }
  }

  showToast('Verified ' + verifiedCount + ', voided ' + voidedCount + (errs ? ' (' + errs + ' errors)' : ''));`;

    r = tryReplace(updated, oldFinalizeMid, newFinalizeMid);
    if (!r) errExit('admin.html: finalizeReceive body not found');
    updated = r;

    // 15.4.e — Update finalize button text in HTML.
    const oldBtnText = `<button class="danger-btn" id="finalize-btn" onclick="finalizeReceive()" style="display:none" disabled>Finalize \u2014 delete unscanned from this batch only</button>`;
    const newBtnText = `<button class="danger-btn" id="finalize-btn" onclick="finalizeReceive()" style="display:none" disabled>Finalize \u2014 verify scanned, void unverified</button>`;
    if (updated.includes(oldBtnText)) {
      updated = updated.replace(oldBtnText, newBtnText);
    }

    // 15.4.f — Update finalize warning text.
    const oldWarn = `This will permanently delete all unscanned tokens from Batch <strong id="fw-batch"></strong> only. Other batches are NOT affected. Cannot be undone.`;
    const newWarn = `This voids all unscanned tokens from Batch <strong id="fw-batch"></strong> (kept for audit, never activatable). Other batches are NOT affected.`;
    if (updated.includes(oldWarn)) {
      updated = updated.replace(oldWarn, newWarn);
    }

    // 15.4.g — Fix the executeDeleteBatch admin call to pass x-admin-key
    // (since 15.2.a now requires admin auth for status_override='deleted')
    const oldDeleteBatchCall = `      const res = await fetch('/api/get-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t.token, user_id: 'admin-delete', status_override: 'deleted' })
      });`;
    const newDeleteBatchCall = `      const res = await fetch('/api/get-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey } /* ${MARKER_15} */,
        body: JSON.stringify({ token: t.token, user_id: 'admin-delete', status_override: 'deleted' })
      });`;
    if (updated.includes(oldDeleteBatchCall)) {
      updated = updated.replace(oldDeleteBatchCall, newDeleteBatchCall);
    } else {
      const oldCRLF = oldDeleteBatchCall.replace(/\n/g, '\r\n');
      if (updated.includes(oldCRLF)) {
        updated = updated.replace(oldCRLF, newDeleteBatchCall.replace(/\n/g, '\r\n'));
      }
    }

    // 15.4.h — Insert html5-qrcode script + scanner JS at end of body, just before </body>.
    const cameraJs = `
<!-- ${MARKER_15}: camera QR scanner library (loaded only if user opens camera mode) -->
<script>
let p15Html5QrLoaded = false;
let p15Html5QrInstance = null;
function p15LoadQrLib(cb) {
  if (p15Html5QrLoaded) return cb();
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  s.onload = () => { p15Html5QrLoaded = true; cb(); };
  s.onerror = () => { showToast('Could not load camera scanner library'); };
  document.head.appendChild(s);
}
function p15SetScanMode(mode) {
  const btnM = document.getElementById('p15-mode-manual');
  const btnC = document.getElementById('p15-mode-camera');
  const camBox = document.getElementById('p15-camera-box');
  btnM.classList.toggle('active', mode === 'manual');
  btnC.classList.toggle('active', mode === 'camera');
  if (mode === 'camera') {
    camBox.classList.add('show');
    p15LoadQrLib(p15StartCamera);
  } else {
    camBox.classList.remove('show');
    p15StopCamera();
  }
}
function p15StartCamera() {
  if (typeof Html5Qrcode === 'undefined') { showToast('Scanner not loaded'); return; }
  const status = document.getElementById('p15-camera-status');
  status.textContent = 'Point camera at a QR code\u2026';
  if (p15Html5QrInstance) {
    try { p15Html5QrInstance.stop().catch(()=>{}); } catch(e){}
  }
  p15Html5QrInstance = new Html5Qrcode('p15-camera-reader');
  Html5Qrcode.getCameras().then(devices => {
    if (!devices || devices.length === 0) { status.textContent = 'No cameras found'; return; }
    // Prefer back camera
    const cam = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];
    p15Html5QrInstance.start(
      cam.id,
      { fps: 10, qrbox: { width: 240, height: 240 } },
      decodedText => {
        // Each successful scan: drop into the manual input and submit.
        document.getElementById('scan-token').value = decodedText;
        scanToken();
        status.textContent = 'Scanned. Point at next sticker\u2026';
      },
      _err => {} // ignore per-frame decode failures
    ).catch(err => {
      status.textContent = 'Camera error: ' + (err && err.message ? err.message : 'unknown');
    });
  }).catch(err => {
    status.textContent = 'Camera permission denied or unavailable';
  });
}
function p15StopCamera() {
  if (p15Html5QrInstance) {
    try { p15Html5QrInstance.stop().catch(()=>{}); } catch(e){}
    p15Html5QrInstance = null;
  }
}
</script>
</body>`;

    if (updated.includes('</body>')) {
      updated = updated.replace('</body>', cameraJs);
    }

    backup(file);
    writeFile(file, updated);
    ok('admin.html: labels brightened + autofill override + camera scanner + new finalize semantics');
  }
}

// ===========================================================================
// 15.5  contact.html — friendly error for unverified tags
// ===========================================================================

log('');
log('15.5  public/contact.html: friendly error for unverified/voided tags');
{
  // Note: contact.html reads /api/get-tag GET (not POST). The verification gate
  // is on the POST claim path. The GET path returns the tag info regardless of
  // verified status, so contact.html will show the page. The friendly error
  // happens at activate.html when claim is attempted.
  //
  // For now we don't need to modify contact.html — the GET path doesn't expose
  // ownership of an unverified tag because it's still 'unclaimed'. Strangers
  // see "this tag is unclaimed, do you want to claim it?" via the existing
  // unclaimed flow. When they click claim, activate.html POSTs to get-tag and
  // gets our new 403 with the friendly error message.
  //
  // We DO need to update activate.html to handle the new error gracefully.
  log('  \u00b7 contact.html: no changes needed (unverified tags appear as unclaimed; gate is at claim)');
}

// ===========================================================================
// 15.6  activate.html — handle new error from claim
// ===========================================================================

log('');
log('15.6  public/activate.html: handle unverified/voided error from claim');
{
  const file = path.join(PUBLIC, 'activate.html');
  const content = readFile(file);

  if (content.includes(MARKER_15)) {
    skip('activate.html (already patched)');
  } else {
    // Find where the claim error is handled and ensure the unverified/voided
    // messages get surfaced to the user. The claim POST happens in the
    // activateTag/claim function. We do a generic improvement: any error
    // from the claim returns its message to the user as-is.
    //
    // Look for a pattern like `data.error` being shown.
    const probes = [
      `showToast(data.error || 'Activation failed`,
      `alert(data.error || 'Activation failed`,
      `data.error || 'Could not activate`
    ];
    let found = false;
    for (const p of probes) {
      if (content.includes(p)) { found = true; break; }
    }
    if (found) {
      // Existing error handling already shows data.error. Our backend
      // returns a clear message in data.error. So no change needed.
      log('  \u00b7 activate.html: already passes through data.error to user, no change needed');
    } else {
      log('  \u00b7 activate.html: claim error path not detected via standard probes; relying on default error display');
    }
    // Mark file with marker so idempotent re-run is no-op (just a comment near end).
    // Actually, since we don't change anything, skip the marker.
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 15 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==============================================================');
log('STEP 1 - REQUIRED: Run this SQL in Supabase BEFORE deploying');
log('==============================================================');
log('');
log('ALTER TABLE public.tags');
log('  ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,');
log('  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,');
log('  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,');
log('  ADD COLUMN IF NOT EXISTS void_reason TEXT;');
log('');
log('-- Grandfather all existing tokens to verified=true so they keep working.');
log('-- Only NEW tokens generated AFTER deploy will require verification.');
log('UPDATE public.tags');
log('  SET verified = true, verified_at = NOW()');
log('  WHERE verified = false OR verified IS NULL;');
log('');
log('==============================================================');
log('STEP 2 - Deploy');
log('==============================================================');
log('  git add -A');
log('  git commit -m "Patch 15: tag verification gate (anti-fraud)"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('==============================================================');
log('STEP 3 - Test plan');
log('==============================================================');
log('');
log('1. Generate a new test batch:');
log('   - Admin > Generate tab. Generate 3 tokens in batch 99.');
log('   - These will have verified=false');
log('');
log('2. Try to activate ONE without verifying first:');
log('   - Open https://tapmycar.io/tag/TMC-XXXXXX in incognito');
log('   - Sign in / register, fill vehicle, submit');
log('   - Should fail with: "This sticker has not been activated by TapMyCar yet..."');
log('');
log('3. Verify in admin:');
log('   - Admin > Generate > Receive panel');
log('   - Pick batch 99. Type/scan one of the 3 tokens. Click Finalize.');
log('   - That ONE token gets verified, the other 2 get voided.');
log('');
log('4. Activate the verified one:');
log('   - Open the verified TMC- URL in incognito');
log('   - Sign in, activate. Should succeed.');
log('');
log('5. Try to activate a voided one:');
log('   - Open one of the 2 voided TMC- URLs in incognito');
log('   - Should fail with: "This sticker has been voided..."');
log('');
log('6. Camera scan:');
log('   - Admin > Generate > Receive panel.');
log('   - Click "Camera scan". Allow camera access.');
log('   - Hold a TMC- QR code in front of camera. Should auto-scan.');
log('');
log('7. SQL sanity check after testing:');
log('   SELECT token, status, verified, verified_at, voided_at, void_reason');
log('   FROM tags WHERE batch_number = 99;');
log('==============================================================');
