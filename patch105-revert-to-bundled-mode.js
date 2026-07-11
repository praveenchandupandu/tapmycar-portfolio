const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch105-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH105 - Revert live-reload mode back to working bundled setup ===');

try {
  fs.mkdirSync(backupDir, { recursive: true });

  // ===================================================================
  // STEP 1 — Remove the live-reload server.url from capacitor.config.ts
  // ===================================================================
  const configPath = 'capacitor.config.ts';
  if (!fs.existsSync(configPath)) throw new Error('capacitor.config.ts not found');

  let configContent = fs.readFileSync(configPath, 'utf8');
  const MARKER = 'TMC_PATCH104_LIVE_RELOAD_TESTING_MODE';

  if (!configContent.includes(MARKER)) {
    console.log('\n  Live-reload mode not present - nothing to revert');
  } else {
    backup(configPath);

    const liveReloadBlock = `server: {
    // ${MARKER}
    // TEMPORARY: loads the live tapmycar.io website instead of bundled files,
    // so CSS/HTML/JS fixes show up on refresh without a full rebuild.
    // MUST REMOVE the "url" line below before the final App Store submission build.
    url: 'https://tapmycar.io',
    androidScheme: 'https',
    iosScheme: 'https',`;

    const bundledBlock = `server: {
    androidScheme: 'https',
    iosScheme: 'https',`;

    if (!configContent.includes(liveReloadBlock)) {
      throw new Error('Could not find the exact live-reload block to revert - check capacitor.config.ts manually');
    }

    configContent = configContent.replace(liveReloadBlock, bundledBlock);
    fs.writeFileSync(configPath, configContent, 'utf8');
    console.log('\n  Reverted to bundled mode (removed live-reload url)');
  }

  // ===================================================================
  // STEP 2 — Bump iOS build number for the new build
  // ===================================================================
  const pbxprojPath = path.join('ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  if (!fs.existsSync(pbxprojPath)) {
    console.log('\n  WARNING: ' + pbxprojPath + ' not found - skipping build number bump');
  } else {
    backup(pbxprojPath);
    let pbxContent = fs.readFileSync(pbxprojPath, 'utf8');

    const versions = [];
    const re = /CURRENT_PROJECT_VERSION = (\d+);/g;
    let match;
    while ((match = re.exec(pbxContent)) !== null) {
      versions.push(parseInt(match[1], 10));
    }

    if (versions.length === 0) {
      console.log('\n  WARNING: no CURRENT_PROJECT_VERSION found - skipping build number bump');
    } else {
      const nextVersion = Math.max(...versions) + 1;
      pbxContent = pbxContent.replace(/CURRENT_PROJECT_VERSION = \d+;/g, 'CURRENT_PROJECT_VERSION = ' + nextVersion + ';');
      fs.writeFileSync(pbxprojPath, pbxContent, 'utf8');
      console.log('\n  Bumped iOS build number to ' + nextVersion);
    }
  }

  console.log('\n=== TMC_PATCH105 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH105: Revert to bundled mode - fixes loading/login issue"');
  console.log('  2. git push');
  console.log('  3. Start a new Codemagic build');
  console.log('  4. Reinstall via TestFlight - your login and data will work normally again\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
