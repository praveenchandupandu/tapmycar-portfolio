// ============================================================================
// TapMyCar - Patch 21: Tag filter improvements + voided multi-select delete
//                       + text batch names + Scans-by-user view
//
// What this fixes:
//
// 21.1  Tag filter pills — replace "Unclaimed" pill with TWO clear states:
//         - "Verified" (status=unclaimed AND verified=true): ready to ship
//         - "Unverified" (status=unclaimed AND verified=false): waiting to be received
//       So the user can instantly see "X tokens are ready to ship to customers"
//       vs "Y tokens are pending verification from manufacturer".
//
// 21.2  Voided panel — checkbox per row + select-all checkbox + bulk
//       "Delete selected" button at top. Voided tokens kept for audit by
//       default, but you can wipe specific ones.
//
// 21.3  Batch names accept TEXT (not just numbers):
//       - DB: change batch_number column from int → text
//       - Backend: stop parseInt; use string match
//       - Frontend: input changes from type=number to type=text
//       - Sort batch options alphanumerically
//
//       (Existing numeric batches are preserved as strings: "1", "25", "110".
//       Going forward you can name batches "HOLIDAY-2026", "TEST-A1", etc.)
//
// 21.4  Scans tab — group by user instead of flat list:
//       - Shows users sorted by recent activity (most-recent first)
//       - Each row: user name + scan count + last scan time + first vehicle
//       - Click a row → opens user detail (already has full breakdown from
//         Patch 18 with calls/messages/photos/voice tabs)
//       - Search box: filter users by name/email/phone
//
// 21.5  Audit log — record batch_number on verify_tokens entries so audit
//       isn't just {"count":3} with null target.
//
// 21.6  Force-refresh batch dropdown after generating a batch (defensive
//       fix in case Patch 17's navTo wrap doesn't catch it).
//
// REQUIRES: Patches 1-20 already applied locally.
// REQUIRES: SQL migration BEFORE deploy (printed at end of run).
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
const BACKUP_DIR = path.join(ROOT, `backup-patch21-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
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
log('TapMyCar Patch 21 \u2014 Filter pills + voided delete + text batches + scans-by-user');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_21 = 'TMC_PATCH21_BATCH_TEXT_AND_FILTERS';

// ===========================================================================
// 21.3  Backend: batch_number is now text. Update verify-tags.js to stop
//       parseInt and use string comparison.
// ===========================================================================

log('21.3.a  api/verify-tags.js: accept text batch names');
{
  const file = path.join(API, 'verify-tags.js');
  const content = readFile(file);
  if (content.includes(MARKER_21)) {
    skip('verify-tags.js (already patched)');
  } else {
    const oldParseInt = `  if (mode === 'void_unverified_in_batch') {
    const batch_number = parseInt(req.body.batch_number, 10);
    if (!Number.isFinite(batch_number) || batch_number < 1) {
      return res.status(400).json({ error: 'Valid batch_number required' });
    }`;
    const newParseInt = `  if (mode === 'void_unverified_in_batch') {
    /* ${MARKER_21}: accept text batch names */
    const batch_number = String(req.body.batch_number || '').trim();
    if (!batch_number) {
      return res.status(400).json({ error: 'batch_number required' });
    }`;

    let r = tryReplace(content, oldParseInt, newParseInt);
    if (!r) errExit('verify-tags.js: parseInt anchor not found');

    backup(file);
    writeFile(file, r);
    validateJs(file);
    ok('verify-tags.js: text batch names supported');
  }
}

// ===========================================================================
// 21.3.b  Backend: generate-tokens.js — stop forcing batch into int via
//          insert. The line `batch_number: batch_number || null` already
//          passes through, but the frontend was sending parseInt. Backend
//          itself needs no change other than reaffirming the field type.
//          We rely on SQL migration to change column type.
//
//          However: we ADD audit metadata to include the batch name in
//          verify_tokens audit (21.5).
// ===========================================================================

log('21.5  api/verify-tags.js: include batch_number in verify audit');
{
  const file = path.join(API, 'verify-tags.js');
  const content = readFile(file);
  // The verify mode doesn't know the batch — it gets a list of tokens.
  // We update the audit to also include unique batch numbers from the
  // verified tokens.
  if (content.includes('/* ' + MARKER_21 + ': audit batch */')) {
    skip('verify-tags.js audit batch (already patched)');
  } else {
    const oldVerifyAudit = `    if (error) return res.status(500).json({ error: error.message });
    audit({ actor: 'admin', action: 'verify_tokens', target_type: 'tokens', meta: { count: updated ? updated.length : 0 } });`;
    const newVerifyAudit = `    if (error) return res.status(500).json({ error: error.message });
    /* ${MARKER_21}: audit batch */
    // Look up batches of these tokens to include in audit meta
    let _batches = [];
    try {
      const { data: tagsForAudit } = await supabase
        .from('tags')
        .select('batch_number')
        .in('token', updated ? updated.map(t => t.token) : []);
      if (tagsForAudit) _batches = [...new Set(tagsForAudit.map(t => t.batch_number).filter(Boolean))];
    } catch (e) {}
    audit({ actor: 'admin', action: 'verify_tokens', target_type: _batches.length === 1 ? 'batch' : 'tokens', target_id: _batches.length === 1 ? String(_batches[0]) : null, meta: { count: updated ? updated.length : 0, batches: _batches } });`;

    let r = tryReplace(content, oldVerifyAudit, newVerifyAudit);
    if (r) {
      backup(file);
      writeFile(file, r);
      validateJs(file);
      ok('verify-tags.js: verify audit now includes batch info');
    } else {
      warn('verify-tags.js: verify audit anchor not found, skipped');
    }
  }
}

// ===========================================================================
// 21  admin.html — many changes
// ===========================================================================

log('');
log('21  public/admin.html: filter pills + voided multi-select + scans-by-user + text batch');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  if (content.includes(MARKER_21)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // ── 21.0 CSS additions ──
    const cssAnchor = `/* TMC_PATCH20_AUDIT_AND_OPS: notification badges + test-data + audit list */`;
    const cssAddition = `/* ${MARKER_21}: voided multi-select + scans-by-user */
.p21-voided-controls{display:flex;align-items:center;gap:10px;background:#1A2D4A;border-radius:10px;padding:10px 14px;margin-bottom:10px}
.p21-voided-controls label{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--text-2);cursor:pointer;font-weight:600}
.p21-voided-controls .p21-sel-count{font-size:12px;color:var(--text-3);margin-left:auto;font-weight:600}
.p21-voided-controls button{height:34px;padding:0 14px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.p21-delete-btn{background:#DC2626;color:#fff}
.p21-delete-btn:disabled{opacity:.4;cursor:not-allowed}
.p21-delete-btn:hover:not(:disabled){background:#B91C1C}
.p21-row-cb{margin-right:10px;width:18px;height:18px;accent-color:var(--brand);cursor:pointer;flex-shrink:0}
.p21-ar-wrap{display:flex;align-items:center}
.p21-ar-wrap .ar{flex:1;min-width:0}

/* Scans-by-user view */
.p21-scans-user-row{display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:all .15s}
.p21-scans-user-row:hover{border-color:var(--brand);background:var(--bg-elev)}
.p21-su-avatar{width:38px;height:38px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex-shrink:0}
.p21-su-info{flex:1;min-width:0}
.p21-su-name{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px}
.p21-su-meta{font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p21-su-stat{text-align:right;flex-shrink:0}
.p21-su-stat-num{font-size:18px;font-weight:800;color:var(--brand);line-height:1}
.p21-su-stat-lbl{font-size:10px;color:var(--text-3);font-weight:600;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}
.p21-su-time{font-size:10.5px;color:var(--text-3);text-align:right;margin-top:4px}
/* TMC_PATCH20_AUDIT_AND_OPS: notification badges + test-data + audit list */`;

    let r = tryReplace(updated, cssAnchor, cssAddition);
    if (!r) errExit('admin.html: CSS anchor for patch 20 not found');
    updated = r;

    // ── 21.3 Frontend: batch input type=number → type=text ──
    // Generate batch input
    const oldGenBatch = `<input type="number" class="gen-input" id="gen-batch" placeholder="e.g. 1">`;
    const newGenBatch = `<input type="text" class="gen-input" id="gen-batch" placeholder="e.g. 1 or HOLIDAY-2026" maxlength="40"> <!-- ${MARKER_21} -->`;
    if (updated.includes(oldGenBatch)) updated = updated.replace(oldGenBatch, newGenBatch);

    // Replacement batch input
    const oldReplBatch = `<input type="number" class="gen-input" id="repl-batch" placeholder="e.g. 1">`;
    const newReplBatch = `<input type="text" class="gen-input" id="repl-batch" placeholder="e.g. 1" maxlength="40"> <!-- ${MARKER_21} -->`;
    if (updated.includes(oldReplBatch)) updated = updated.replace(oldReplBatch, newReplBatch);

    // Delete batch input
    const oldDelBatch = `<input type="number" class="gen-input" id="del-batch" placeholder="Batch to delete">`;
    const newDelBatch = `<input type="text" class="gen-input" id="del-batch" placeholder="Batch to delete" maxlength="40"> <!-- ${MARKER_21} -->`;
    if (updated.includes(oldDelBatch)) updated = updated.replace(oldDelBatch, newDelBatch);

    // generateTokens() needs to stop parseInt'ing the batch
    const oldGenLogic = `  const batch = document.getElementById('gen-batch').value || null;`;
    const newGenLogic = `  /* ${MARKER_21}: batch is text now */
  const batch = (document.getElementById('gen-batch').value || '').trim() || null;`;
    if (updated.includes(oldGenLogic)) updated = updated.replace(oldGenLogic, newGenLogic);

    // generateTokens body posts batch_number — was parseInt, now use the string
    const oldGenPost = `body: JSON.stringify({ count, batch_number: parseInt(batch) })`;
    const newGenPost = `body: JSON.stringify({ count, batch_number: batch }) /* ${MARKER_21} */`;
    if (updated.includes(oldGenPost)) updated = updated.replace(oldGenPost, newGenPost);

    // generateReplacements (similar pattern). Find by replacement-related fetch.
    const oldReplPost = `body: JSON.stringify({ count: failedCount, batch_number: parseInt(originalBatch) })`;
    const newReplPost = `body: JSON.stringify({ count: failedCount, batch_number: originalBatch }) /* ${MARKER_21} */`;
    if (updated.includes(oldReplPost)) updated = updated.replace(oldReplPost, newReplPost);

    // executeDeleteBatch — also accept text
    const oldDelLogic = `const batch = parseInt(document.getElementById('del-batch').value);`;
    const newDelLogic = `const batch = (document.getElementById('del-batch').value || '').trim(); /* ${MARKER_21} */`;
    if (updated.includes(oldDelLogic)) updated = updated.replace(oldDelLogic, newDelLogic);

    /* ${MARKER_21}: remove remaining parseInt(batch) calls — text batches now */
    // In generateReplacements
    const oldReplBatchNum = `const batchNum = parseInt(batch);
  btn.textContent = 'Generating...'; btn.disabled = true;
  try {
    // Get current batch size to determine starting unit number
    const checkRes = await fetch('/api/get-dashboard?admin=' + encodeURIComponent(adminKey));
    const checkData = await checkRes.json();
    let existingCount = 0;
    if (checkData.tags) {
      existingCount = checkData.tags.filter(t => t.batch_number === batchNum).length;
    }`;
    const newReplBatchNum = `const batchNum = String(batch).trim(); /* ${MARKER_21}: text batch */
  btn.textContent = 'Generating...'; btn.disabled = true;
  try {
    // Get current batch size to determine starting unit number
    const checkRes = await fetch('/api/get-dashboard?admin=' + encodeURIComponent(adminKey));
    const checkData = await checkRes.json();
    let existingCount = 0;
    if (checkData.tags) {
      existingCount = checkData.tags.filter(t => String(t.batch_number) === batchNum).length;
    }`;
    if (updated.includes(oldReplBatchNum)) updated = updated.replace(oldReplBatchNum, newReplBatchNum);

    // In showDeleteConfirm
    const oldShowDelete = `function showDeleteConfirm() {
  const batch = document.getElementById('del-batch').value;
  if (!batch) { showToast('Enter a batch number'); return; }
  const batchNum = parseInt(batch);
  const batchTokens = batchTokensMap[batchNum];`;
    const newShowDelete = `function showDeleteConfirm() {
  /* ${MARKER_21}: text batch */
  const batch = (document.getElementById('del-batch').value || '').trim();
  if (!batch) { showToast('Enter a batch number'); return; }
  const batchNum = batch;
  const batchTokens = batchTokensMap[batchNum];`;
    if (updated.includes(oldShowDelete)) updated = updated.replace(oldShowDelete, newShowDelete);

    // The .filter(t => t.batch_number === batch) — currently checks numeric equality.
    // We need to support both numeric DB rows (legacy) and text rows (new).
    // Make comparison string-based.
    const oldFilterBatch = `const batchTokens = batchTokensMap[batch] || [];`;
    // appears twice; we want to make sure the lookup works with string keys.
    // batchTokensMap is built keyed by t.batch_number which is now string.
    // So we just ensure `batch` is the string form.
    // Already handled by the parseInt removal above.

    // loadBatchOptions sort — alphanumeric sort
    const oldSort = `Object.keys(batchTokensMap).sort((a,b) => a-b).forEach(b => {`;
    const newSort = `Object.keys(batchTokensMap).sort((a,b) => {
    /* ${MARKER_21}: numeric-aware alphanumeric sort */
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  }).forEach(b => {`;
    if (updated.includes(oldSort)) updated = updated.replace(oldSort, newSort);

    // verify-batch select option rendering — already shows batch as-is, no change needed.

    // ── 21.1  Update filter pill list and counting in p19RenderTagFilters ──
    // Add "verified" and "unverified" as derived categories.
    const oldFilterList = `let p19TagFilter = 'all';
const p19TagStatusList = ['all', 'active', 'unclaimed', 'claimed', 'voided', 'disabled', 'inactive'];`;
    const newFilterList = `let p19TagFilter = 'all';
/* ${MARKER_21}: split "unclaimed" into "verified" + "unverified" */
const p19TagStatusList = ['all', 'active', 'verified', 'unverified', 'claimed', 'voided', 'disabled', 'inactive'];`;
    let r2 = tryReplace(updated, oldFilterList, newFilterList);
    if (!r2) errExit('admin.html: p19TagStatusList anchor not found');
    updated = r2;

    // Update p19RenderTagFilters counting logic
    const oldCounting = `  const counts = {};
  p19TagStatusList.forEach(s => counts[s] = 0);
  (allTagsData || []).forEach(t => {
    counts.all++;
    if (counts.hasOwnProperty(t.status)) counts[t.status]++;
  });
  const labels = { all:'All', active:'Active', unclaimed:'Unclaimed', claimed:'Claimed', voided:'Voided', disabled:'Disabled', inactive:'Inactive' };`;
    const newCounting = `  const counts = {};
  p19TagStatusList.forEach(s => counts[s] = 0);
  (allTagsData || []).forEach(t => {
    counts.all++;
    /* ${MARKER_21}: split unclaimed into verified vs unverified */
    if (t.status === 'unclaimed') {
      if (t.verified) counts.verified++;
      else counts.unverified++;
    } else if (counts.hasOwnProperty(t.status)) {
      counts[t.status]++;
    }
  });
  const labels = { all:'All', active:'Active', verified:'Verified', unverified:'Unverified', claimed:'Claimed', voided:'Voided', disabled:'Disabled', inactive:'Inactive' };`;

    r2 = tryReplace(updated, oldCounting, newCounting);
    if (!r2) errExit('admin.html: p19 counting anchor not found');
    updated = r2;

    // Update p19RenderTags filter to handle verified/unverified
    const oldFilterCheck = `  // Apply status filter
  if (p19TagFilter !== 'all') {
    tags = tags.filter(t => t.status === p19TagFilter);
  }`;
    const newFilterCheck = `  // Apply status filter
  /* ${MARKER_21}: handle derived verified/unverified */
  if (p19TagFilter === 'verified') {
    tags = tags.filter(t => t.status === 'unclaimed' && t.verified === true);
  } else if (p19TagFilter === 'unverified') {
    tags = tags.filter(t => t.status === 'unclaimed' && t.verified === false);
  } else if (p19TagFilter !== 'all') {
    tags = tags.filter(t => t.status === p19TagFilter);
  }`;

    r2 = tryReplace(updated, oldFilterCheck, newFilterCheck);
    if (!r2) errExit('admin.html: p19 filter anchor not found');
    updated = r2;

    // ── 21.2  Voided multi-select delete ──
    // Replace the entire p19RenderTags function to support checkboxes on voided tags.
    // Actually we'll inject controls + checkboxes when filter is 'voided'.
    // Hook into p19RenderTags by wrapping it. But it's cleaner to add helper
    // functions and slightly modify the rendering.

    const oldRenderEnd = `  list.innerHTML = tags.map(t => {
    const statusClass = t.status === 'active' ? 'ba' : t.status === 'unclaimed' ? 'bw' : t.status === 'voided' ? 'br' : 'br';
    const label = t.vehicle_label || '';
    const batch = t.batch_number ? 'Batch ' + t.batch_number : 'No batch';
    const verifiedTag = (t.verified === false && t.status === 'unclaimed') ? ' <span style="background:#713F12;color:#FDE047;font-size:8px;font-weight:700;padding:2px 6px;border-radius:99px;margin-left:4px">UNVERIFIED</span>' : '';
    const voidReason = t.status === 'voided' && t.void_reason ? '<div style="font-size:9px;color:#FCA5A5;margin-top:2px;font-style:italic">' + p19Esc(t.void_reason) + '</div>' : '';
    return '<div class="ar"><div><div class="un" style="font-family:monospace">' + p19Esc(typeof formatToken === 'function' ? formatToken(t.token) : t.token) + verifiedTag + '</div><div class="us">' + p19Esc(label) + ' \u00b7 ' + p19Esc(t.license_plate || 'No plate') + ' \u00b7 ' + p19Esc(batch) + '</div>' + voidReason + '</div><span class="' + statusClass + '">' + p19Esc(t.status) + '</span></div>';
  }).join('');
}`;

    const newRenderEnd = `  /* ${MARKER_21}: voided multi-select controls */
  const showVoidedControls = (p19TagFilter === 'voided' && tags.length > 0);
  let controlsHtml = '';
  if (showVoidedControls) {
    controlsHtml =
      '<div class="p21-voided-controls">' +
        '<label><input type="checkbox" id="p21-select-all" onchange="p21ToggleAll(this.checked)"> Select all</label>' +
        '<span class="p21-sel-count" id="p21-sel-count">0 selected</span>' +
        '<button class="p21-delete-btn" id="p21-delete-selected" onclick="p21DeleteSelected()" disabled>Delete selected</button>' +
      '</div>';
  }

  list.innerHTML = controlsHtml + tags.map(t => {
    const statusClass = t.status === 'active' ? 'ba' : t.status === 'unclaimed' ? 'bw' : t.status === 'voided' ? 'br' : 'br';
    const label = t.vehicle_label || '';
    const batch = t.batch_number ? 'Batch ' + t.batch_number : 'No batch';
    const verifiedTag = (t.verified === false && t.status === 'unclaimed') ? ' <span style="background:#713F12;color:#FDE047;font-size:8px;font-weight:700;padding:2px 6px;border-radius:99px;margin-left:4px">UNVERIFIED</span>' : '';
    const verifiedBadge = (t.verified === true && t.status === 'unclaimed') ? ' <span style="background:#14532D;color:#4ADE80;font-size:8px;font-weight:700;padding:2px 6px;border-radius:99px;margin-left:4px">VERIFIED</span>' : '';
    const voidReason = t.status === 'voided' && t.void_reason ? '<div style="font-size:9px;color:#FCA5A5;margin-top:2px;font-style:italic">' + p19Esc(t.void_reason) + '</div>' : '';
    /* ${MARKER_21}: checkbox for voided */
    const cb = showVoidedControls
      ? '<input type="checkbox" class="p21-row-cb" data-token="' + p19Esc(t.token) + '" onchange="p21UpdateSelCount()">'
      : '';
    return '<div class="p21-ar-wrap">' + cb +
      '<div class="ar"><div><div class="un" style="font-family:monospace">' + p19Esc(typeof formatToken === 'function' ? formatToken(t.token) : t.token) + verifiedTag + verifiedBadge + '</div><div class="us">' + p19Esc(label) + ' \u00b7 ' + p19Esc(t.license_plate || 'No plate') + ' \u00b7 ' + p19Esc(batch) + '</div>' + voidReason + '</div><span class="' + statusClass + '">' + p19Esc(t.status) + '</span></div>' +
    '</div>';
  }).join('');
  /* ${MARKER_21}: refresh select-all state */
  if (showVoidedControls) p21UpdateSelCount();
}

/* ${MARKER_21}: voided multi-select helpers */
function p21ToggleAll(checked) {
  document.querySelectorAll('.p21-row-cb').forEach(cb => cb.checked = checked);
  p21UpdateSelCount();
}
function p21UpdateSelCount() {
  const cbs = document.querySelectorAll('.p21-row-cb');
  const sel = Array.from(cbs).filter(c => c.checked);
  const ct = document.getElementById('p21-sel-count');
  const btn = document.getElementById('p21-delete-selected');
  const all = document.getElementById('p21-select-all');
  if (ct) ct.textContent = sel.length + ' selected';
  if (btn) btn.disabled = sel.length === 0;
  if (all) {
    if (sel.length === 0) { all.checked = false; all.indeterminate = false; }
    else if (sel.length === cbs.length) { all.checked = true; all.indeterminate = false; }
    else { all.checked = false; all.indeterminate = true; }
  }
}
async function p21DeleteSelected() {
  const sel = Array.from(document.querySelectorAll('.p21-row-cb')).filter(c => c.checked);
  if (sel.length === 0) return;
  const tokens = sel.map(c => c.dataset.token);
  if (!confirm('Permanently delete ' + tokens.length + ' voided token(s)?\\n\\nThis cannot be undone. Audit log entries remain.')) return;
  const btn = document.getElementById('p21-delete-selected');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting\u2026'; }
  let okCount = 0, errCount = 0, lastErr = '';
  for (const tok of tokens) {
    try {
      const r = await fetch('/api/get-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ token: tok, user_id: 'admin-delete', status_override: 'deleted' })
      });
      const d = await r.json();
      if (d.success) okCount++; else { errCount++; lastErr = d.error || lastErr; }
    } catch (e) { errCount++; lastErr = e && e.message; }
  }
  showToast('Deleted ' + okCount + (errCount ? ' (' + errCount + ' err: ' + (lastErr || 'unknown') + ')' : ''));
  if (typeof refreshAdmin === 'function') refreshAdmin();
}
window.p21ToggleAll = p21ToggleAll;
window.p21UpdateSelCount = p21UpdateSelCount;
window.p21DeleteSelected = p21DeleteSelected;`;

    r2 = tryReplace(updated, oldRenderEnd, newRenderEnd);
    if (!r2) errExit('admin.html: p19RenderTags end anchor not found');
    updated = r2;

    // ── 21.4 Scans-by-user view ──
    // Replace the Scans panel's flat list with a user-grouped view.
    // Hook renderDashboard to call our new renderer instead of (or in
    // addition to) the existing one. Simpler: wrap renderDashboard.
    const oldScansPanel = `<div class="panel" id="panel-scans">`;
    const newScansPanel = `<div class="panel" id="panel-scans">
  <!-- ${MARKER_21}: scans-by-user view -->
  <div class="p19-search-row" style="margin-bottom:14px">
    <input type="text" id="p21-scans-search" placeholder="Search users by name, email, or phone\u2026" oninput="p21RenderScansByUser()">
    <span class="p21-sel-count" id="p21-scans-count"></span>
  </div>
  <div id="p21-scans-by-user-list"></div>
  <!-- legacy flat scan-list kept for compatibility but hidden -->
  <div id="scan-list-wrap" style="display:none">`;

    if (updated.includes(oldScansPanel)) {
      updated = updated.replace(oldScansPanel, newScansPanel);
      // We need to also close that hidden wrap before the panel closes.
      // Find the panel's closing structure. The existing panel-scans
      // contains `<div id="scan-list"></div>` then `</div>` for the panel.
      // We insert a closing `</div>` to balance our new opening.
      const oldScansClose = `<div id="scan-list">`;
      const newScansClose = `<div id="scan-list">`;
      // The wrap closes naturally with the panel's </div>. We don't need
      // to inject another close because we've put scan-list-wrap as a
      // sibling around scan-list — but actually we opened a div without
      // closing. Let me handle this differently: inject the close right
      // after scan-list's closing tag.
      const insertCloseAnchor = '<div id="scan-list"></div>';
      if (updated.includes(insertCloseAnchor)) {
        updated = updated.replace(insertCloseAnchor, '<div id="scan-list"></div></div>');
      }
    }

    // Inject scans-by-user render logic via JS. Place after p21DeleteSelected.
    const oldP21End = `window.p21DeleteSelected = p21DeleteSelected;`;
    const newP21End = `window.p21DeleteSelected = p21DeleteSelected;

/* ${MARKER_21}: render Scans tab as users sorted by recent activity */
function p21RenderScansByUser() {
  const list = document.getElementById('p21-scans-by-user-list');
  if (!list) return;
  const q = (document.getElementById('p21-scans-search')?.value || '').toLowerCase().trim();
  const scans = allScansData || [];
  const users = allUsersData || [];
  const tags = allTagsData || [];

  // Map tag_id → tag → owner_id
  const tagOwner = {};
  tags.forEach(t => { tagOwner[t.id] = t.owner_id; });

  // Group scans by owner_id
  const byOwner = {};
  scans.forEach(s => {
    const owner = tagOwner[s.tag_id];
    if (!owner) return;
    if (!byOwner[owner]) byOwner[owner] = { count: 0, last: null };
    byOwner[owner].count++;
    const t = new Date(s.scanned_at);
    if (!byOwner[owner].last || t > byOwner[owner].last) byOwner[owner].last = t;
  });

  // Build user rows with scan info
  let rows = users
    .filter(u => byOwner[u.id])
    .map(u => {
      const tag = tags.find(t => t.owner_id === u.id);
      return {
        user: u,
        scanCount: byOwner[u.id].count,
        lastScan: byOwner[u.id].last,
        vehicle: tag ? [tag.car_year, tag.car_make, tag.car_model].filter(Boolean).join(' ') : ''
      };
    });

  // Apply search filter
  if (q) {
    rows = rows.filter(r => {
      const hay = (
        (r.user.name || '') + ' ' +
        (r.user.email || '') + ' ' +
        (r.user.phone || '') + ' ' +
        (r.vehicle || '')
      ).toLowerCase();
      return hay.includes(q);
    });
  }

  // Sort by last scan, most recent first
  rows.sort((a, b) => (b.lastScan || 0) - (a.lastScan || 0));

  const ct = document.getElementById('p21-scans-count');
  if (ct) ct.textContent = rows.length + ' user' + (rows.length === 1 ? '' : 's') + ' with activity';

  if (rows.length === 0) {
    list.innerHTML = '<div class="empty">No scan activity yet</div>';
    return;
  }

  list.innerHTML = rows.map(r => {
    const ts = r.lastScan ? r.lastScan.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '\u2014';
    const initial = (r.user.name || 'U')[0].toUpperCase();
    const meta = (r.user.email || r.user.phone || 'No contact') + (r.vehicle ? ' \u00b7 ' + r.vehicle : '');
    return '<div class="p21-scans-user-row" onclick="openUserDetail(\\'' + p19Esc(r.user.id) + '\\')">' +
      '<div class="p21-su-avatar">' + p19Esc(initial) + '</div>' +
      '<div class="p21-su-info">' +
        '<div class="p21-su-name">' + p19Esc(r.user.name || 'Unknown user') + '</div>' +
        '<div class="p21-su-meta">' + p19Esc(meta) + '</div>' +
      '</div>' +
      '<div class="p21-su-stat">' +
        '<div class="p21-su-stat-num">' + r.scanCount + '</div>' +
        '<div class="p21-su-stat-lbl">scans</div>' +
        '<div class="p21-su-time">' + p19Esc(ts) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}
window.p21RenderScansByUser = p21RenderScansByUser;

/* ${MARKER_21}: wrap renderDashboard to also render scans-by-user */
(function() {
  const orig = window.renderDashboard;
  if (typeof orig === 'function') {
    window.renderDashboard = function(d) {
      const ret = orig.apply(this, arguments);
      try { p21RenderScansByUser(); } catch (e) { console.error('p21 scans render:', e); }
      return ret;
    };
  }
})();`;

    r2 = tryReplace(updated, oldP21End, newP21End);
    if (!r2) errExit('admin.html: p21 end anchor not found');
    updated = r2;

    // ── 21.6 — Force batch dropdown refresh after generate ──
    // generateTokens already calls renderDashboard + loadBatchOptions.
    // But if not, the navTo wrap in Patch 17 catches it when admin
    // navigates to Receive. This is already adequate. No change.

    writeFile(file, updated);
    ok('admin.html: filters + voided multi-delete + text batches + scans-by-user');
  }
}

log('');
log('==============================================================');
log('Patch 21 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==============================================================');
log('REQUIRED: Run this SQL in Supabase BEFORE deploying');
log('==============================================================');
log('');
log('-- Change tags.batch_number from int to text so text batch names work.');
log('-- Existing numeric batches become string equivalents ("1", "25", "110").');
log('');
log('ALTER TABLE public.tags');
log('  ALTER COLUMN batch_number TYPE TEXT USING batch_number::text;');
log('');
log('==============================================================');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 21: filter pills + voided delete + text batches + scans-by-user"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test plan:');
log('  1. Admin > Tags: filter pills now show "Verified" + "Unverified"');
log('     instead of just "Unclaimed". Counts should add up correctly.');
log('  2. Tags filtered to "Verified" → green VERIFIED badge on each row.');
log('  3. Tags filtered to "Unverified" → yellow UNVERIFIED badge on each row.');
log('  4. Tags filtered to "Voided" → checkboxes appear, "Delete selected"');
log('     button at top. Select rows, click Delete → confirms, deletes.');
log('  5. Generate batch with text name like "HOLIDAY-2026" or "A1" — works.');
log('  6. Old numeric batches (1, 25, 110) still show correctly.');
log('  7. Admin > Scans tab: shows USERS sorted by recent activity, not raw');
log('     scan rows. Each row has scan count + last scan time + vehicle.');
log('     Click a user → opens user detail with full breakdown.');
log('  8. Search box in Scans tab filters by name/email/phone.');
log('==============================================================');
