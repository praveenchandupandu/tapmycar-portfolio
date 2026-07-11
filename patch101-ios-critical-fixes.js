const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch101-' + stamp;
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

console.log('\n=== TMC_PATCH101 - iOS TestFlight critical fixes ===');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // FIX 1 — vercel.json: enable cleanUrls so extensionless paths resolve
  // ===================================================================
  logStep('Fix 1: Enable cleanUrls in vercel.json (fixes 404s on /billing, /manage, /pricing, /renew, /activate, /business, /for-tow-companies)');

  const vercelPath = 'vercel.json';
  if (!fs.existsSync(vercelPath)) throw new Error('vercel.json not found');
  let vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

  if (vercelConfig.cleanUrls === true) {
    console.log('  Already enabled - no changes needed');
  } else {
    backup(vercelPath);
    vercelConfig.cleanUrls = true;
    fs.writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2) + '\n', 'utf8');
    console.log('  Added "cleanUrls": true to vercel.json');
  }

  // ===================================================================
  // FIX 2 — app.css: global top safe-area padding for iOS app
  // ===================================================================
  logStep('Fix 2: Add top safe-area padding for iOS (fixes notch/status-bar overlap on every page)');

  const cssPath = path.join('public', 'app.css');
  if (!fs.existsSync(cssPath)) throw new Error('public/app.css not found');
  let cssContent = fs.readFileSync(cssPath, 'utf8');

  const SAFE_AREA_MARKER = 'TMC_PATCH101_SAFE_AREA_TOP';
  if (cssContent.indexOf(SAFE_AREA_MARKER) !== -1) {
    console.log('  Already present - no changes needed');
  } else {
    backup(cssPath);
    const rule = '\n/* ' + SAFE_AREA_MARKER + ' */\nbody.tmc-platform-ios{padding-top:env(safe-area-inset-top);}\n';
    cssContent = cssContent + rule;
    fs.writeFileSync(cssPath, cssContent, 'utf8');
    console.log('  Added body.tmc-platform-ios safe-area-inset-top rule to app.css');
  }

  // ===================================================================
  // FIX 3 — tmc-reels.js: fix demo video close button position
  // ===================================================================
  logStep('Fix 3: Fix demo video close button being hidden under the notch');

  const reelsPath = path.join('public', 'tmc-reels.js');
  if (!fs.existsSync(reelsPath)) throw new Error('public/tmc-reels.js not found');
  let reelsContent = fs.readFileSync(reelsPath, 'utf8');
  const reelsOriginal = reelsContent;

  reelsContent = reelsContent.replace(
    '.tmc-r-close{position:absolute;top:14px;left:14px;',
    '.tmc-r-close{position:absolute;top:calc(14px + env(safe-area-inset-top));left:14px;'
  );
  reelsContent = reelsContent.replace(
    '.tmc-r-prog{position:absolute;top:14px;right:14px;',
    '.tmc-r-prog{position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;'
  );
  reelsContent = reelsContent.replace(
    '.tmc-r-tag{position:absolute;top:60px;left:0;right:0;',
    '.tmc-r-tag{position:absolute;top:calc(60px + env(safe-area-inset-top));left:0;right:0;'
  );

  if (reelsContent === reelsOriginal) {
    console.log('  WARNING: expected CSS strings not found in tmc-reels.js - skipped (check file manually)');
  } else {
    backup(reelsPath);
    fs.writeFileSync(reelsPath, reelsContent, 'utf8');
    console.log('  Fixed close button, progress bar, and tag label positions in tmc-reels.js');
  }

  // ===================================================================
  // FIX 4 — Info.plist: add camera + microphone usage descriptions
  // ===================================================================
  logStep('Fix 4: Add camera/microphone permission descriptions (fixes silent "access denied")');

  const plistPath = path.join('ios', 'App', 'App', 'Info.plist');
  if (!fs.existsSync(plistPath)) {
    console.log('  WARNING: ' + plistPath + ' not found - skipping (run after ios platform exists)');
  } else {
    let plistContent = fs.readFileSync(plistPath, 'utf8');
    const closingTag = '</dict>\n</plist>';
    const idx = plistContent.lastIndexOf(closingTag);

    if (idx === -1) {
      console.log('  WARNING: could not find closing </dict></plist> tag - skipped');
    } else {
      let insertion = '';
      if (!plistContent.includes('NSCameraUsageDescription')) {
        insertion += '\t<key>NSCameraUsageDescription</key>\n\t<string>TapMyCar needs camera access to scan your vehicle\'s QR code and NFC tag.</string>\n';
      }
      if (!plistContent.includes('NSMicrophoneUsageDescription')) {
        insertion += '\t<key>NSMicrophoneUsageDescription</key>\n\t<string>TapMyCar needs microphone access to record voice messages for masked calls.</string>\n';
      }

      if (insertion === '') {
        console.log('  Already present - no changes needed');
      } else {
        backup(plistPath);
        plistContent = plistContent.slice(0, idx) + insertion + plistContent.slice(idx);
        fs.writeFileSync(plistPath, plistContent, 'utf8');
        console.log('  Added camera/microphone usage descriptions to Info.plist');
      }
    }
  }

  console.log('\n=== TMC_PATCH101 complete ===');
  console.log('\nNext steps:');
  console.log('  1. npx cap sync ios');
  console.log('  2. git add -A && git commit -m "TMC_PATCH101: Fix iOS 404s, notch overlap, camera permission"');
  console.log('  3. git push');
  console.log('  4. Trigger a new Codemagic build - Vercel changes deploy automatically in ~60s\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
