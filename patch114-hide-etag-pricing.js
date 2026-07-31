const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch114-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH114 - Hide pricing promo on etag.html (reachable from Settings AND Manage) ===');

try {
  const etagPath = path.join('public', 'etag.html');
  if (!fs.existsSync(etagPath)) throw new Error(etagPath + ' not found');

  let content = fs.readFileSync(etagPath, 'utf8');
  const original = content;

  const oldDiv = '<div id="standard-promo" style="width:100%;background:linear-gradient(135deg,#FF6B00,#D21209);border-radius:18px;padding:22px 18px;position:relative;overflow:hidden;text-align:center">';
  const newDiv = '<div id="standard-promo" class="tmc-hide-on-ios" style="width:100%;background:linear-gradient(135deg,#FF6B00,#D21209);border-radius:18px;padding:22px 18px;position:relative;overflow:hidden;text-align:center">';

  if (content.includes(newDiv)) {
    console.log('  Already hidden - confirmed correct');
  } else if (content.includes(oldDiv)) {
    content = content.replace(oldDiv, newDiv);
    backup(etagPath);
    fs.writeFileSync(etagPath, content, 'utf8');
    console.log('  Fixed - hid the "$9.99/yr Get Standard" pricing promo on etag.html');
    console.log('  (the free eTag download itself remains fully functional - only the paid-tier promo is hidden)');
  } else {
    console.log('  WARNING: #standard-promo not found in expected form - check manually');
  }

  console.log('\n=== TMC_PATCH114 complete ===');
  console.log('\nNext steps: same as patch113 - cap sync, bump build, commit, push, rebuild, retest.\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
