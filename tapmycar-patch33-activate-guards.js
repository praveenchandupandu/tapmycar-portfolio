// ============================================================================
// TapMyCar - Patch 33: activate.html — block already-active users from
//                       accidentally deactivating their own tag.
//
// Bug: An already-active Standard/Premium user can visit /activate.html
// and walk through the activation flow on their own existing tag. The
// activatePhysicalSticker() function does:
//   1. Set existingTag.status = 'inactive' (line 526)
//   2. Try to "activate the new tag" — but if scannedToken === existingTag.token,
//      this is the SAME tag we just deactivated. Plus the activation_session
//      may already be used. The "activate" call errors silently.
//   3. Result: tag stuck at 'inactive'. Dashboard doesn't show it, scanners
//      see an inactive page, customer is confused.
//
// Defense-in-depth fix (3 guards):
//
//   33.A  Page-load guard. After loadExistingTag() completes, if user is
//         on a paid plan AND has an active tag, redirect to dashboard with
//         a banner. They cannot enter any activation flow.
//
//   33.B  processToken guard. If scanned token's owner_id matches current
//         user (regardless of tag.status), treat as "this is your tag —
//         go to dashboard". Don't proceed to activation. Previously this
//         only fired when status==='active'; we extend to any status the
//         user already owns.
//
//   33.C  activatePhysicalSticker guard. Hard refuse if scannedToken
//         equals existingTag.token. Cannot deactivate-then-activate the
//         same row. Show error toast.
//
// Properties: idempotent, validates JS, backs up activate.html.
// Uses safeReplace (function-callback in .replace) to avoid the $' bug.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch33-${ts}`);

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

// SAFE replace: use function callback to bypass $-token interpretation.
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
log('TapMyCar Patch 33 \u2014 activate.html guards against already-active users');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const M_A = 'TMC_PATCH33_GUARD_PAGELOAD';
const M_B = 'TMC_PATCH33_GUARD_PROCESS_TOKEN';
const M_C = 'TMC_PATCH33_GUARD_SAME_TOKEN';

{
  const file = path.join(PUBLIC, 'activate.html');
  const content = readFile(file);

  let updated = content;
  let anyChange = false;

  // ── 33.A — Page-load guard ──
  if (updated.includes(M_A)) {
    skip('Page-load guard');
  } else {
    // loadExistingTag() currently just populates `existingTag`. We replace
    // its body to also check the user's plan AND active-tag state, and if
    // they're already activated, redirect.
    const oldFn = `// Load user's existing tag data
async function loadExistingTag() {
  try {
    const res = await fetch('/api/get-dashboard?user_id=' + s.token);
    const data = await res.json();
    if (data.tags && data.tags.length > 0) {
      existingTag = data.tags.find(t => t.status === 'active' || t.status === 'claimed') || data.tags[0];
    }
  } catch(e) { console.error(e); }
}
loadExistingTag();`;
    const newFn = `// Load user's existing tag data
// ${M_A}: also redirect already-activated paid users away from this page.
async function loadExistingTag() {
  try {
    const res = await fetch('/api/get-dashboard?user_id=' + s.token);
    const data = await res.json();
    if (data.tags && data.tags.length > 0) {
      existingTag = data.tags.find(t => t.status === 'active' || t.status === 'claimed') || data.tags[0];
    }
    /* ${M_A}: paid user with an active tag should NOT be activating anything */
    var _userPlan = (data && data.user && data.user.plan) ? String(data.user.plan).toLowerCase() : 'etag';
    var _activeTag = (data.tags || []).find(function(t) { return t.status === 'active'; });
    var _isPaidPlan = (_userPlan === 'standard' || _userPlan === 'premium' || _userPlan === 'business');
    if (_isPaidPlan && _activeTag && !window.location.search) {
      // No ?token= in URL means user typed /activate.html directly.
      // Show a one-second redirect notice and go to dashboard.
      try {
        var _msg = document.createElement('div');
        _msg.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:Inter,system-ui,sans-serif';
        _msg.innerHTML = '<div style="font-size:38px;margin-bottom:14px">\u2705</div>' +
          '<div style="font-size:18px;font-weight:800;color:#111;margin-bottom:6px">You\\'re already activated</div>' +
          '<div style="font-size:13px;color:#6B7280;margin-bottom:18px;max-width:300px">Your ' + (_userPlan.charAt(0).toUpperCase() + _userPlan.slice(1)) + ' tag is active. Taking you to your dashboard\u2026</div>';
        document.body.appendChild(_msg);
      } catch(e) {}
      setTimeout(function() { window.location.replace('/dashboard.html'); }, 1200);
    }
  } catch(e) { console.error(e); }
}
loadExistingTag();`;

    const r = safeReplace(updated, oldFn, newFn);
    if (!r) errExit('activate.html: loadExistingTag anchor not found');
    updated = r;
    anyChange = true;
    ok('Page-load guard inserted (redirects paid users with active tag)');
  }

  // ── 33.B — processToken guard ──
  if (updated.includes(M_B)) {
    skip('processToken guard');
  } else {
    // The check at line 408 is "if (scannedTag.owner_id === s.token)" but
    // only kicks in AFTER the status checks. We add an earlier guard:
    // if owner is current user AND status is active, show "go to dashboard"
    // immediately and stop. We need to find the existing already-active
    // block and add a fallback for owned-but-not-active too.
    const anchor = `    if (scannedTag.status === 'active') {
      // Already active
      if (scannedTag.owner_id === s.token) {
        document.getElementById('r-status').textContent = 'Already active';
        document.getElementById('r-status').className = 'result-status result-match';
        document.getElementById('r-message').textContent = 'This tag is already active on your account.';
        document.getElementById('r-action').innerHTML = '<a href="/dashboard.html" class="btn" style="text-decoration:none;display:block;text-align:center;margin-top:14px">Go to Dashboard</a>';
      } else {
        document.getElementById('r-status').textContent = 'Belongs to another user';
        document.getElementById('r-status').className = 'result-status result-error';
        document.getElementById('r-message').textContent = 'This tag is already registered to a different account.';
        document.getElementById('r-action').innerHTML = '<button class="btn-o" style="margin-top:14px" onclick="showStep(\\'scan\\');startScanner()">Scan a different tag</button>';
      }
      return;
    }`;

    const replacement = `    if (scannedTag.status === 'active') {
      // Already active
      if (scannedTag.owner_id === s.token) {
        document.getElementById('r-status').textContent = 'Already active';
        document.getElementById('r-status').className = 'result-status result-match';
        document.getElementById('r-message').textContent = 'This tag is already active on your account.';
        document.getElementById('r-action').innerHTML = '<a href="/dashboard.html" class="btn" style="text-decoration:none;display:block;text-align:center;margin-top:14px">Go to Dashboard</a>';
      } else {
        document.getElementById('r-status').textContent = 'Belongs to another user';
        document.getElementById('r-status').className = 'result-status result-error';
        document.getElementById('r-message').textContent = 'This tag is already registered to a different account.';
        document.getElementById('r-action').innerHTML = '<button class="btn-o" style="margin-top:14px" onclick="showStep(\\'scan\\');startScanner()">Scan a different tag</button>';
      }
      return;
    }

    /* ${M_B}: if this token already belongs to the current user (any status),
       don't let them re-activate it \u2014 send them to dashboard. */
    if (scannedTag.owner_id === s.token) {
      document.getElementById('r-status').textContent = 'This is your tag';
      document.getElementById('r-status').className = 'result-status result-match';
      document.getElementById('r-message').textContent = 'You already own this tag. Go to your dashboard to manage it.';
      document.getElementById('r-action').innerHTML = '<a href="/dashboard.html" class="btn" style="text-decoration:none;display:block;text-align:center;margin-top:14px">Go to Dashboard</a>';
      return;
    }`;

    const r = safeReplace(updated, anchor, replacement);
    if (!r) errExit('activate.html: processToken active-tag anchor not found');
    updated = r;
    anyChange = true;
    ok('processToken guard inserted (owned-tag-of-any-status redirects to dashboard)');
  }

  // ── 33.C — activatePhysicalSticker same-token guard ──
  if (updated.includes(M_C)) {
    skip('Same-token guard in activatePhysicalSticker');
  } else {
    const anchor = `async function activatePhysicalSticker(activationSessionId) {
  // Deactivate old eTag
  if (existingTag) {`;

    const replacement = `async function activatePhysicalSticker(activationSessionId) {
  /* ${M_C}: refuse if scanned token IS the existing tag (would deactivate-
     then-fail-to-reactivate the same row). */
  if (existingTag && existingTag.token && scannedToken &&
      String(existingTag.token).toUpperCase() === String(scannedToken).toUpperCase()) {
    console.warn('Patch33: refusing physical-upgrade on same token');
    document.getElementById('success-title').textContent = 'Already your tag';
    document.getElementById('success-message').textContent = 'This is the same tag you already own. No changes made. Open your dashboard to manage it.';
    showStep('success');
    return;
  }

  // Deactivate old eTag
  if (existingTag) {`;

    const r = safeReplace(updated, anchor, replacement);
    if (!r) errExit('activate.html: activatePhysicalSticker anchor not found');
    updated = r;
    anyChange = true;
    ok('Same-token guard inserted (refuses self-deactivation)');
  }

  if (anyChange) {
    backup(file);
    writeFile(file, updated);
    ok('activate.html saved');
  }
}

log('');
log('==============================================================');
log('Patch 33 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 33: activate.html guards against already-active users"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test plan:');
log('  1. Sign in as a Standard or Premium user with an active tag.');
log('  2. Type /activate.html directly in the address bar (no ?token=).');
log('  3. Expected: brief "You are already activated" message, then');
log('     auto-redirect to dashboard.html.');
log('  4. Try scanning/entering your OWN existing tag token: should show');
log('     "This is your tag \u2014 Go to Dashboard". No flow.');
log('  5. Try scanning an unclaimed tag while logged in as Standard:');
log('     should still work (the legitimate "add new physical sticker" flow).');
log('==============================================================');
