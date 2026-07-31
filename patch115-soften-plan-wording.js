const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch115-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH115 - Soften remaining plan/pricing/subscription wording app-wide ===');

let anyChanged = false;

try {
  // ===================================================================
  // FIX 1 — dashboard.html: "Subscription details..." banner text
  // ===================================================================
  const dashPath = path.join('public', 'dashboard.html');
  if (fs.existsSync(dashPath)) {
    let content = fs.readFileSync(dashPath, 'utf8');
    const original = content;

    content = content.replace(
      'Subscription details and account settings are managed at tapmycar.io.',
      'Account details and settings are managed at tapmycar.io.'
    );

    if (content !== original) {
      backup(dashPath);
      fs.writeFileSync(dashPath, content, 'utf8');
      console.log('  dashboard.html: softened "Subscription details..." banner');
      anyChanged = true;
    } else {
      console.log('  dashboard.html: already softened or pattern not found');
    }
  }

  // ===================================================================
  // FIX 2 — manage.html: handle EITHER the older or newer banner text
  // ===================================================================
  const managePath = path.join('public', 'manage.html');
  if (fs.existsSync(managePath)) {
    let content = fs.readFileSync(managePath, 'utf8');
    const original = content;

    // Older version (if patch99's banner update wasn't applied on this machine)
    content = content.replace(
      '<div style="font-size:13px;font-weight:700;color:#111;line-height:1.3;margin-bottom:2px">Plans</div>',
      '<div style="font-size:13px;font-weight:700;color:#111;line-height:1.3;margin-bottom:2px">Account</div>'
    );
    content = content.replace(
      'Compare and change plans at tapmycar.io.',
      'Manage your account at tapmycar.io.'
    );

    // Newer version (from patch99)
    content = content.replace(
      'See plan details, pricing, and manage your subscription at tapmycar.io.',
      'Manage your account and settings at tapmycar.io.'
    );

    if (content !== original) {
      backup(managePath);
      fs.writeFileSync(managePath, content, 'utf8');
      console.log('  manage.html: softened plan/pricing/subscription banner wording');
      anyChanged = true;
    } else {
      console.log('  manage.html: already softened or pattern not found');
    }
  }

  // ===================================================================
  // FIX 3 — settings.html: "Plan & Billing" row label
  // ===================================================================
  const settingsPath = path.join('public', 'settings.html');
  if (fs.existsSync(settingsPath)) {
    let content = fs.readFileSync(settingsPath, 'utf8');
    const original = content;

    content = content.replace(
      '<div class="set-t">Plan & Billing</div><div class="set-s" id="plan-info">Plan, renewal & payments</div>',
      '<div class="set-t">Account & Billing</div><div class="set-s" id="plan-info">Manage online at tapmycar.io</div>'
    );

    if (content !== original) {
      backup(settingsPath);
      fs.writeFileSync(settingsPath, content, 'utf8');
      console.log('  settings.html: softened "Plan & Billing" row label');
      anyChanged = true;
    } else {
      console.log('  settings.html: already softened or pattern not found');
    }
  }

  console.log('\n=== TMC_PATCH115 complete ===');
  if (anyChanged) {
    console.log('\nNote: the "Standard"/"Premium" badge showing your CURRENT plan tier was');
    console.log('deliberately left unchanged - that is informational account status (like a');
    console.log('"Free"/"Pro" badge in any app), not promotional or purchase-directed language,');
    console.log('and is not a compliance concern. Let me know if you want that changed too.');
    console.log('\nNext steps: npx cap sync ios -> bump build -> commit -> push -> rebuild -> retest\n');
  } else {
    console.log('\nNo changes were needed - already matches expected wording.\n');
  }

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
