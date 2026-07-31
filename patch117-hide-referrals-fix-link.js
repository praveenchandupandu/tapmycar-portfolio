const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch117-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH117 - Hide Referrals section (money stats + "buys a plan" text) + fix broken referral link ===');

let anyChanged = false;

try {
  // ===================================================================
  // FIX 1 — settings.html: hide the whole Referrals section on iOS
  // ===================================================================
  const settingsPath = path.join('public', 'settings.html');
  if (fs.existsSync(settingsPath)) {
    let content = fs.readFileSync(settingsPath, 'utf8');
    const original = content;

    content = content.replace(
      '<div class="sl">Referrals</div>',
      '<div class="sl tmc-hide-on-ios">Referrals</div>'
    );
    content = content.replace(
      '<div class="card" style="margin:0 16px 8px;padding:16px">',
      '<div class="card tmc-hide-on-ios" style="margin:0 16px 8px;padding:16px">'
    );

    if (content !== original) {
      backup(settingsPath);
      fs.writeFileSync(settingsPath, content, 'utf8');
      console.log('  settings.html: hid the entire Referrals section (code, stats, $ amounts) on iOS');
      anyChanged = true;
    } else {
      console.log('  settings.html: already hidden or pattern not found');
    }
  }

  // ===================================================================
  // FIX 2 — vercel.json: ensure cleanUrls is set + force a fresh deploy
  //          (this re-saves the file even if unchanged, to guarantee a
  //          new deployment picks up the correct /r/:code rewrite)
  // ===================================================================
  const vercelPath = 'vercel.json';
  if (fs.existsSync(vercelPath)) {
    let vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
    backup(vercelPath);

    if (vercelConfig.cleanUrls !== true) {
      vercelConfig.cleanUrls = true;
      console.log('  vercel.json: cleanUrls was missing - re-added it');
    } else {
      console.log('  vercel.json: cleanUrls already present');
    }

    // Confirm the /r/:code rewrite is present; add it back if somehow missing
    const hasRefRewrite = (vercelConfig.rewrites || []).some(r => r.source === '/r/:code');
    if (!hasRefRewrite) {
      vercelConfig.rewrites = vercelConfig.rewrites || [];
      vercelConfig.rewrites.push({ source: '/r/:code', destination: '/register.html?ref=:code' });
      console.log('  vercel.json: /r/:code rewrite was missing - re-added it');
    } else {
      console.log('  vercel.json: /r/:code rewrite already present');
    }

    // Re-write the file regardless, to force a fresh commit + deploy
    fs.writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2) + '\n', 'utf8');
    console.log('  vercel.json: re-saved to force a fresh Vercel deployment');
    anyChanged = true;
  } else {
    console.log('  vercel.json not found - skipped');
  }

  console.log('\n=== TMC_PATCH117 complete ===');
  if (anyChanged) {
    console.log('\nNext steps:');
    console.log('  1. npx cap sync ios -> bump build -> commit -> push -> rebuild -> retest (for settings.html)');
    console.log('  2. The vercel.json change deploys automatically in ~60s - after that, test the referral');
    console.log('     link again (https://tapmycar.io/r/YOUR-CODE) in a normal browser to confirm it works\n');
  }

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
