const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch116-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH116 - Fix "buy a plan" text on Home screen Invite a Friend tile ===');
console.log('This tile is unconditionally visible to EVERY user on the Home screen - the');
console.log('exact screen in Apple\'s attached rejection screenshot - and was never touched');
console.log('by any earlier patch.');

try {
  const dashPath = path.join('public', 'dashboard.html');
  if (!fs.existsSync(dashPath)) throw new Error(dashPath + ' not found');

  let content = fs.readFileSync(dashPath, 'utf8');
  const original = content;

  content = content.replace(
    'Get discounts when friends buy a plan!',
    'Get discounts when friends join!'
  );

  if (content === original) {
    if (content.includes('Get discounts when friends join!')) {
      console.log('  Already fixed - confirmed correct');
    } else {
      console.log('  WARNING: expected text not found - check dashboard.html manually');
    }
  } else {
    backup(dashPath);
    fs.writeFileSync(dashPath, content, 'utf8');
    console.log('  Fixed - Invite a Friend tile no longer mentions "buy a plan"');
  }

  console.log('\n=== TMC_PATCH116 complete ===');
  console.log('\nNext steps: npx cap sync ios -> bump build -> commit -> push -> rebuild -> retest\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
