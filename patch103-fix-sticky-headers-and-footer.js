const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch103-' + stamp;
const restoreQueue = [];

function logStep(label) { console.log('\n=== ' + label + ' ==='); }
function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
  restoreQueue.push({ orig: filePath, copy: dest });
}
function restoreAll() {
  console.error('\n[!] Restoring all files from backup...');
  for (const { orig, copy } of restoreQueue) {
    try { fs.copyFileSync(copy, orig); } catch (e) { console.error('  Failed to restore ' + orig + ': ' + e.message); }
  }
  console.error('Restore complete. Backup folder kept at: ' + backupDir);
}

console.log('\n=== TMC_PATCH103 - Fix sticky header gap/overlap + footer cutoff ===');
fs.mkdirSync(backupDir, { recursive: true });

try {
  logStep('Fix 1: Remove the blanket body top-padding rule (was causing extra gap)');

  const cssPath = path.join('public', 'app.css');
  if (!fs.existsSync(cssPath)) throw new Error('public/app.css not found');
  let cssContent = fs.readFileSync(cssPath, 'utf8');

  const oldRule = '\n/* TMC_PATCH101_SAFE_AREA_TOP */\nbody.tmc-platform-ios{padding-top:env(safe-area-inset-top);}\n';
  if (cssContent.indexOf(oldRule) !== -1) {
    backup(cssPath);
    cssContent = cssContent.replace(oldRule, '');
    fs.writeFileSync(cssPath, cssContent, 'utf8');
    console.log('  Removed blanket body padding-top rule');
  } else if (cssContent.indexOf('TMC_PATCH101_SAFE_AREA_TOP') === -1) {
    console.log('  Rule not present - nothing to remove');
  } else {
    console.log('  WARNING: marker found but exact text did not match - leaving as-is, check manually');
  }

  logStep('Fix 2: Fix renewal banner sticky position (dashboard + settings)');

  const bannerPath = path.join('public', 'app-renewal-prompt.js');
  if (!fs.existsSync(bannerPath)) throw new Error('public/app-renewal-prompt.js not found');
  let bannerContent = fs.readFileSync(bannerPath, 'utf8');
  const bannerOriginal = bannerContent;

  bannerContent = bannerContent.replace(
    "'position:sticky',\n      'top:0',",
    "'position:sticky',\n      'top:env(safe-area-inset-top)',"
  );

  if (bannerContent === bannerOriginal) {
    console.log('  WARNING: expected text not found - skipped (check file manually)');
  } else {
    backup(bannerPath);
    fs.writeFileSync(bannerPath, bannerContent, 'utf8');
    console.log('  Fixed renewal banner to respect notch when stuck');
  }

  logStep('Fix 3: Fix sticky top nav headers on landing.html and why.html');

  const stickyOld = 'position:sticky;top:0;background:#fff;z-index:100';
  const stickyNew = 'position:sticky;top:env(safe-area-inset-top);background:#fff;z-index:100';

  for (const file of ['landing.html', 'why.html']) {
    const filePath = path.join('public', file);
    if (!fs.existsSync(filePath)) {
      console.log('  ' + file + ' not found - skipped');
      continue;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.indexOf(stickyNew) !== -1) {
      console.log('  ' + file + ': already fixed');
      continue;
    }
    if (content.indexOf(stickyOld) === -1) {
      console.log('  ' + file + ': expected pattern not found - skipped (check manually)');
      continue;
    }
    backup(filePath);
    content = content.replace(stickyOld, stickyNew);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('  ' + file + ': fixed sticky header notch offset');
  }

  logStep('Fix 4: Fix footer being cut off near the home indicator');

  const landingPath = path.join('public', 'landing.html');
  if (fs.existsSync(landingPath)) {
    let landingContent = fs.readFileSync(landingPath, 'utf8');
    const landingOriginal = landingContent;

    landingContent = landingContent.replace(
      '.footer { padding: 20px 24px; border-top: .5px solid #E5E7EB; text-align: center; }',
      '.footer { padding: 20px 24px calc(20px + env(safe-area-inset-bottom)); border-top: .5px solid #E5E7EB; text-align: center; }'
    );

    if (landingContent === landingOriginal) {
      console.log('  WARNING: expected .footer rule not found - skipped (check manually)');
    } else {
      backup(landingPath);
      fs.writeFileSync(landingPath, landingContent, 'utf8');
      console.log('  Added bottom safe-area padding to footer');
    }
  } else {
    console.log('  public/landing.html not found - skipped');
  }

  console.log('\n=== TMC_PATCH103 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH103: Fix sticky header gap/overlap and footer cutoff"');
  console.log('  2. git push  (web fixes go live on Vercel automatically in ~60s)');
  console.log('  Note: this patch only touches public/ files - no app rebuild needed for these specific fixes\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
