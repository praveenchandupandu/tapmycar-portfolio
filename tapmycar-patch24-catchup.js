// ============================================================================
// TapMyCar - Patch 24: Catch-up patch
//   - Adds the missing p21ManualVoidUnverified function + Receive button
//   - Properly applies what Patch 23 was supposed to do (home alerts + guards)
//
// Background: Patch 21 was iterated mid-development. The earlier version
// patched user's admin.html, leaving the MARKER_21 in place. When the later
// version added the manual-void code, idempotency-by-marker silently skipped
// it. This patch fills the gap.
//
// What ends up in admin.html after this patch:
//   - p21ManualVoidUnverified() — manually voids unverified tokens in a batch
//   - "Void all unverified in this batch (no scan needed)" button in Receive
//   - CSS + HTML + JS for home-tab quick-action alerts
//   - p20UpdateBadges guarded so it doesn't fire before admin is signed in
//
// Properties: idempotent. Safe to re-run.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch24-${ts}`);

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
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 24 \u2014 catch-up: missing manual-void + Patch 23');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_24 = 'TMC_PATCH24_CATCHUP';

{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  // We split this patch into 4 small independent steps. Each step has its own
  // marker so we can re-run and skip individual completed steps.
  let updated = content;
  let anyChange = false;

  // ── 24.1 Insert manual-void button into Receive panel ──
  const M_BUTTON = MARKER_24 + '_BTN';
  if (updated.includes(M_BUTTON)) {
    skip('Receive manual-void button');
  } else {
    const anchor = `    <button class="danger-btn" id="finalize-btn" onclick="finalizeReceive()" style="display:none" disabled>Finalize \u2014 verify scanned, void unverified</button>`;
    const replacement = `    <button class="danger-btn" id="finalize-btn" onclick="finalizeReceive()" style="display:none" disabled>Finalize \u2014 verify scanned, void unverified</button>
    <!-- ${M_BUTTON}: manual void unverified for current batch -->
    <button type="button" id="p21-manual-void-btn" onclick="p21ManualVoidUnverified()" style="display:none;background:transparent;border:1.5px dashed #FCA5A5;color:#FCA5A5;font-size:11.5px;font-weight:600;padding:9px 14px;border-radius:10px;cursor:pointer;font-family:inherit;margin-top:10px;width:100%">Void all unverified in this batch (no scan needed)</button>`;

    const r = tryReplace(updated, anchor, replacement);
    if (!r) {
      warn('Receive: finalize-btn anchor not found, manual-void button NOT added');
    } else {
      updated = r;
      anyChange = true;
      ok('Manual-void button added to Receive panel');
    }
  }

  // ── 24.2 Show button when batch is loaded ──
  const M_LOAD = MARKER_24 + '_LOAD';
  if (updated.includes(M_LOAD)) {
    skip('loadBatchForVerify show-button hook');
  } else {
    // Find inside loadBatchForVerify. The function sets finalize-btn.style.display = 'block'.
    const anchor = `  document.getElementById('finalize-btn').style.display = 'block';
  document.getElementById('finalize-btn').disabled = true;`;
    const replacement = `  document.getElementById('finalize-btn').style.display = 'block';
  document.getElementById('finalize-btn').disabled = true;
  /* ${M_LOAD}: show manual void button when batch is loaded */
  const _mvBtn = document.getElementById('p21-manual-void-btn');
  if (_mvBtn) _mvBtn.style.display = 'block';`;

    const r = tryReplace(updated, anchor, replacement);
    if (!r) {
      warn('loadBatchForVerify anchor not found, button will not auto-show');
    } else {
      updated = r;
      anyChange = true;
      ok('loadBatchForVerify hooked to show manual-void button');
    }
  }

  // ── 24.3 Add p21ManualVoidUnverified function ──
  // Anchor on the very real window.p21RenderScansByUser line (count: 4 confirmed).
  const M_FN = MARKER_24 + '_FN';
  if (updated.includes(M_FN)) {
    skip('p21ManualVoidUnverified function');
  } else {
    // Add the function ONCE — at the first occurrence of the anchor.
    const anchor = `window.p21RenderScansByUser = p21RenderScansByUser;`;
    const replacement = `window.p21RenderScansByUser = p21RenderScansByUser;

/* ${M_FN}: manual force-void for current batch */
async function p21ManualVoidUnverified() {
  if (!currentVerifyBatch) { showToast('Select a batch first'); return; }
  if (!confirm('Void all UNVERIFIED tokens in Batch ' + currentVerifyBatch + '?\\n\\nThis affects ONLY tokens with verified=false in that batch. Verified tokens are not touched.')) return;
  try {
    const res = await fetch('/api/verify-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ mode: 'void_unverified_in_batch', batch_number: String(currentVerifyBatch), void_reason: 'manual void (admin)' })
    });
    const d = await res.json();
    if (d.success) {
      showToast('Voided ' + (d.voided_count || 0) + ' unverified token(s) in Batch ' + currentVerifyBatch);
      if (typeof refreshAdmin === 'function') refreshAdmin();
    } else {
      showToast('Failed: ' + (d.error || 'unknown'));
    }
  } catch (e) {
    showToast('Network error: ' + (e && e.message));
  }
}
window.p21ManualVoidUnverified = p21ManualVoidUnverified;`;

    const r = tryReplace(updated, anchor, replacement);
    if (!r) {
      warn('p21RenderScansByUser anchor not found, function NOT added');
    } else {
      updated = r;
      anyChange = true;
      ok('p21ManualVoidUnverified function added');
    }
  }

  // ── 24.4 Home-tab quick-action alerts (CSS + container + render fn) ──
  const M_ALERTS = MARKER_24 + '_ALERTS';
  if (updated.includes(M_ALERTS)) {
    skip('Home quick-action alerts');
  } else {
    // CSS — insert after the existing .empty rule.
    const cssAnchor = `.empty { text-align: center; padding: 56px 20px; color: var(--text-4); font-size: 14px; }`;
    const cssAddition = `.empty { text-align: center; padding: 56px 20px; color: var(--text-4); font-size: 14px; }
/* ${M_ALERTS}: home quick-action alerts */
.p23-alert-stack{display:flex;flex-direction:column;gap:8px;margin:14px 0 6px}
.p23-alert{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;cursor:pointer;border:1.5px solid;transition:all .15s;font-family:inherit;width:100%;text-align:left;background:transparent}
.p23-alert.warn{background:rgba(253,224,71,.06);border-color:rgba(253,224,71,.3);color:#FDE047}
.p23-alert.warn:hover{background:rgba(253,224,71,.12);border-color:rgba(253,224,71,.5)}
.p23-alert.danger{background:rgba(252,165,165,.06);border-color:rgba(252,165,165,.3);color:#FCA5A5}
.p23-alert.danger:hover{background:rgba(252,165,165,.12);border-color:rgba(252,165,165,.5)}
.p23-alert-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.p23-alert.warn .p23-alert-icon{background:rgba(253,224,71,.15)}
.p23-alert.danger .p23-alert-icon{background:rgba(252,165,165,.15)}
.p23-alert-icon svg{width:16px;height:16px;stroke:currentColor;stroke-width:2.4;fill:none}
.p23-alert-body{flex:1;min-width:0}
.p23-alert-title{font-size:13px;font-weight:700;margin-bottom:2px}
.p23-alert-sub{font-size:11px;opacity:.85;font-weight:500}
.p23-alert-arrow{flex-shrink:0;opacity:.7}
.p23-alert-arrow svg{width:14px;height:14px;stroke:currentColor;stroke-width:2.5;fill:none}`;

    const r1 = tryReplace(updated, cssAnchor, cssAddition);
    if (!r1) {
      warn('Alerts CSS anchor not found; styling may be missing');
    } else {
      updated = r1;
    }

    // Add the alerts container to Home panel — anchor on existing KPI structure.
    const homeAnchor = `<div class="kpi-sub"><span id="s-unclaimed">-</span> unclaimed in stock</div>`;
    const homeAddition = `<div class="kpi-sub"><span id="s-unclaimed">-</span> unclaimed in stock</div>
<!-- ${M_ALERTS}: home alerts container -->
<div class="p23-alert-stack" id="p23-alerts" style="grid-column:1/-1"></div>`;

    const r2 = tryReplace(updated, homeAnchor, homeAddition);
    if (!r2) {
      warn('Home KPI anchor not found; alerts container NOT injected');
    } else {
      updated = r2;
    }

    // Insert the render function. Anchor on the second occurrence of
    // window.p21RenderScansByUser line — but we just inserted M_FN's function
    // there. Use M_FN as anchor since it now exists.
    const fnAnchor = `window.p21ManualVoidUnverified = p21ManualVoidUnverified;`;
    const fnAddition = `window.p21ManualVoidUnverified = p21ManualVoidUnverified;

// ${M_ALERTS}: home-tab quick action alerts
function p23RenderAlerts(data) {
  const root = document.getElementById('p23-alerts');
  if (!root) return;
  const tags = (data && data.tags) || (window.allTagsData) || [];
  const unverifiedByBatch = {};
  let totalUnverified = 0;
  let totalVoided = 0;
  tags.forEach(t => {
    if (t.status === 'unclaimed' && t.verified === false) {
      const b = t.batch_number || '(no batch)';
      unverifiedByBatch[b] = (unverifiedByBatch[b] || 0) + 1;
      totalUnverified++;
    } else if (t.status === 'voided') {
      totalVoided++;
    }
  });

  const alerts = [];
  if (totalUnverified > 0) {
    const batchList = Object.entries(unverifiedByBatch)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(function(pair) { return 'Batch ' + pair[0] + ' (' + pair[1] + ')'; })
      .join(', ');
    const extra = Object.keys(unverifiedByBatch).length > 3 ? ' \u2026' : '';
    alerts.push(
      '<button type="button" class="p23-alert warn" onclick="navTo(&#39;receive&#39;)">' +
        '<div class="p23-alert-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>' +
        '<div class="p23-alert-body">' +
          '<div class="p23-alert-title">' + totalUnverified + ' unverified token' + (totalUnverified === 1 ? '' : 's') + ' awaiting review</div>' +
          '<div class="p23-alert-sub">' + batchList + extra + ' \u2014 tap to verify or void</div>' +
        '</div>' +
        '<div class="p23-alert-arrow"><svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></div>' +
      '</button>'
    );
  }
  if (totalVoided > 0) {
    alerts.push(
      '<button type="button" class="p23-alert danger" onclick="p23OpenVoided()">' +
        '<div class="p23-alert-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>' +
        '<div class="p23-alert-body">' +
          '<div class="p23-alert-title">' + totalVoided + ' voided token' + (totalVoided === 1 ? '' : 's') + '</div>' +
          '<div class="p23-alert-sub">Review or permanently delete them</div>' +
        '</div>' +
        '<div class="p23-alert-arrow"><svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></div>' +
      '</button>'
    );
  }
  root.innerHTML = alerts.join('');
}

function p23OpenVoided() {
  if (typeof navTo === 'function') navTo('tags');
  setTimeout(function() {
    if (typeof p19SetTagFilter === 'function') p19SetTagFilter('voided');
  }, 150);
}
window.p23RenderAlerts = p23RenderAlerts;
window.p23OpenVoided = p23OpenVoided;

// ${M_ALERTS}: wrap renderDashboard so alerts auto-render after each refresh
(function() {
  const orig = window.renderDashboard;
  if (typeof orig === 'function' && !orig.__p24wrapped) {
    const wrapped = function(d) {
      const ret = orig.apply(this, arguments);
      try { p23RenderAlerts(d); } catch (e) {}
      return ret;
    };
    wrapped.__p24wrapped = true;
    window.renderDashboard = wrapped;
  }
})();`;

    const r3 = tryReplace(updated, fnAnchor, fnAddition);
    if (!r3) {
      warn('p21ManualVoidUnverified anchor not found AFTER 24.3 insert; alerts render fn NOT added');
    } else {
      updated = r3;
    }

    anyChange = true;
    ok('Home quick-action alerts wired');
  }

  // ── 24.5 Guard the p20UpdateBadges fetch from firing without admin key ──
  const M_GUARD = MARKER_24 + '_GUARD';
  if (updated.includes(M_GUARD)) {
    skip('p20UpdateBadges admin-key guard');
  } else {
    // The existing code has:
    //   fetch('/api/get-reviews?status=pending&admin_key=' + encodeURIComponent(adminKey)) /* TMC_PATCH22_HOTFIX: was admin= */
    // We wrap it in a guard.
    const anchor = `fetch('/api/get-reviews?status=pending&admin_key=' + encodeURIComponent(adminKey)) /* TMC_PATCH22_HOTFIX: was admin= */
      .then(r => r.json())
      .then(d => p20SetBadge('reviews', d && d.reviews ? d.reviews.length : 0))
      .catch(() => {});`;
    const replacement = `/* ${M_GUARD}: skip fetch when admin not signed in yet */
    if (typeof adminKey === 'string' && adminKey) {
      fetch('/api/get-reviews?status=pending&admin_key=' + encodeURIComponent(adminKey))
        .then(r => r.ok ? r.json() : null)
        .then(d => p20SetBadge('reviews', d && d.reviews ? d.reviews.length : 0))
        .catch(() => {});
    }`;

    const r = tryReplace(updated, anchor, replacement);
    if (!r) {
      warn('p20UpdateBadges fetch anchor not found, 401 errors may persist');
    } else {
      updated = r;
      anyChange = true;
      ok('p20UpdateBadges fetch now guarded');
    }
  }

  if (anyChange) {
    backup(file);
    writeFile(file, updated);
    ok('admin.html: saved');
  } else {
    log('  (nothing to change)');
  }
}

log('');
log('==============================================================');
log('Patch 24 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 24: catch-up missing manual-void + home alerts"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test after deploy:');
log('  1. Hard refresh admin.html in incognito.');
log('  2. Console clean, no 401 errors.');
log('  3. Home tab: yellow alert "17 unverified tokens awaiting review".');
log('  4. Tap alert \u2192 Receive panel opens.');
log('  5. Pick Batch 3 \u2192 see RED dashed "Void all unverified" button.');
log('  6. Click it, confirm, batch 3 unverified tokens get voided.');
log('==============================================================');
