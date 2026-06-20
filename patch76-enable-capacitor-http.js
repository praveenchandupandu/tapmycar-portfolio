#!/usr/bin/env node
/**
 * TMC_PATCH76 — Enable CapacitorHttp to bypass CORS
 *
 * Two CORS errors observed in Android emulator:
 *   1. /api/get-settings — no Access-Control-Allow-Origin header
 *   2. /api/send-otp — preflight OPTIONS gets redirected
 *
 * Root cause: Capacitor app's origin is `https://localhost`, browser
 * enforces CORS on all fetch() calls to tapmycar.io. Vercel's CORS
 * config has gaps.
 *
 * Solution: Enable Capacitor's built-in HTTP plugin (CapacitorHttp).
 * When enabled, it patches window.fetch and XMLHttpRequest to route
 * through native HTTP (Java OkHttp on Android, URLSession on iOS).
 * Native requests are NOT subject to CORS preflight. They behave
 * like a backend server call — direct HTTP, no Origin header
 * enforcement.
 *
 * Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch76-enable-capacitor-http.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-capacitor-http-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH76 — Enable CapacitorHttp (bypass CORS) ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const configPath = 'capacitor.config.ts';
  if (!fs.existsSync(configPath)) throw new Error('capacitor.config.ts not found');

  let content = fs.readFileSync(configPath, 'utf8');
  const original = content;

  if (content.indexOf('CapacitorHttp') !== -1) {
    console.log('\n  ⏩ CapacitorHttp already configured — no changes needed');
  } else {
    backup(configPath);

    // Insert CapacitorHttp at the start of the plugins object.
    // The plugins block starts with: plugins: {
    const pluginsBlockRe = /(plugins:\s*\{)\s*\n(\s+)(PushNotifications)/;
    if (!pluginsBlockRe.test(content)) {
      throw new Error('Could not find expected plugins block format in capacitor.config.ts');
    }

    content = content.replace(pluginsBlockRe, function (m, opening, indent, nextPlugin) {
      return opening + '\n' +
             indent + 'CapacitorHttp: {\n' +
             indent + '  // TMC_PATCH76 — bypasses CORS by using native HTTP\n' +
             indent + '  // (Java OkHttp on Android, URLSession on iOS).\n' +
             indent + '  // Browser CORS rules don\'t apply to native requests.\n' +
             indent + '  enabled: true\n' +
             indent + '},\n' +
             indent + nextPlugin;
    });

    fs.writeFileSync(configPath, content, { encoding: 'utf8' });
    console.log('\n  ✓ Added CapacitorHttp.enabled = true to capacitor.config.ts');
  }

  // Show the updated config
  console.log('\nCurrent plugins block:');
  const lines = content.split('\n');
  let inPlugins = false;
  let depth = 0;
  for (const line of lines) {
    if (line.includes('plugins:')) inPlugins = true;
    if (inPlugins) {
      console.log('  ' + line);
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth === 0 && line.includes('}')) break;
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH76 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nIMPORTANT — Next steps (must run all 3):');
  console.log('  1. npx cap sync android');
  console.log('     (copies updated config to android/ folder)');
  console.log('  2. In Android Studio: STOP the running app');
  console.log('     (red square button in toolbar)');
  console.log('  3. Click ▶ Run again to rebuild + re-deploy');
  console.log('  4. Try sign in again — Network error should be GONE\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
