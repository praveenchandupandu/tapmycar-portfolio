// ============================================================================
// TapMyCar - Patch 36c: Plan & Billing view
//
// Adds a user-facing Plan & Billing page showing:
//   - current plan + status
//   - renewal date + next charge (live from Stripe)
//   - payment history (from the orders table)
//   - Premium family gift codes (for premium users)
//
// PART A - api/get-billing.js (new endpoint)
//   GET ?user_id=...  ->  { plan, status, renewal, nextAmountCents,
//                           orders[], premiumCodes[] }
//   Renewal date + next amount come live from Stripe via
//   subscriptions.retrieve(user.subscription_id). If no subscription or
//   the lookup fails, renewal is null and the page shows "-".
//
// PART B - public/billing.html (new page)
//   Plan card, renewal card, payment-history list, family-codes section.
//   Matches the site style (app.css + tmc-redesign.css, manage.html shell).
//
// PART C - public/settings.html
//   The "Manage plan" row (-> /pricing.html) is re-pointed to /billing.html
//   and relabelled "Plan & Billing".
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
const BACKUP_DIR = path.join(ROOT, `backup-patch36c-${ts}`);

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
  if (typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
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
log('TapMyCar Patch 36c \u2014 Plan & Billing view');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH36C_BILLING';

// =============================================================================
// PART A - api/get-billing.js
// =============================================================================
log('Part A  api/get-billing.js (new endpoint)');
{
  const file = path.join(API, 'get-billing.js');
  if (fs.existsSync(file)) {
    const existing = readFile(file);
    if (existing.includes(MARKER)) { skip('get-billing.js'); }
    else errExit('get-billing.js exists without marker \u2014 manual review needed');
  } else {
    const body = `// ${MARKER}
// Plan & Billing data for a single user.
// GET /api/get-billing?user_id=...

const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const user_id = req.query.user_id;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const { data: user } = await supabase
      .from('users').select('*').eq('id', user_id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    /* payment history */
    const { data: orders } = await supabase
      .from('orders')
      .select('plan, amount, order_status, status, sticker_count, created_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(50);

    /* premium family codes (premium users only) */
    let premiumCodes = [];
    if (user.plan === 'premium') {
      const { data: codes } = await supabase
        .from('premium_codes')
        .select('code, redeemed_by_user_id, redeemed_at, revoked_at')
        .eq('buyer_user_id', user_id)
        .is('revoked_at', null);
      premiumCodes = codes || [];
    }

    /* live renewal date + next amount from Stripe */
    let renewal = null;
    let nextAmountCents = null;
    let subStatus = null;
    if (user.subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.subscription_id);
        if (sub) {
          subStatus = sub.status;
          if (sub.current_period_end) {
            renewal = new Date(sub.current_period_end * 1000).toISOString();
          }
          if (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price) {
            nextAmountCents = sub.items.data[0].price.unit_amount || null;
          }
        }
      } catch (subErr) {
        console.error('${MARKER}: subscription retrieve failed:', subErr && subErr.message);
      }
    }

    /* if a gift trial is active, surface its expiry as the renewal-equivalent */
    let giftExpiresAt = user.gift_plan_expires_at || null;

    return res.json({
      plan: user.plan || 'etag',
      subStatus,
      renewal,
      giftExpiresAt,
      nextAmountCents,
      orders: orders || [],
      premiumCodes
    });
  } catch (e) {
    console.error('${MARKER}: fatal', e && e.message);
    return res.status(500).json({ error: 'Could not load billing' });
  }
};
`;
    writeFile(file, body);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('get-billing.js created, JS valid');
    } catch (e) {
      errExit('get-billing.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART B - public/billing.html
// =============================================================================
log('');
log('Part B  public/billing.html (new page)');
{
  const file = path.join(PUBLIC, 'billing.html');
  if (fs.existsSync(file)) {
    const existing = readFile(file);
    if (existing.includes(MARKER)) { skip('billing.html'); }
    else errExit('billing.html exists without marker \u2014 manual review needed');
  } else {
    const page = `<!DOCTYPE html>
<!-- ${MARKER} -->
<html lang="en">
<head>
  <link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#FF6B00">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="TapMyCar">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Plan & Billing \u2014 TapMyCar</title>
<link rel="stylesheet" href="/app.css">
<link rel="stylesheet" href="/tmc-redesign.css">
<style>
.bill-card{border-radius:16px;padding:18px;margin-bottom:12px;border:1.5px solid var(--bd);background:#fff}
.bill-card.accent{border-color:var(--or);background:var(--orl)}
.bill-kicker{font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px}
.bill-big{font-size:20px;font-weight:800;color:var(--bk)}
.bill-sub{font-size:12px;color:var(--gy);margin-top:4px;line-height:1.5}
.bill-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:.5px solid var(--bd)}
.bill-row:last-child{border-bottom:none}
.bill-row-l{font-size:12px;color:var(--bk);font-weight:600}
.bill-row-s{font-size:11px;color:var(--gy);margin-top:2px}
.bill-row-amt{font-size:13px;font-weight:800;color:var(--bk)}
.bill-section-title{font-size:14px;font-weight:700;color:var(--bk);margin:18px 0 10px}
.code-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--bd);border-radius:10px;margin-bottom:8px}
.code-val{font-family:monospace;font-size:13px;font-weight:700;color:var(--bk)}
.code-copy{background:var(--or);color:#fff;border:0;border-radius:8px;font-size:11px;font-weight:700;padding:6px 12px;cursor:pointer}
.code-done{background:#DCFCE7;color:#166534;font-size:10px;font-weight:800;padding:5px 11px;border-radius:99px}
.empty-note{font-size:12px;color:var(--gy);text-align:center;padding:18px}
</style>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<meta name="description" content="View your TapMyCar plan, renewal, and payment history.">
</head>
<body>
<div class="nav"><div class="bk" onclick="window.location.href='/dashboard.html'"><div class="bkb"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></div><span class="bk-label">Plan & Billing</span></div><a href="/dashboard.html" aria-label="TapMyCar" style="display:flex;align-items:center;text-decoration:none"><img src="/logo.png" alt="TapMyCar" class="nav-logo-img" style="height:36px;width:auto"></a></div>

<div class="wrap" style="padding:16px 16px 40px;max-width:480px;margin:0 auto">

  <div id="bill-loading" class="empty-note">Loading your billing details\u2026</div>

  <div id="bill-content" style="display:none">
    <!-- current plan -->
    <div class="bill-card accent">
      <div class="bill-kicker">Current plan</div>
      <div class="bill-big" id="b-plan">\u2014</div>
      <div class="bill-sub" id="b-plan-sub"></div>
    </div>

    <!-- renewal -->
    <div class="bill-card">
      <div class="bill-kicker">Renewal</div>
      <div class="bill-big" id="b-renewal">\u2014</div>
      <div class="bill-sub" id="b-renewal-sub"></div>
    </div>

    <!-- payment history -->
    <div class="bill-section-title">Payment history</div>
    <div class="bill-card" id="b-history"></div>

    <!-- family codes -->
    <div id="b-codes-section" style="display:none">
      <div class="bill-section-title">Family gift codes</div>
      <div class="bill-card" id="b-codes"></div>
    </div>
  </div>

</div>

<script src="/app.js"></script>
<script>
function getSessionSafe() {
  try { if (typeof getSession === 'function') return getSession(); } catch(e){}
  var t = localStorage.getItem('tmc_token');
  return t ? { token: t } : null;
}
var s = getSessionSafe();
if (!s || !s.token) { window.location.href = '/signin.html'; }

var PLAN_NAMES = { etag: 'eTag (Free)', standard: 'Standard', premium: 'Premium', business: 'Business' };

function fmtDate(iso) {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch(e) { return '\u2014'; }
}
function fmtMoney(cents) {
  if (cents === null || cents === undefined) return '\u2014';
  return '$' + (cents / 100).toFixed(2);
}
function orderLabel(o) {
  var m = {
    upgrade: 'Premium upgrade',
    renewal: 'Plan renewal',
    pending_sticker: 'Sticker activation',
    processing: 'Sticker order',
    'upgrade ': 'Premium upgrade'
  };
  return m[(o.order_status || '').trim()] || ((o.plan ? o.plan.charAt(0).toUpperCase() + o.plan.slice(1) : 'Order'));
}

async function loadBilling() {
  try {
    var res = await fetch('/api/get-billing?user_id=' + encodeURIComponent(s.token));
    var data = await res.json();
    if (!res.ok) throw new Error(data && data.error || 'load failed');

    /* plan */
    var planName = PLAN_NAMES[data.plan] || data.plan;
    document.getElementById('b-plan').textContent = planName;
    var planSub = '';
    if (data.subStatus) planSub = 'Subscription status: ' + data.subStatus + '. ';
    if (data.plan === 'etag') planSub += 'Free digital QR plan.';
    document.getElementById('b-plan-sub').textContent = planSub;

    /* renewal */
    if (data.giftExpiresAt) {
      document.getElementById('b-renewal').textContent = fmtDate(data.giftExpiresAt);
      document.getElementById('b-renewal-sub').textContent = 'Your free gift trial ends on this date.';
    } else if (data.renewal) {
      document.getElementById('b-renewal').textContent = fmtDate(data.renewal);
      var rs = 'Your plan renews on this date.';
      if (data.nextAmountCents !== null && data.nextAmountCents !== undefined) {
        rs += ' Next charge: ' + fmtMoney(data.nextAmountCents) + '.';
      }
      document.getElementById('b-renewal-sub').textContent = rs;
    } else {
      document.getElementById('b-renewal').textContent = 'No active subscription';
      document.getElementById('b-renewal-sub').textContent = 'You do not have a recurring plan right now.';
    }

    /* payment history */
    var hist = document.getElementById('b-history');
    if (data.orders && data.orders.length) {
      hist.innerHTML = '';
      data.orders.forEach(function(o) {
        var row = document.createElement('div');
        row.className = 'bill-row';
        row.innerHTML =
          '<div><div class="bill-row-l">' + orderLabel(o) + '</div>' +
          '<div class="bill-row-s">' + fmtDate(o.created_at) + '</div></div>' +
          '<div class="bill-row-amt">' + fmtMoney(o.amount) + '</div>';
        hist.appendChild(row);
      });
    } else {
      hist.innerHTML = '<div class="empty-note">No payments yet.</div>';
    }

    /* family codes */
    if (data.premiumCodes && data.premiumCodes.length) {
      document.getElementById('b-codes-section').style.display = 'block';
      var box = document.getElementById('b-codes');
      box.innerHTML = '';
      data.premiumCodes.forEach(function(c) {
        var row = document.createElement('div');
        row.className = 'code-row';
        var redeemed = !!c.redeemed_by_user_id;
        row.innerHTML = '<span class="code-val">' + c.code + '</span>';
        if (redeemed) {
          var d = document.createElement('span');
          d.className = 'code-done';
          d.textContent = 'REDEEMED';
          row.appendChild(d);
        } else {
          var btn = document.createElement('button');
          btn.className = 'code-copy';
          btn.textContent = 'COPY';
          btn.onclick = function() {
            try {
              navigator.clipboard.writeText(c.code);
              btn.textContent = 'COPIED';
              setTimeout(function(){ btn.textContent = 'COPY'; }, 1500);
            } catch(e) {}
          };
          row.appendChild(btn);
        }
        box.appendChild(row);
      });
    }

    document.getElementById('bill-loading').style.display = 'none';
    document.getElementById('bill-content').style.display = 'block';
  } catch (e) {
    document.getElementById('bill-loading').textContent =
      'Could not load billing details. Please try again later.';
  }
}
loadBilling();
</script>
</body>
</html>
`;
    writeFile(file, page);
    ok('billing.html created');
  }
}

// =============================================================================
// PART C - public/settings.html: re-point "Manage plan" row
// =============================================================================
log('');
log('Part C  public/settings.html: Plan & Billing link');
{
  const file = path.join(PUBLIC, 'settings.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('settings.html');
  } else {
    backup(file);

    const oldRow = `  <div class="set-row" onclick="window.location.href='/pricing.html'"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div><div><div class="set-t">Manage plan</div><div class="set-s" id="plan-info">View pricing</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>`;

    const newRow = `  <!-- ${MARKER}: Manage plan -> Plan & Billing -->
  <div class="set-row" onclick="window.location.href='/billing.html'"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div><div><div class="set-t">Plan & Billing</div><div class="set-s" id="plan-info">Plan, renewal & payments</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>`;

    const r = safeReplace(content, oldRow, newRow);
    if (!r) errExit('settings.html: "Manage plan" row anchor not found');
    writeFile(file, r);
    ok('settings.html: "Manage plan" row now opens Plan & Billing');
  }
}

log('');
log('==============================================================');
log('Patch 36c complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 36c: Plan & Billing view"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  1. Sign in as any user. Settings -> "Plan & Billing".');
log('  2. The page shows: current plan, renewal date (live from Stripe),');
log('     payment history, and \u2014 for Premium users \u2014 the family gift codes.');
log('  3. A gift-trial user sees their trial end date as the renewal.');
log('  4. A free eTag user sees "No active subscription" and an empty');
log('     payment history \u2014 both expected.');
log('==============================================================');
