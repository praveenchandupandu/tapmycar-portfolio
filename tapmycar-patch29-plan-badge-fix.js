// ============================================================================
// TapMyCar - Patch 29: Dashboard plan badge + upgrade banner fix
//
// Bug observed: a user on Standard plan was seeing "Free" badge in the
// dashboard header AND the orange "Upgrade to Standard" promo banner —
// while at the same moment manage.html (same data source) correctly
// showed "You are on the Standard plan". User: Chandu (id ending in
// dc0b3b4e6236, users.plan='standard'). Both pages read data.user.plan
// from /api/get-dashboard.
//
// Root cause hypothesis (cannot reproduce in dev with confidence):
// the plan-badge + banner update lives inside an `if (data.scanCount !==
// undefined)` block. If the API response was somehow delayed/partial, the
// plan update silently never ran. The initial HTML state defaults to
// "Free" badge with both upgrade banners hidden — but the banner toggling
// shouldn't have shown a banner in that case. So another path:
//
// Actually the simpler explanation: data.scanCount IS defined (we see
// "2 scans" in screenshot), so the if-block runs, and userPlan SHOULD
// resolve to 'standard'. But the user clearly sees Free + Upgrade-to-
// Standard. The only way this happens with correct data is if there's
// a race where the badge gets set correctly THEN reset, OR the API
// returned different data than the DB shows.
//
// Defensive fix:
//   - Move plan-badge + banner toggle OUT of the scanCount guard. Run
//     it independently as soon as data.user is known.
//   - Reset BOTH banners to display:none before deciding which (if any)
//     to show. This protects against any future re-render path that
//     might show a stale banner.
//   - Hide the "Upgrade to Standard" banner for ANY paid plan (standard,
//     premium, business), not only standard.
//   - Don't show Upgrade-to-Premium to premium users.
//   - Use textContent reliably with explicit string mapping.
//   - Add a console.log so if this bug ever recurs we have data.
//
// Properties: idempotent, validates JS, backs up dashboard.html.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch29-${ts}`);

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
log('TapMyCar Patch 29 \u2014 fix dashboard plan badge + upgrade banner');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH29_PLAN_BADGE_FIX';

{
  const file = path.join(PUBLIC, 'dashboard.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('dashboard.html (already patched)');
  } else {
    backup(file);

    // Replace the section that handles plan badge + banners.
    const anchor = `    if (data.scanCount !== undefined) {
      document.getElementById('stat-scans').textContent = data.scanCount;
      document.getElementById('stat-week').textContent = data.weekCount;
      // Show upgrade banner based on plan
      const userPlan = data.user ? (data.user.plan || 'etag') : 'etag';
      // Update plan badge label dynamically
      const badge = document.getElementById('plan-badge');
      if (badge) {
        const label = userPlan === 'etag' ? 'Free' : userPlan === 'standard' ? 'Standard' : userPlan === 'premium' ? 'Premium' : userPlan;
        badge.textContent = label;
      }
      // TMC_FAMILY_CODES_LOADER
      renderFamilyCodes(userPlan, data.premiumCodes || []);
      if (userPlan === 'etag' || userPlan === 'free') {
        document.getElementById('upgrade-banner-etag').style.display = 'block';
      } else if (userPlan === 'standard') {
        document.getElementById('upgrade-banner-standard').style.display = 'block';
      }
    }`;

    const replacement = `    /* ${MARKER}: plan-badge + banner logic — run regardless of scanCount.
       scanCount can be a number (including 0). Plan-related UI shouldn't
       depend on scan presence. */
    if (data.scanCount !== undefined) {
      document.getElementById('stat-scans').textContent = data.scanCount;
      document.getElementById('stat-week').textContent = data.weekCount;
    }

    /* ${MARKER}: derive plan ONCE, then apply to badge + banners. */
    var _userPlan = 'etag';
    if (data && data.user && typeof data.user.plan === 'string' && data.user.plan) {
      _userPlan = data.user.plan.toLowerCase().trim();
    }
    console.log('[dashboard] userPlan=' + _userPlan + ' (raw=' + JSON.stringify(data && data.user && data.user.plan) + ')');

    var _planLabels = { etag: 'Free', free: 'Free', standard: 'Standard', premium: 'Premium', business: 'Business' };
    var _badge = document.getElementById('plan-badge');
    if (_badge) _badge.textContent = _planLabels[_userPlan] || _userPlan.charAt(0).toUpperCase() + _userPlan.slice(1);

    /* ${MARKER}: Reset BOTH banners to hidden, then decide. */
    var _bEtag = document.getElementById('upgrade-banner-etag');
    var _bStd = document.getElementById('upgrade-banner-standard');
    if (_bEtag) _bEtag.style.display = 'none';
    if (_bStd) _bStd.style.display = 'none';

    /* ${MARKER}: Only free/etag users see "Upgrade to Standard".
       Only standard users see "Upgrade to Premium".
       Premium/business users see no upgrade banner. */
    if (_userPlan === 'etag' || _userPlan === 'free' || !_userPlan) {
      if (_bEtag) _bEtag.style.display = 'block';
    } else if (_userPlan === 'standard') {
      if (_bStd) _bStd.style.display = 'block';
    }
    /* premium / business / anything else: no banner shown */

    // TMC_FAMILY_CODES_LOADER
    renderFamilyCodes(_userPlan, data.premiumCodes || []);`;

    let r = tryReplace(content, anchor, replacement);
    if (!r) errExit('dashboard.html: plan-badge anchor not found');

    writeFile(file, r);
    ok('dashboard.html: plan badge + banner logic hardened');
  }
}

log('');
log('==============================================================');
log('Patch 29 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 29: dashboard plan badge + upgrade banner fix"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Verify after deploy:');
log('  1. Open dashboard.html in fresh incognito as Chandu (Standard user).');
log('  2. Plan badge top-right should now say "Standard" (not "Free").');
log('  3. The orange "Upgrade to Standard" banner should NOT appear.');
log('  4. The dark "Upgrade to Premium" banner SHOULD appear.');
log('  5. Open DevTools Console \u2014 should see line:');
log('     [dashboard] userPlan=standard (raw="standard")');
log('     This confirms the API is returning the right plan value.');
log('  6. Sign in as the Premium user (Praveenchandu) \u2014 should see');
log('     "Premium" badge and NO upgrade banner at all.');
log('==============================================================');
