const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch110-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH110 - Fix requireAuth() dropping the email when redirecting to signin ===');
console.log('Root cause found: manage.html (and every other protected page) checks for a');
console.log('website session, finds none (Safari has never logged in there), and redirects');
console.log('to /signin.html as a bare hardcoded link - throwing away the ?tmc_email=... we');
console.log('carefully attached in patch107/109 one step before the user ever sees the page.');

try {
  const appPath = path.join('public', 'app.js');
  if (!fs.existsSync(appPath)) throw new Error(appPath + ' not found');

  let content = fs.readFileSync(appPath, 'utf8');
  const original = content;

  const MARKER = 'TMC_PATCH110_PRESERVE_QUERY_ON_AUTH_REDIRECT';
  if (content.includes(MARKER)) {
    console.log('\n  Already patched - no changes needed');
  } else {
    const oldFn = "function requireAuth() {\r\n  const { token } = getSession();\r\n  if (!token) window.location.href = '/signin.html';\r\n  return token;\r\n}";
    const oldFnLF = "function requireAuth() {\n  const { token } = getSession();\n  if (!token) window.location.href = '/signin.html';\n  return token;\n}";

    const newFn =
      "function requireAuth() {\n" +
      "  // " + MARKER + "\n" +
      "  const { token } = getSession();\n" +
      "  if (!token) {\n" +
      "    var qs = window.location.search;\n" +
      "    window.location.href = '/signin.html' + qs;\n" +
      "  }\n" +
      "  return token;\n" +
      "}";

    if (content.includes(oldFn)) {
      content = content.replace(oldFn, newFn);
    } else if (content.includes(oldFnLF)) {
      content = content.replace(oldFnLF, newFn);
    } else {
      throw new Error('Could not find the exact requireAuth() function - check public/app.js manually');
    }

    backup(appPath);
    fs.writeFileSync(appPath, content, 'utf8');
    console.log('\n  Fixed - requireAuth() now preserves the query string (including tmc_email) on redirect');
  }

  console.log('\n=== TMC_PATCH110 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH110: Preserve query string when redirecting to signin"');
  console.log('  2. git push  (this is a WEBSITE-ONLY fix - public/app.js runs on tapmycar.io in Safari,');
  console.log('     not inside the app bundle, so NO Codemagic rebuild is needed for this one)');
  console.log('  3. Wait ~60s for Vercel to deploy, then test again: tap "View plans" in the app\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
