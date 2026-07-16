const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch112-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH112 - Make page-guard reuse tmcOpenWeb instead of bypassing it ===');
console.log('Root cause: tmc-page-guard.js (auto-redirect for billing.html, activate.html, etc.)');
console.log('built its own URL and called Browser.open() directly, completely skipping the');
console.log('tmcOpenWeb function that fetches and attaches the email. Only buttons that called');
console.log('tmcOpenWeb directly (like "View plans") were ever getting the fix.');

try {
  const guardPath = path.join('public', 'tmc-page-guard.js');
  if (!fs.existsSync(guardPath)) throw new Error(guardPath + ' not found');

  let content = fs.readFileSync(guardPath, 'utf8');
  const original = content;

  const MARKER = 'TMC_PATCH112_USE_TMCOPENWEB';
  if (content.includes(MARKER)) {
    console.log('\n  Already patched - no changes needed');
  } else {
    const oldBlock =
      "    var webUrl = 'https://www.tapmycar.io' + webPath + (window.location.search || '') + (window.location.hash || '');\n" +
      "    console.log('[tmc-page-guard] iOS \u2014 redirecting blocked page ' + path + ' \u2192 ' + webUrl);\n" +
      "\n" +
      "    // Open the web equivalent in external Safari\n" +
      "    try {\n" +
      "      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {\n" +
      "        window.Capacitor.Plugins.Browser.open({ url: webUrl });\n" +
      "      }\n" +
      "    } catch (e) { /* swallow */ }\n";

    if (!content.includes(oldBlock)) {
      throw new Error('Could not find the expected redirect block - check tmc-page-guard.js manually');
    }

    const newBlock =
      "    console.log('[tmc-page-guard] iOS \u2014 redirecting blocked page ' + path + ' \u2192 ' + webPath);\n" +
      "\n" +
      "    // " + MARKER + "\n" +
      "    // Route through tmcOpenWeb (same function every button uses) instead of\n" +
      "    // building the URL and opening Safari directly here - this ensures the\n" +
      "    // signed-in user's email is always fetched and attached consistently,\n" +
      "    // regardless of whether the redirect was triggered by a button tap or by\n" +
      "    // this automatic page-guard.\n" +
      "    try {\n" +
      "      if (window.tmcOpenWeb) {\n" +
      "        window.tmcOpenWeb(webPath + (window.location.search || '') + (window.location.hash || ''));\n" +
      "      } else if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {\n" +
      "        var fallbackUrl = 'https://www.tapmycar.io' + webPath + (window.location.search || '') + (window.location.hash || '');\n" +
      "        window.Capacitor.Plugins.Browser.open({ url: fallbackUrl });\n" +
      "      }\n" +
      "    } catch (e) { /* swallow */ }\n";

    content = content.replace(oldBlock, newBlock);
    backup(guardPath);
    fs.writeFileSync(guardPath, content, 'utf8');
    console.log('\n  Fixed - page-guard now uses tmcOpenWeb (email fetch/attach included)');
  }

  console.log('\n=== TMC_PATCH112 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH112: Route page-guard redirects through tmcOpenWeb"');
  console.log('  2. git push');
  console.log('  3. This file (tmc-platform.js sibling) runs INSIDE the app bundle, so this DOES');
  console.log('     need: npx cap sync ios -> bump build number -> new Codemagic build -> TestFlight\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
