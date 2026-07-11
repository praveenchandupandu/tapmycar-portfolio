const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch102-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH102 - Bump iOS build number ===');

try {
  const pbxprojPath = path.join('ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  if (!fs.existsSync(pbxprojPath)) {
    throw new Error(pbxprojPath + ' not found - make sure you are in the tapmycar project folder and the ios platform exists');
  }

  fs.mkdirSync(backupDir, { recursive: true });
  backup(pbxprojPath);

  let content = fs.readFileSync(pbxprojPath, 'utf8');

  const versions = [];
  const re = /CURRENT_PROJECT_VERSION = (\d+);/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    versions.push(parseInt(match[1], 10));
  }

  if (versions.length === 0) {
    throw new Error('No CURRENT_PROJECT_VERSION entries found in project.pbxproj');
  }

  const currentMax = Math.max(...versions);
  const nextVersion = currentMax + 1;

  content = content.replace(/CURRENT_PROJECT_VERSION = \d+;/g, 'CURRENT_PROJECT_VERSION = ' + nextVersion + ';');

  fs.writeFileSync(pbxprojPath, content, 'utf8');

  console.log('  Found build number(s): ' + versions.join(', '));
  console.log('  Bumped all to: ' + nextVersion);
  console.log('\n=== TMC_PATCH102 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH102: Bump iOS build number to ' + nextVersion + '"');
  console.log('  2. git push');
  console.log('  3. Start a new Codemagic build\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
