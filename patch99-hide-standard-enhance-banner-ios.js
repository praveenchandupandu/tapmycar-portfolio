const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-patch99-' + stamp;
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
    try { fs.copyFileSync(copy, orig); }
    catch (e) { console.error('  Failed to restore ' + orig + ': ' + e.message); }
  }
  console.error('Restore complete. Backup folder kept at: ' + backupDir);
}

console.log('\n=== TMC_PATCH99 - iOS Manage screen final pass ===');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  const managePath = path.join('public', 'manage.html');
  if (!fs.existsSync(managePath)) throw new Error('public/manage.html not found');

  let content = fs.readFileSync(managePath, 'utf8');
  const original = content;

  logStep('Step 1: Hide #plan-standard on iOS');
  const standardAlready = /<div class="plan-card tmc-hide-on-ios" id="plan-standard"/;
  const standardTarget = /<div class="plan-card" id="plan-standard"/;

  if (standardAlready.test(content)) {
    console.log('  already has tmc-hide-on-ios');
  } else if (!standardTarget.test(content)) {
    console.log('  WARNING: #plan-standard not found in expected form - skipping');
  } else {
    content = content.replace(standardTarget, '<div class="plan-card tmc-hide-on-ios" id="plan-standard"');
    console.log('  Added tmc-hide-on-ios to #plan-standard');
  }

  logStep('Step 2: Upgrade the iOS Plans banner');
  const NEW_BANNER_MARKER = 'TMC_PATCH99_IOS_BANNER';

  if (content.indexOf(NEW_BANNER_MARKER) !== -1) {
    console.log('  Enhanced banner already present');
  } else {
    const oldBannerRe = /<!-- TMC_PATCH72_IOS_BANNER -->[\s\S]*?<\/div>\s*<\/div>\s*(?=<div class="plan-card tmc-hide-on-ios" id="plan-premium">)/;

    if (!oldBannerRe.test(content)) {
      console.log('  WARNING: Old banner block not found in expected form - skipping');
    } else {
      const newBanner = [
        '<!-- ' + NEW_BANNER_MARKER + ' -->',
        '    <div class="tmc-ios-only" style="background:var(--surface-2, #fff);border:1px solid #FBD4BB;border-radius:14px;padding:16px;margin-bottom:14px;font-family:Inter,system-ui,sans-serif">',
        '      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">',
        '        <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:#FFF1E5;display:flex;align-items:center;justify-content:center">',
        '          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.5 6.5L21 10l-5 4.5L17.5 21 12 17.5 6.5 21 8 14.5 3 10l6.5-1.5z"/></svg>',
        '        </div>',
        '        <div style="flex:1;min-width:0">',
        '          <div style="font-size:14px;font-weight:700;color:#111;line-height:1.3;margin-bottom:3px">Protect your whole family</div>',
        '          <div style="font-size:12px;color:#6B7280;line-height:1.5">See plan details, pricing, and manage your subscription at tapmycar.io.</div>',
        '        </div>',
        '      </div>',
        '      <div style="text-align:right"><a href="javascript:void(0)" onclick="window.tmcOpenWeb(\'/manage\')" style="display:inline-flex;align-items:center;gap:5px;background:#FF6B00;color:#fff;font-weight:700;font-size:12px;padding:9px 16px;border-radius:9px;text-decoration:none">View plans <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a></div>',
        '    </div>',
        '    '
      ].join('\n');

      backup(managePath);
      content = content.replace(oldBannerRe, newBanner);
      console.log('  Replaced iOS banner with enhanced version');
    }
  }

  if (content !== original) {
    if (restoreQueue.length === 0) backup(managePath);
    fs.writeFileSync(managePath, content, { encoding: 'utf8' });
    if (fs.existsSync('manage.html')) fs.copyFileSync(managePath, 'manage.html');
    console.log('\n  Saved public/manage.html (and mirrored to root)');
  } else {
    console.log('\n  No changes needed - already up to date');
  }

  console.log('\n=== TMC_PATCH99 complete ===');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
