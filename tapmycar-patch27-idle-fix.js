// ============================================================================
// TapMyCar - Patch 27: Fix "Stay signed in" button on idle modal
//
// Bug: clicking "Stay signed in" doesn't reset the timer reliably.
// Countdown continues to 0, user gets logged out anyway.
//
// Root cause analysis — probable culprits:
//
//   A) The button listener calls recordActivity() which updates localStorage,
//      but the next setInterval tick (every 5s) reads localStorage and
//      compares it against Date.now(). If the click happened at e.g. 1 second
//      remaining, the modal hides but if there's some race where tick fires
//      between click and localStorage write, it can still doLogout().
//
//   B) The button's click handler is registered exactly once via
//      addEventListener. If document.getElementById returns null (DOM not
//      ready at the moment showWarning runs first time, though unlikely),
//      the listener never attaches.
//
//   C) Browsers can throttle event handlers on backgrounded tabs in ways
//      that desync the timer from reality.
//
// Defensive fix (multiple layers):
//   1) Use onclick attribute IN the button HTML, not addEventListener.
//      Calls a globally-exposed helper that re-arms the timer. Cannot fail
//      due to event-listener timing.
//   2) When modal is shown, switch tick interval from 5s to 250ms for smooth
//      countdown and instant logout-after-zero. When modal is hidden, switch
//      back to 5s.
//   3) Inside the click handler, write localStorage FIRST, then call
//      Date.now() again to ensure freshness. Then hide the modal.
//   4) Skip the next tick after a click — set a "just-clicked" flag for 1s
//      that prevents tick() from running doLogout.
//
// Properties: idempotent, validates JS, backs up app.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch27-${ts}`);

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
  try { execSync('node --check "' + p + '"', { stdio: 'pipe' }); }
  catch (e) { errExit('JS syntax error in ' + p + '\n' + e.stderr.toString()); }
}
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 27 \u2014 fix idle-modal Stay button');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH27_IDLE_FIX';

{
  const file = path.join(PUBLIC, 'app.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('app.js (already patched)');
  } else {
    backup(file);

    // Replace the entire installIdleLogout body with a more robust version.
    // Find the original opening signature and replace through the closing brace.
    const anchor = `window.installIdleLogout = function(opts) {
  opts = opts || {};
  var minutes = opts.minutes || 10;
  var warningSeconds = opts.warningSeconds || 60;
  var onLogout = opts.onLogout || function() { window.location.href = '/signin.html'; };
  var checkIntervalMs = 5000;

  var LIMIT_MS = minutes * 60 * 1000;
  var WARN_MS = LIMIT_MS - warningSeconds * 1000;

  var warningEl = null;
  var loggedOut = false;

  function recordActivity() {
    if (loggedOut) return;
    try { localStorage.setItem('tmc_last_activity', String(Date.now())); } catch (e) {}
    hideWarning();
  }`;

    // We can't easily replace through the closing brace of installIdleLogout
    // with simple string match (the function is long and inner functions
    // have braces). Instead replace the WHOLE function by finding its
    // unique opening then using a marker at the end. Simpler approach:
    // anchor on the closing setInterval line.
    const closeAnchor = `  // Polling tick
  setInterval(tick, checkIntervalMs);
};`;

    if (!content.includes(anchor) && !content.includes(anchor.replace(/\n/g, '\r\n'))) {
      errExit('app.js: installIdleLogout opening anchor not found');
    }
    if (!content.includes(closeAnchor) && !content.includes(closeAnchor.replace(/\n/g, '\r\n'))) {
      errExit('app.js: installIdleLogout close anchor not found');
    }

    // Build the new function body
    const newFn = `/* ${MARKER}: rewrite installIdleLogout to fix Stay-button race */
window.installIdleLogout = function(opts) {
  opts = opts || {};
  var minutes = opts.minutes || 10;
  var warningSeconds = opts.warningSeconds || 60;
  var onLogout = opts.onLogout || function() { window.location.href = '/signin.html'; };

  var IDLE_INTERVAL_MS = 5000;
  var WARN_INTERVAL_MS = 250;
  var LIMIT_MS = minutes * 60 * 1000;
  var WARN_MS = LIMIT_MS - warningSeconds * 1000;

  var warningEl = null;
  var loggedOut = false;
  var pollHandle = null;
  var currentInterval = IDLE_INTERVAL_MS;
  var justClickedUntil = 0;

  // Global handle for the Stay button (called via onclick attribute).
  // Re-assigning each install is safe; only one idle helper ever runs.
  window.__tmcStaySignedIn = function() {
    var now = Date.now();
    try { localStorage.setItem('tmc_last_activity', String(now)); } catch (e) {}
    justClickedUntil = now + 1500; // suppress logout for 1.5s after click
    hideWarning();
    rescheduleTick(IDLE_INTERVAL_MS);
  };

  function recordActivity() {
    if (loggedOut) return;
    try { localStorage.setItem('tmc_last_activity', String(Date.now())); } catch (e) {}
    hideWarning();
  }

  function showWarning() {
    if (warningEl) { warningEl.style.display = 'flex'; return; }
    var div = document.createElement('div');
    div.id = 'tmc-idle-warning';
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
    div.innerHTML = '<div style="background:#fff;border-radius:18px;padding:24px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.3)">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:#FFF3EC;display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>' +
      '<div style="font-size:16px;font-weight:800;color:#111;margin-bottom:6px">Still there?</div>' +
      '<div style="font-size:13px;color:#6B7280;margin-bottom:18px;line-height:1.5">You&#39;ll be signed out in <span id="tmc-idle-count">60</span> <span id="tmc-idle-unit">seconds</span> for inactivity.</div>' +
      '<button id="tmc-idle-stay" type="button" onclick="window.__tmcStaySignedIn()" style="width:100%;height:44px;border:none;border-radius:12px;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Stay signed in</button>' +
    '</div>';
    document.body.appendChild(div);
    warningEl = div;
  }

  function hideWarning() {
    if (warningEl) warningEl.style.display = 'none';
  }

  function getLastActivity() {
    try {
      var v = parseInt(localStorage.getItem('tmc_last_activity') || '0', 10);
      return v > 0 ? v : Date.now();
    } catch (e) { return Date.now(); }
  }

  function doLogout() {
    if (loggedOut) return;
    loggedOut = true;
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    try { localStorage.removeItem('tmc_last_activity'); } catch (e) {}
    try { onLogout(); } catch (e) { console.error('logout callback error:', e); }
  }

  function rescheduleTick(intervalMs) {
    if (currentInterval === intervalMs && pollHandle) return;
    if (pollHandle) clearInterval(pollHandle);
    currentInterval = intervalMs;
    pollHandle = setInterval(tick, intervalMs);
  }

  function tick() {
    if (loggedOut) return;
    var now = Date.now();
    // Suppress logout briefly after a "Stay signed in" click, to ride out
    // any race conditions.
    if (now < justClickedUntil) {
      rescheduleTick(IDLE_INTERVAL_MS);
      return;
    }
    var elapsed = now - getLastActivity();
    if (elapsed >= LIMIT_MS) {
      doLogout();
      return;
    }
    if (elapsed >= WARN_MS) {
      showWarning();
      rescheduleTick(WARN_INTERVAL_MS); // smooth countdown when warning shown
      var remaining = Math.max(0, Math.ceil((LIMIT_MS - elapsed) / 1000));
      var c = document.getElementById('tmc-idle-count');
      if (c) c.textContent = remaining;
      var u = document.getElementById('tmc-idle-unit');
      if (u) u.textContent = (remaining === 1 ? 'second' : 'seconds');
    } else {
      hideWarning();
      rescheduleTick(IDLE_INTERVAL_MS);
    }
  }

  // Initialize last-activity to "now" on install.
  recordActivity();

  // Activity listeners (throttled writes).
  var events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
  var lastWrite = 0;
  events.forEach(function(ev) {
    window.addEventListener(ev, function() {
      var now = Date.now();
      if (now - lastWrite < 5000) return;
      lastWrite = now;
      recordActivity();
    }, { passive: true });
  });

  // Tab visibility — re-check when tab becomes visible
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) tick();
  });

  // Multi-tab: respond to last-activity updates from other tabs
  window.addEventListener('storage', function(e) {
    if (e.key === 'tmc_last_activity') {
      hideWarning();
      rescheduleTick(IDLE_INTERVAL_MS);
    }
  });

  // Start polling
  rescheduleTick(IDLE_INTERVAL_MS);
};`;

    // Build a replacement string starting from the original anchor to the
    // closeAnchor. We'll do this in one shot using a regex-free approach:
    // find the anchor's index, find the closeAnchor's index after it,
    // and splice.
    let startIdx = content.indexOf(anchor);
    let crlf = false;
    if (startIdx < 0) {
      startIdx = content.indexOf(anchor.replace(/\n/g, '\r\n'));
      crlf = true;
    }
    if (startIdx < 0) errExit('Could not locate installIdleLogout start');

    const closeAnchorActual = crlf ? closeAnchor.replace(/\n/g, '\r\n') : closeAnchor;
    const endIdx = content.indexOf(closeAnchorActual, startIdx);
    if (endIdx < 0) errExit('Could not locate installIdleLogout end');

    const replacement = crlf ? newFn.replace(/\n/g, '\r\n') : newFn;
    const updated = content.slice(0, startIdx) + replacement + content.slice(endIdx + closeAnchorActual.length);

    writeFile(file, updated);
    validateJs(file);
    ok('app.js: installIdleLogout rewritten with defensive Stay-button');
  }
}

log('');
log('==============================================================');
log('Patch 27 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 27: fix Stay-signed-in button race"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test:');
log('  1. Sign into admin in incognito.');
log('  2. Do not touch for ~9 minutes.');
log('  3. Modal appears, countdown ticks SMOOTHLY (every 250ms).');
log('  4. At any countdown number (60, 30, 10, 5, 1), click Stay signed in.');
log('  5. Modal disappears, you stay signed in.');
log('  6. Continue normally for another 10 minutes.');
log('==============================================================');
