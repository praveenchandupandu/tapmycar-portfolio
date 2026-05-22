// ============================================================================
// TapMyCar - Patch 36c-fix: Gift-aware Plan & Billing page
//
// Bug: the Plan & Billing page (Patch 36c) shows "eTag (Free)" for a user
// whose gift trial has expired. After expiry users.plan is 'etag', and
// get-billing.js reads that raw field. But the tag still carries
// gift_expired=true + gift_plan, so the page should show the real plan
// with a "Trial ended" note - the same gift-aware treatment Patch 35g
// gave the dashboard and manage page.
//
// Fix:
//  PART A - api/get-billing.js: also look at the user's tags; if any tag
//    has gift_expired=true, return giftExpired:{ plan } so the page knows.
//  PART B - public/billing.html: if giftExpired is present, the plan card
//    shows the real gift plan name + a "Trial ended - subscribe to
//    reactivate" note instead of "eTag (Free)".
//
// Idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch36cfix-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
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
log('TapMyCar Patch 36c-fix \u2014 gift-aware Plan & Billing page');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH36CFIX_GIFT_AWARE';

// =============================================================================
// PART A - api/get-billing.js: detect an expired gift tag
// =============================================================================
log('Part A  api/get-billing.js: detect expired gift tag');
{
  const file = path.join(API, 'get-billing.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('get-billing.js');
  } else {
    backup(file);

    /* Insert a tags lookup + giftExpired detection before the final
       res.json. Anchor on the orders query (always present). */
    const anchor = `    /* payment history */
    const { data: orders } = await supabase
      .from('orders')
      .select('plan, amount, order_status, status, sticker_count, created_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(50);`;

    const withTags = `    /* payment history */
    const { data: orders } = await supabase
      .from('orders')
      .select('plan, amount, order_status, status, sticker_count, created_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(50);

    /* ${MARKER}: detect an expired gift tag so the page can show the
       real gift plan instead of "eTag (Free)". */
    let giftExpired = null;
    try {
      const { data: bTags } = await supabase
        .from('tags')
        .select('gift_expired, gift_plan, is_gift')
        .eq('owner_id', user_id);
      if (bTags && bTags.length) {
        for (let i = 0; i < bTags.length; i++) {
          if (bTags[i] && bTags[i].gift_expired === true) {
            giftExpired = { plan: bTags[i].gift_plan || 'standard' };
            break;
          }
        }
      }
    } catch (gtErr) {
      console.error('${MARKER}: gift tag lookup failed:', gtErr && gtErr.message);
    }`;

    let r = safeReplace(content, anchor, withTags);
    if (!r) errExit('get-billing.js: orders-query anchor not found');
    let updated = r;

    /* add giftExpired to the response object */
    const oldJson = `    return res.json({
      plan: user.plan || 'etag',
      subStatus,
      renewal,
      giftExpiresAt,
      nextAmountCents,
      orders: orders || [],
      premiumCodes
    });`;
    const newJson = `    return res.json({
      plan: user.plan || 'etag',
      subStatus,
      renewal,
      giftExpiresAt,
      giftExpired,
      nextAmountCents,
      orders: orders || [],
      premiumCodes
    });`;

    r = safeReplace(updated, oldJson, newJson);
    if (!r) errExit('get-billing.js: res.json anchor not found');
    updated = r;

    writeFile(file, updated);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('get-billing.js: returns giftExpired, JS valid');
    } catch (e) {
      errExit('get-billing.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART B - public/billing.html: show the real plan for expired gift users
// =============================================================================
log('');
log('Part B  public/billing.html: gift-aware plan card');
{
  const file = path.join(PUBLIC, 'billing.html');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('billing.html');
  } else {
    backup(file);

    const oldPlan = `    /* plan */
    var planName = PLAN_NAMES[data.plan] || data.plan;
    document.getElementById('b-plan').textContent = planName;
    var planSub = '';
    if (data.subStatus) planSub = 'Subscription status: ' + data.subStatus + '. ';
    if (data.plan === 'etag') planSub += 'Free digital QR plan.';
    document.getElementById('b-plan-sub').textContent = planSub;`;

    const newPlan = `    /* plan */
    /* ${MARKER}: if a gift trial expired, show the real gift plan + a
       trial-ended note instead of "eTag (Free)". */
    if (data.giftExpired) {
      var gName = PLAN_NAMES[data.giftExpired.plan] || data.giftExpired.plan;
      document.getElementById('b-plan').textContent = gName;
      document.getElementById('b-plan-sub').textContent =
        'Your free trial has ended. Subscribe to reactivate your tag and keep ' + gName + ' features.';
    } else {
      var planName = PLAN_NAMES[data.plan] || data.plan;
      document.getElementById('b-plan').textContent = planName;
      var planSub = '';
      if (data.subStatus) planSub = 'Subscription status: ' + data.subStatus + '. ';
      if (data.plan === 'etag') planSub += 'Free digital QR plan.';
      document.getElementById('b-plan-sub').textContent = planSub;
    }`;

    const r = safeReplace(content, oldPlan, newPlan);
    if (!r) errExit('billing.html: plan-card render anchor not found');
    writeFile(file, r);
    ok('billing.html: plan card now gift-aware');
  }
}

log('');
log('==============================================================');
log('Patch 36c-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 36c-fix: gift-aware Plan & Billing page"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  Open /billing.html as the expired-gift test user. The Current Plan');
log('  card should now read "Standard" with a "free trial has ended \u2014');
log('  subscribe to reactivate" note, instead of "eTag (Free)".');
log('  After a real renewal it shows the active plan normally.');
log('==============================================================');
