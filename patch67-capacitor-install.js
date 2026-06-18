#!/usr/bin/env node
/**
 * TMC_PATCH67 — Capacitor Install + Platform Helpers
 *
 * Goals:
 *   1. Add Capacitor + plugin dependencies to package.json
 *   2. Create capacitor.config.ts in project root
 *   3. Create public/tmc-platform.js (platform detection + openWebUrl helper)
 *   4. Inject <script src="/tmc-platform.js"></script> after tmc-api-base.js
 *      in all public/*.html files
 *   5. Update .gitignore for Capacitor / native build artifacts
 *   6. Mirror public/*.html → project root (sync convention)
 *
 * Behavior:
 *   - Website (no Capacitor): tmcPlatform = "web", body gets .tmc-in-web class.
 *     tmcOpenWeb(path) navigates normally. Zero visible change to users.
 *   - App (post Capacitor build): tmcPlatform = "ios" or "android",
 *     body gets .tmc-in-app class. tmcOpenWeb(path) opens Safari/Chrome
 *     via @capacitor/browser plugin (external browser, not in-app webview).
 *   - Backward compatible. Idempotent. Safe to re-run.
 *
 * After this patch, run:
 *   npm install      # downloads ~50MB of Capacitor packages, ~30-60s
 *
 * Run from inside the tapmycar project folder:
 *   node patch67-capacitor-install.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// -------------------------------------------------------------------
// Backup folder
// -------------------------------------------------------------------
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
].join('-');
const backupDir = 'backup-capacitor-install-' + stamp;

const restoreQueue = [];

function logStep(label) {
  console.log('\n=== ' + label + ' ===');
}

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
  restoreQueue.push({ orig: filePath, copy: dest });
}

function restoreAll() {
  console.error('\n⚠ Restoring all files from backup...');
  for (const { orig, copy } of restoreQueue) {
    try { fs.copyFileSync(copy, orig); }
    catch (e) { console.error('  Failed to restore ' + orig + ': ' + e.message); }
  }
  console.error('Restore complete. Backup folder kept at: ' + backupDir);
}

function safeReplace(str, pattern, replacement) {
  if (typeof replacement === 'function') return str.replace(pattern, replacement);
  return str.replace(pattern, function () { return replacement; });
}

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH67 — Capacitor Install + Helpers        ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Update package.json with Capacitor dependencies
  // ===================================================================
  logStep('Step 1: Update package.json with Capacitor dependencies');

  const pkgPath = 'package.json';
  if (!fs.existsSync(pkgPath)) throw new Error('package.json not found');

  backup(pkgPath);
  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  let pkg;
  try { pkg = JSON.parse(pkgRaw); }
  catch (e) { throw new Error('package.json is not valid JSON: ' + e.message); }

  if (!pkg.dependencies) pkg.dependencies = {};
  if (!pkg.devDependencies) pkg.devDependencies = {};

  const capDeps = {
    '@capacitor/core': '^6.1.2',
    '@capacitor/android': '^6.1.2',
    '@capacitor/ios': '^6.1.2',
    '@capacitor/app': '^6.0.1',
    '@capacitor/browser': '^6.0.3',
    '@capacitor/push-notifications': '^6.0.2'
  };
  const capDevDeps = {
    '@capacitor/cli': '^6.1.2'
  };

  let depsAdded = 0;
  for (const [name, version] of Object.entries(capDeps)) {
    if (pkg.dependencies[name]) {
      console.log('  ⏩ ' + name + ' already in dependencies');
    } else {
      pkg.dependencies[name] = version;
      console.log('  ✓ Added ' + name + ' ' + version);
      depsAdded++;
    }
  }
  for (const [name, version] of Object.entries(capDevDeps)) {
    if (pkg.devDependencies[name]) {
      console.log('  ⏩ ' + name + ' already in devDependencies');
    } else {
      pkg.devDependencies[name] = version;
      console.log('  ✓ Added ' + name + ' ' + version + ' (dev)');
      depsAdded++;
    }
  }

  // Sort keys for cleanliness
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort());
  pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).sort());

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', { encoding: 'utf8' });
  console.log('  Total new dependencies: ' + depsAdded);

  // ===================================================================
  // STEP 2 — Create capacitor.config.ts
  // ===================================================================
  logStep('Step 2: Create capacitor.config.ts');

  const capConfigPath = 'capacitor.config.ts';
  const capConfig = [
    'import { CapacitorConfig } from \'@capacitor/cli\';',
    '',
    '// TMC_PATCH67 — Capacitor config for TapMyCar+',
    '// appId matches the Bundle ID registered in Apple Developer Portal.',
    '// webDir = public, where our static site lives.',
    '',
    'const config: CapacitorConfig = {',
    '  appId: \'io.tapmycar.app\',',
    '  appName: \'TapMyCar+\',',
    '  webDir: \'public\',',
    '  server: {',
    '    androidScheme: \'https\',',
    '    iosScheme: \'https\',',
    '    // External domains allowed for navigation/fetch from inside the app',
    '    allowNavigation: [',
    '      \'tapmycar.io\',',
    '      \'*.tapmycar.io\',',
    '      \'api.stripe.com\',',
    '      \'js.stripe.com\',',
    '      \'checkout.stripe.com\'',
    '    ]',
    '  },',
    '  plugins: {',
    '    PushNotifications: {',
    '      presentationOptions: [\'badge\', \'sound\', \'alert\']',
    '    },',
    '    Browser: {',
    '      // External browser for purchase flows (opens Safari on iOS, Chrome on Android)',
    '    }',
    '  }',
    '};',
    '',
    'export default config;',
    ''
  ].join('\n');

  if (fs.existsSync(capConfigPath)) {
    backup(capConfigPath);
    console.log('  ⏩ capacitor.config.ts already exists — overwriting (backup saved)');
  }
  fs.writeFileSync(capConfigPath, capConfig, { encoding: 'utf8' });
  console.log('  ✓ Wrote capacitor.config.ts');

  // ===================================================================
  // STEP 3 — Create public/tmc-platform.js
  // ===================================================================
  logStep('Step 3: Create public/tmc-platform.js');

  const platformJsPath = path.join('public', 'tmc-platform.js');
  const platformJs = [
    '// TMC_PATCH67 — Platform detection + web-navigation helper',
    '//',
    '// Exposes:',
    '//   window.tmcPlatform     "web" | "ios" | "android"',
    '//   window.tmcIsInApp      true when running inside Capacitor',
    '//   window.tmcOpenWeb(path) Opens tapmycar.io in the right way per platform',
    '//',
    '// On body load adds classes:',
    '//   .tmc-platform-web | .tmc-platform-ios | .tmc-platform-android',
    '//   .tmc-in-app (mobile) | .tmc-in-web (browser)',
    '//',
    '// Use these classes in CSS to hide/show platform-specific UI in future patches.',
    '',
    '(function () {',
    '  if (typeof window === \'undefined\') return;',
    '',
    '  function getPlatform() {',
    '    try {',
    '      if (window.Capacitor && typeof window.Capacitor.getPlatform === \'function\') {',
    '        return window.Capacitor.getPlatform();',
    '      }',
    '    } catch (e) { /* fall through */ }',
    '    return \'web\';',
    '  }',
    '',
    '  var platform = getPlatform();',
    '  var inApp = (platform === \'ios\' || platform === \'android\');',
    '',
    '  window.tmcPlatform = platform;',
    '  window.tmcIsInApp = inApp;',
    '',
    '  // Add body classes once DOM is ready',
    '  function addBodyClasses() {',
    '    if (!document.body) return;',
    '    document.body.classList.add(\'tmc-platform-\' + platform);',
    '    document.body.classList.add(inApp ? \'tmc-in-app\' : \'tmc-in-web\');',
    '  }',
    '  if (document.readyState === \'loading\') {',
    '    document.addEventListener(\'DOMContentLoaded\', addBodyClasses);',
    '  } else {',
    '    addBodyClasses();',
    '  }',
    '',
    '  // Open a URL on tapmycar.io. In the app, uses Capacitor Browser plugin',
    '  // (opens Safari/Chrome externally). On the web, normal navigation.',
    '  window.tmcOpenWeb = async function (pathOrUrl) {',
    '    var url;',
    '    if (!pathOrUrl) {',
    '      url = \'https://tapmycar.io/\';',
    '    } else if (pathOrUrl.indexOf(\'http://\') === 0 || pathOrUrl.indexOf(\'https://\') === 0) {',
    '      url = pathOrUrl;',
    '    } else if (pathOrUrl.indexOf(\'/\') === 0) {',
    '      url = \'https://tapmycar.io\' + pathOrUrl;',
    '    } else {',
    '      url = \'https://tapmycar.io/\' + pathOrUrl;',
    '    }',
    '',
    '    if (!inApp) {',
    '      window.location.href = url;',
    '      return;',
    '    }',
    '',
    '    // In app: try Capacitor Browser plugin first',
    '    try {',
    '      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {',
    '        await window.Capacitor.Plugins.Browser.open({ url: url });',
    '        return;',
    '      }',
    '    } catch (e) { /* fall through to default */ }',
    '',
    '    // Fallback',
    '    window.location.href = url;',
    '  };',
    '})();',
    ''
  ].join('\n');

  if (fs.existsSync(platformJsPath)) backup(platformJsPath);
  fs.writeFileSync(platformJsPath, platformJs, { encoding: 'utf8' });
  console.log('  ✓ Wrote ' + platformJsPath);

  // node --check syntax validation
  try {
    execSync('node --check "' + platformJsPath + '"', { stdio: 'pipe' });
    console.log('  ✓ Syntax valid');
  } catch (e) {
    throw new Error('tmc-platform.js failed node --check: ' + e.message);
  }

  // ===================================================================
  // STEP 4 — Inject script tag into all public/*.html files
  // ===================================================================
  logStep('Step 4: Inject tmc-platform.js script tag into public/*.html');

  const publicDir = 'public';
  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
  console.log('  Found ' + htmlFiles.length + ' HTML files');

  // We need to inject AFTER the tmc-api-base.js script tag (from Patch 66),
  // so the platform helper loads in sequence.
  const apiBaseTagRe = /(<script[^>]*src="\/tmc-api-base\.js"[^>]*><\/script>)(\s*\r?\n?)/i;
  const headOpenRe = /<head(\s[^>]*)?>(\s*\r?\n?)/i;
  const platformTag = '<script src="/tmc-platform.js"></script>';

  let injected = 0, skipped = 0, warned = 0;

  for (const file of htmlFiles) {
    const filePath = path.join(publicDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Idempotent
    if (content.indexOf('tmc-platform.js') !== -1) {
      console.log('  ⏩ ' + file + ' — already has platform helper');
      skipped++;
      continue;
    }

    backup(filePath);
    let newContent;

    if (apiBaseTagRe.test(content)) {
      // Inject right after tmc-api-base.js script tag
      newContent = safeReplace(content, apiBaseTagRe, function (match, tag, ws) {
        var wsPart = ws || '\n';
        return tag + wsPart + '  ' + platformTag + '\n';
      });
    } else if (headOpenRe.test(content)) {
      // Fallback: inject right after <head> opening (Patch 66 may not have run on this file)
      console.log('  ⚠ ' + file + ' — no tmc-api-base.js tag found, injecting at top of <head>');
      newContent = safeReplace(content, headOpenRe, function (match, attrs, ws) {
        var attrsPart = attrs || '';
        var wsPart = ws || '\n';
        return '<head' + attrsPart + '>' + wsPart + '  ' + platformTag + '\n';
      });
      warned++;
    } else {
      console.log('  ⚠ ' + file + ' — no <head> tag found, skipped');
      warned++;
      continue;
    }

    fs.writeFileSync(filePath, newContent, { encoding: 'utf8' });
    console.log('  ✓ ' + file);
    injected++;
  }

  console.log('\n  Summary: ' + injected + ' injected, ' + skipped + ' already done, ' + warned + ' warnings');

  // ===================================================================
  // STEP 5 — Update .gitignore
  // ===================================================================
  logStep('Step 5: Update .gitignore for Capacitor');

  const gitignorePath = '.gitignore';
  let gitignoreContent = '';
  if (fs.existsSync(gitignorePath)) {
    backup(gitignorePath);
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  }

  const newEntries = [
    '',
    '# TMC_PATCH67 — Capacitor / native build artifacts',
    'node_modules/',
    'android/build/',
    'android/.gradle/',
    'android/app/build/',
    'android/app/release/',
    'android/local.properties',
    'android/.idea/',
    'android/*.iml',
    'ios/App/build/',
    'ios/App/Pods/',
    'ios/App/Podfile.lock',
    'ios/DerivedData/',
    'ios/.xcode.env.local',
    '.DS_Store',
    ''
  ];

  // Check if marker is already there (idempotent)
  if (gitignoreContent.indexOf('TMC_PATCH67') !== -1) {
    console.log('  ⏩ .gitignore already has Capacitor entries');
  } else {
    // Ensure file ends with newline before appending
    if (gitignoreContent.length > 0 && !gitignoreContent.endsWith('\n')) {
      gitignoreContent += '\n';
    }
    gitignoreContent += newEntries.join('\n');
    fs.writeFileSync(gitignorePath, gitignoreContent, { encoding: 'utf8' });
    console.log('  ✓ Added ' + newEntries.length + ' entries to .gitignore');
  }

  // ===================================================================
  // STEP 6 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 6: Sync public/*.html → project root');

  let synced = 0, skippedSync = 0;
  for (const file of htmlFiles) {
    const src = path.join(publicDir, file);
    const dest = file;
    if (!fs.existsSync(dest)) { skippedSync++; continue; }
    try { fs.copyFileSync(src, dest); synced++; }
    catch (e) { console.log('  ⚠ Could not sync ' + file + ': ' + e.message); }
  }
  console.log('  ✓ Synced ' + synced + ' HTML files to root (' + skippedSync + ' not present at root, skipped)');

  // ===================================================================
  // SUCCESS
  // ===================================================================
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH67 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\n*** IMPORTANT NEXT STEP ***');
  console.log('You must now run:  npm install');
  console.log('(This downloads ~50MB of Capacitor packages, takes 30-60 seconds)');
  console.log('\nAfter npm install completes:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH67: Capacitor install + platform helpers"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Open tapmycar.io in incognito');
  console.log('  6. Open DevTools console, type:  tmcPlatform');
  console.log('     Should print: "web"');
  console.log('  7. Type:  document.body.classList.contains("tmc-in-web")');
  console.log('     Should print: true');
  console.log('  8. Verify the website otherwise behaves identically');
  console.log('  9. Reply "verified" and we proceed to Patch 68\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
