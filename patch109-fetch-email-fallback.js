const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch109-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH109 - Fetch email from account API when not already cached ===');
console.log('Root cause: main app login is phone-based and never saves email to');
console.log('localStorage at all, so patch107 had nothing to read for most users.');

try {
  const platformPath = path.join('public', 'tmc-platform.js');
  if (!fs.existsSync(platformPath)) throw new Error(platformPath + ' not found');

  let content = fs.readFileSync(platformPath, 'utf8');
  const original = content;

  const MARKER107 = 'TMC_PATCH107_EMAIL_HANDOFF';
  const MARKER109 = 'TMC_PATCH109_EMAIL_FETCH_FALLBACK';

  if (content.includes(MARKER109)) {
    console.log('\n  Already patched - no changes needed');
  } else {
    const oldBlock =
      "    // " + MARKER107 + "\n" +
      "    // Pass along the signed-in user's email so the external browser\n" +
      "    // (separate storage from the app) can pre-fill sign-in instead of\n" +
      "    // asking for it from scratch.\n" +
      "    try {\n" +
      "      var tmcSavedEmail = localStorage.getItem('tmc_email');\n" +
      "      if (tmcSavedEmail) {\n" +
      "        var sep = url.indexOf('?') === -1 ? '?' : '&';\n" +
      "        url = url + sep + 'tmc_email=' + encodeURIComponent(tmcSavedEmail);\n" +
      "      }\n" +
      "    } catch (e) { /* localStorage unavailable - ignore */ }\n";

    if (!content.includes(oldBlock)) {
      throw new Error('Could not find the patch107 block to replace - check tmc-platform.js manually');
    }

    const newBlock =
      "    // " + MARKER107 + " + " + MARKER109 + "\n" +
      "    // Pass along the signed-in user's email so the external browser\n" +
      "    // (separate storage from the app) can pre-fill sign-in instead of\n" +
      "    // asking for it from scratch. Most accounts log in by phone, so\n" +
      "    // tmc_email may never have been cached - fetch it fresh if missing.\n" +
      "    try {\n" +
      "      var tmcSavedEmail = localStorage.getItem('tmc_email');\n" +
      "      if (!tmcSavedEmail) {\n" +
      "        var tmcToken = localStorage.getItem('tmc_token');\n" +
      "        if (tmcToken) {\n" +
      "          try {\n" +
      "            var tmcResp = await fetch('/api/get-dashboard?user_id=' + tmcToken);\n" +
      "            var tmcData = await tmcResp.json();\n" +
      "            if (tmcData && tmcData.user && tmcData.user.email) {\n" +
      "              tmcSavedEmail = tmcData.user.email;\n" +
      "              localStorage.setItem('tmc_email', tmcSavedEmail);\n" +
      "            }\n" +
      "          } catch (fetchErr) { /* network issue - proceed without email */ }\n" +
      "        }\n" +
      "      }\n" +
      "      if (tmcSavedEmail) {\n" +
      "        var sep = url.indexOf('?') === -1 ? '?' : '&';\n" +
      "        url = url + sep + 'tmc_email=' + encodeURIComponent(tmcSavedEmail);\n" +
      "      }\n" +
      "    } catch (e) { /* localStorage unavailable - ignore */ }\n";

    content = content.replace(oldBlock, newBlock);
    backup(platformPath);
    fs.writeFileSync(platformPath, content, 'utf8');
    console.log('\n  tmcOpenWeb now fetches the email from your account if not already cached');
  }

  console.log('\n=== TMC_PATCH109 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH109: Fetch email from account API for redirect prefill"');
  console.log('  2. git push');
  console.log('  3. npx cap sync ios');
  console.log('  4. Bump build number, commit, push, trigger new Codemagic build, reinstall via TestFlight\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
