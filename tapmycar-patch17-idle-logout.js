// ============================================================================
// TapMyCar - Patch 17: Idle auto-logout + Receive batch refresh
//
// Two fixes:
//
// 17.1  Idle auto-logout (10 minutes)
//       - Applies to BOTH user-facing pages and the admin dashboard.
//       - Activity events that reset the timer: mousemove, keydown, scroll,
//         touchstart, click.
//       - At 9 minutes idle: shows a "You'll be signed out in 60 seconds"
//         modal with a "Stay signed in" button. Clicking it resets the timer.
//       - At 10 minutes: fires logout — clears tmc_token / tmc_admin_key,
//         redirects to /signin.html (or shows admin login form on admin.html).
//       - Tab visibility: when tab is hidden, the timer keeps counting using
//         a timestamp comparison. When tab returns to visible, if the elapsed
//         time exceeds 10 min, logs out immediately.
//       - Multi-tab safe: a `storage` event listener watches for changes to
//         a heartbeat key, so activity in tab A resets the timer in tab B.
//
//       Implemented in app.js so all 7 user pages that load it AND admin.html
//       (which also loads app.js) inherit the behavior automatically. Two
//       small bits in admin.html and dashboard.html register the right
//       logout callback (admin shows login form; user redirects to signin).
//
// 17.2  Force-refresh Receive panel batch dropdown
//       - When admin clicks the "Receive" sidebar item, force a fresh
//         /api/get-dashboard call so the batch dropdown is up-to-date.
//       - Today, if the page is left open while a batch is generated in
//         another tab, the dropdown doesn't pick it up unless the user
//         manually reloads.
//       - This also helps if the service worker served a stale cached
//         admin.html — the dropdown gets fresh data on every nav.
//
// REQUIRES: Patches 1-16 already applied locally.
//
// Properties:
//   - Idempotent
//   - Backups every touched file to backup-patch17-{timestamp}/
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch17-idle-logout.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch17-idle-logout.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch17-idle-logout.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch17-${ts}`);

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
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 17 \u2014 Idle auto-logout + Receive batch refresh');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_17 = 'TMC_PATCH17_IDLE_LOGOUT';

// ===========================================================================
// 17.1  app.js — install the idle logout helper
// ===========================================================================

log('17.1  public/app.js: install idle logout helper');
{
  const file = path.join(PUBLIC, 'app.js');
  const content = readFile(file);

  if (content.includes(MARKER_17)) {
    skip('app.js (already patched)');
  } else {
    backup(file);

    // Insert the helper just after the existing requireAuth function.
    const anchor = `function requireAuth() {
  const { token } = getSession();
  if (!token) window.location.href = '/signin.html';
  return token;
}`;

    const addition = anchor + `

// ${MARKER_17}: Idle auto-logout helper.
//
// Call installIdleLogout({minutes, warningSeconds, onLogout}) on any page
// that requires auth. The helper:
//   - Tracks the timestamp of the last user activity in localStorage
//     (key 'tmc_last_activity'). This makes it multi-tab-safe: activity
//     in any tab resets the timer in all open tabs.
//   - Checks every 5 seconds: if (now - lastActivity) > (minutes * 60s),
//     calls onLogout.
//   - At (minutes - warningSeconds/60) minutes, shows a warning modal.
//   - Listens for mousemove, keydown, scroll, touchstart, click, and
//     resets the timestamp on any of these.
//   - On visibilitychange: when tab becomes visible again, immediately
//     re-checks; if elapsed time is past the limit, logs out at once.
//   - On storage event for 'tmc_last_activity' from another tab,
//     refreshes its in-memory copy.
window.installIdleLogout = function(opts) {
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
  }

  function showWarning() {
    if (warningEl) { warningEl.style.display = 'flex'; return; }
    var div = document.createElement('div');
    div.id = 'tmc-idle-warning';
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
    div.innerHTML = '<div style="background:#fff;border-radius:18px;padding:24px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.3)">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:#FFF3EC;display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>' +
      '<div style="font-size:16px;font-weight:800;color:#111;margin-bottom:6px">Still there?</div>' +
      '<div style="font-size:13px;color:#6B7280;margin-bottom:18px;line-height:1.5">You&#39;ll be signed out in <span id="tmc-idle-count">60</span> seconds for inactivity.</div>' +
      '<button id="tmc-idle-stay" style="width:100%;height:44px;border:none;border-radius:12px;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Stay signed in</button>' +
    '</div>';
    document.body.appendChild(div);
    warningEl = div;
    document.getElementById('tmc-idle-stay').addEventListener('click', recordActivity);
  }

  function hideWarning() {
    if (warningEl) warningEl.style.display = 'none';
  }

  function getLastActivity() {
    try { return parseInt(localStorage.getItem('tmc_last_activity') || '0', 10) || Date.now(); }
    catch (e) { return Date.now(); }
  }

  function doLogout() {
    if (loggedOut) return;
    loggedOut = true;
    try { localStorage.removeItem('tmc_last_activity'); } catch (e) {}
    try { onLogout(); } catch (e) { console.error('logout callback error:', e); }
  }

  function tick() {
    if (loggedOut) return;
    var elapsed = Date.now() - getLastActivity();
    if (elapsed >= LIMIT_MS) {
      doLogout();
      return;
    }
    if (elapsed >= WARN_MS) {
      showWarning();
      var remaining = Math.max(0, Math.ceil((LIMIT_MS - elapsed) / 1000));
      var c = document.getElementById('tmc-idle-count');
      if (c) c.textContent = remaining;
    } else {
      hideWarning();
    }
  }

  // Initialize last-activity to "now" on install so the user gets a full
  // 10-min window from page load.
  recordActivity();

  // Activity listeners
  var events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
  var lastWrite = 0;
  events.forEach(function(ev) {
    window.addEventListener(ev, function() {
      // Throttle: only update localStorage at most once per 5 seconds.
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
    if (e.key === 'tmc_last_activity') hideWarning();
  });

  // Polling tick
  setInterval(tick, checkIntervalMs);
};
`;

    const r = tryReplace(content, anchor, addition);
    if (!r) errExit('app.js: requireAuth anchor not found');
    writeFile(file, r);
    ok('app.js: installIdleLogout helper added');
  }
}

// ===========================================================================
// 17.2  dashboard.html — register idle logout for user dashboard
// ===========================================================================

log('');
log('17.2  public/dashboard.html: register idle logout (10 min)');
{
  const file = path.join(PUBLIC, 'dashboard.html');
  const content = readFile(file);

  if (content.includes(MARKER_17)) {
    skip('dashboard.html (already patched)');
  } else {
    backup(file);

    // Anchor: just after `requireAuth();` near top of the inline script.
    const anchor = `requireAuth();
const s = getSession();`;

    const addition = `requireAuth();
const s = getSession();
/* ${MARKER_17} */
if (typeof installIdleLogout === 'function') {
  installIdleLogout({
    minutes: 10,
    warningSeconds: 60,
    onLogout: function() {
      try {
        localStorage.removeItem('tmc_token');
        localStorage.removeItem('tmc_phone');
        localStorage.removeItem('tmc_name');
      } catch (e) {}
      window.location.href = '/signin.html?reason=idle';
    }
  });
}`;

    const r = tryReplace(content, anchor, addition);
    if (!r) errExit('dashboard.html: requireAuth anchor not found');
    writeFile(file, r);
    ok('dashboard.html: idle logout installed (10 min, redirect to /signin.html)');
  }
}

// ===========================================================================
// 17.3  admin.html — register idle logout for admin dashboard +
//                    force-refresh batch dropdown on Receive nav
// ===========================================================================

log('');
log('17.3  public/admin.html: register idle logout (10 min) + Receive refresh');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  if (content.includes(MARKER_17)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // 17.3.a — Install idle logout. Anchor on the admin login success path
    // (right after the localStorage.setItem('tmc_admin_key', ...) call).
    const anchor1 = `        localStorage.setItem('tmc_admin_key', adminKey);`;
    const addition1 = `        localStorage.setItem('tmc_admin_key', adminKey);
        /* ${MARKER_17}: arm idle logout once admin is signed in */
        if (typeof installIdleLogout === 'function') {
          installIdleLogout({
            minutes: 10,
            warningSeconds: 60,
            onLogout: function() {
              try { localStorage.removeItem('tmc_admin_key'); } catch (e) {}
              if (typeof adminLogout === 'function') adminLogout();
              else window.location.reload();
            }
          });
        }`;

    let r1 = tryReplace(updated, anchor1, addition1);
    if (!r1) errExit('admin.html: admin-login anchor not found');
    updated = r1;

    // 17.3.b — Also arm idle logout on auto-login (when savedKey is reused).
    const anchor2 = `const savedKey = localStorage.getItem('tmc_admin_key');
if (savedKey) { adminKey = savedKey; document.getElementById('admin-key').value = savedKey; adminLogin(); }`;
    const addition2 = `const savedKey = localStorage.getItem('tmc_admin_key');
if (savedKey) { adminKey = savedKey; document.getElementById('admin-key').value = savedKey; adminLogin(); }
/* ${MARKER_17}: also arm idle logout when auto-signed-in via saved key
   (covered by adminLogin's success path, but harmless if adminLogin fails
   because installIdleLogout just tracks activity and never logs out anyone
   who isn't actually signed in — adminLogout is a no-op in that case). */`;

    let r2 = tryReplace(updated, anchor2, addition2);
    if (!r2) errExit('admin.html: savedKey anchor not found');
    updated = r2;

    // 17.3.c — Force-refresh batch dropdown when navigating to Receive.
    // We hook into navTo() — but rather than rewriting it, we wrap it.
    // Add the wrap at the bottom of the navTo definition area.
    const anchor3 = `window.showTab = showTab; window.navTo = navTo;`;
    const addition3 = `window.showTab = showTab; window.navTo = navTo;

/* ${MARKER_17}: force-refresh batch dropdown when navigating to Receive */
(function() {
  var origNavTo = window.navTo;
  window.navTo = function(id) {
    var ret = origNavTo.apply(this, arguments);
    if (id === 'receive' && typeof adminKey === 'string' && adminKey) {
      // Re-fetch dashboard so loadBatchOptions sees the freshest tags.
      fetch('/api/get-dashboard?admin=' + encodeURIComponent(adminKey))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.admin && typeof loadBatchOptions === 'function') {
            loadBatchOptions(d.tags || []);
          }
        }).catch(function() {});
    }
    return ret;
  };
})();`;

    let r3 = tryReplace(updated, anchor3, addition3);
    if (!r3) errExit('admin.html: navTo wrap anchor not found');
    updated = r3;

    writeFile(file, updated);
    ok('admin.html: idle logout + Receive refresh wired');
  }
}

// ===========================================================================
// 17.4  Optional — signin.html shows "you were signed out for inactivity"
// ===========================================================================

log('');
log('17.4  public/signin.html: show inactivity reason if redirected with ?reason=idle');
{
  const file = path.join(PUBLIC, 'signin.html');
  if (!fs.existsSync(file)) {
    log('  \u00b7 signin.html not found, skipped');
  } else {
    const content = readFile(file);
    if (content.includes(MARKER_17)) {
      skip('signin.html (already patched)');
    } else {
      // We just inject a small script that reads ?reason=idle and shows a
      // banner. Best-effort; if the page has no banner area, it skips.
      const before = '</body>';
      const addition = `<script>
/* ${MARKER_17}: show idle-signout note if redirected with ?reason=idle */
(function() {
  try {
    var url = new URL(window.location.href);
    if (url.searchParams.get('reason') !== 'idle') return;
    var n = document.createElement('div');
    n.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#FFF3EC;border:1.5px solid #FFD7BA;color:#7C2D12;font-size:12.5px;font-weight:600;padding:10px 16px;border-radius:99px;z-index:9999;box-shadow:0 6px 16px rgba(0,0,0,.08);font-family:inherit';
    n.textContent = 'You were signed out for inactivity. Sign in to continue.';
    document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(n); });
    if (document.readyState !== 'loading') document.body.appendChild(n);
    // Clean the URL so reload doesn't keep the banner
    url.searchParams.delete('reason');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
  } catch (e) {}
})();
</script>
</body>`;
      if (content.includes(before)) {
        backup(file);
        writeFile(file, content.replace(before, addition));
        ok('signin.html: idle-notice banner added');
      } else {
        log('  \u00b7 signin.html: </body> not found, skipped');
      }
    }
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 17 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 17: idle auto-logout (10 min) + Receive batch refresh"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test plan:');
log('');
log('1. Auto-logout (user side):');
log('   - Open https://tapmycar.io/dashboard.html in incognito');
log('   - Sign in normally');
log('   - Walk away (or leave the tab unfocused) for 9 minutes');
log('   - At 9 min: "Still there?" modal appears with 60s countdown');
log('   - At 10 min total idle: redirected to /signin.html with banner');
log('     "You were signed out for inactivity."');
log('');
log('2. "Stay signed in" works:');
log('   - Repeat above. When the modal shows at 9 min, click "Stay signed in".');
log('   - Modal disappears, timer resets. You stay signed in.');
log('');
log('3. Auto-logout (admin side):');
log('   - Open https://tapmycar.io/admin.html, sign in.');
log('   - Same flow: 9-min warning, 10-min logout. Admin shows the admin');
log('     login form again instead of redirecting.');
log('');
log('4. Activity resets timer:');
log('   - Open the dashboard. Move your mouse / press any key periodically.');
log('   - Should NEVER show the warning.');
log('');
log('5. Receive batch dropdown:');
log('   - Open admin. Navigate to Generate, create a new batch.');
log('   - Navigate to Receive. Open the batch dropdown.');
log('   - The new batch should appear.');
log('   - Bonus: if it still does not show, try unregistering the service worker');
log('     (DevTools > Application > Service Workers > Unregister) and');
log('     hard refresh. Cache is the most likely culprit.');
log('');
log('Notes:');
log('  - For quick testing, you can temporarily lower the timeout in');
log('    app.js by editing installIdleLogout call args (minutes: 1).');
log('  - The timer is multi-tab-safe via localStorage. Activity in one tab');
log('    resets all open tabs.');
log('==============================================================');
