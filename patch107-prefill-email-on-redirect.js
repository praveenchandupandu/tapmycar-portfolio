const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch107-' + stamp;
const restoreQueue = [];

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
}

console.log('\n=== TMC_PATCH107 - Prefill email when redirected from app to website signin ===');

try {
  // ===================================================================
  // STEP 1 — tmc-platform.js: append the user's saved email to the URL
  // ===================================================================
  const platformPath = path.join('public', 'tmc-platform.js');
  if (!fs.existsSync(platformPath)) throw new Error(platformPath + ' not found');
  let platformContent = fs.readFileSync(platformPath, 'utf8');
  const platformOriginal = platformContent;

  const MARKER1 = 'TMC_PATCH107_EMAIL_HANDOFF';
  if (platformContent.includes(MARKER1)) {
    console.log('\n  tmcOpenWeb already patched - skipping');
  } else {
    const anchor = "    } else {\n      url = 'https://tapmycar.io/' + pathOrUrl;\n    }\n";
    if (!platformContent.includes(anchor)) {
      throw new Error('Could not find expected tmcOpenWeb URL-building block - check tmc-platform.js manually');
    }
    const insertion = anchor +
      '\n    // ' + MARKER1 + '\n' +
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

    platformContent = platformContent.replace(anchor, insertion);
    backup(platformPath);
    fs.writeFileSync(platformPath, platformContent, 'utf8');
    console.log('\n  Updated tmcOpenWeb to pass the saved email as a URL parameter');
  }

  // ===================================================================
  // STEP 2 — signin.html: read tmc_email from the URL and pre-fill it
  // ===================================================================
  const signinPath = path.join('public', 'signin.html');
  if (!fs.existsSync(signinPath)) throw new Error(signinPath + ' not found');
  let signinContent = fs.readFileSync(signinPath, 'utf8');
  const signinOriginal = signinContent;

  const MARKER2 = 'TMC_PATCH107_PREFILL_EMAIL';
  if (signinContent.includes(MARKER2)) {
    console.log('  signin.html already patched - skipping');
  } else {
    const scriptTag = '</script>\n<script>if (\'serviceWorker\' in navigator)';
    // Fallback anchor: right after the opening <body> tag if the above isn't found
    const bodyAnchor = /<body[^>]*>/;

    const prefillScript =
      '\n<script>\n' +
      '// ' + MARKER2 + '\n' +
      "(function () {\n" +
      "  try {\n" +
      "    var params = new URLSearchParams(window.location.search);\n" +
      "    var handoffEmail = params.get('tmc_email');\n" +
      "    if (handoffEmail) {\n" +
      "      document.addEventListener('DOMContentLoaded', function () {\n" +
      "        var emailInput = document.getElementById('email');\n" +
      "        if (emailInput) { emailInput.value = handoffEmail; }\n" +
      "      });\n" +
      "    }\n" +
      "  } catch (e) { /* URLSearchParams unavailable - ignore */ }\n" +
      "})();\n" +
      '</script>\n';

    if (bodyAnchor.test(signinContent)) {
      backup(signinPath);
      signinContent = signinContent.replace(bodyAnchor, function (match) { return match + prefillScript; });
      fs.writeFileSync(signinPath, signinContent, 'utf8');
      console.log('  Added email pre-fill script to signin.html');
    } else {
      throw new Error('Could not find <body> tag in signin.html - check file manually');
    }
  }

  console.log('\n=== TMC_PATCH107 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH107: Prefill email on website signin when redirected from app"');
  console.log('  2. git push  (web-only fix, live on Vercel in ~60s)');
  console.log('  3. Since app is back in bundled mode, this ALSO needs a fresh Codemagic build + TestFlight');
  console.log('     reinstall to pick up the updated tmc-platform.js inside the app bundle.\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
