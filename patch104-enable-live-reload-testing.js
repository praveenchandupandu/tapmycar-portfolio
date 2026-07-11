const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch104-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH104 - Enable iOS live-reload TESTING mode + bump build number ===');
console.log('IMPORTANT: This is a TEMPORARY testing mode. Must be reverted before final App Store submission.');

try {
  fs.mkdirSync(backupDir, { recursive: true });

  // ===================================================================
  // STEP 1 — Enable live-reload mode in capacitor.config.ts
  // ===================================================================
  const configPath = 'capacitor.config.ts';
  if (!fs.existsSync(configPath)) throw new Error('capacitor.config.ts not found');

  let configContent = fs.readFileSync(configPath, 'utf8');
  const MARKER = 'TMC_PATCH104_LIVE_RELOAD_TESTING_MODE';

  if (configContent.includes(MARKER)) {
    console.log('\n  Live-reload mode already enabled - no changes needed');
  } else {
    const oldServerBlock = `server: {
    androidScheme: 'https',
    iosScheme: 'https',`;

    if (!configContent.includes(oldServerBlock)) {
      throw new Error('Could not find expected server block in capacitor.config.ts - check file manually');
    }

    backup(configPath);

    const newServerBlock = `server: {
    // ${MARKER}
    // TEMPORARY: loads the live tapmycar.io website instead of bundled files,
    // so CSS/HTML/JS fixes show up on refresh without a full rebuild.
    // MUST REMOVE the "url" line below before the final App Store submission build.
    url: 'https://tapmycar.io',
    androidScheme: 'https',
    iosScheme: 'https',`;

    configContent = configContent.replace(oldServerBlock, newServerBlock);
    fs.writeFileSync(configPath, configContent, 'utf8');
    console.log('\n  Enabled live-reload mode - app will now load https://tapmycar.io live');
  }

  // ===================================================================
  // STEP 2 — Bump iOS build number (every new Codemagic upload needs this)
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

  console.log('\n=== TMC_PATCH104 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH104: Enable live-reload testing mode, bump build number"');
  console.log('  2. git push');
  console.log('  3. Start a new Codemagic build - this is the LAST build needed for a while');
  console.log('  4. Reinstall via TestFlight once');
  console.log('  5. After this, any public/ file changes just need: git push (Vercel auto-deploys in ~60s),');
  console.log('     then fully quit and reopen the app on your phone to see the update - no more builds needed');
  console.log('     for CSS/HTML/JS fixes. Only native changes (Info.plist, icons, plugins) need a rebuild.\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
