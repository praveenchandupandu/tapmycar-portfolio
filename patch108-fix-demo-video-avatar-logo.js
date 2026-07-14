const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch108-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH108 - Use real TapMyCar logo in demo video viewer (iOS + Android) ===');

try {
  const reelsPath = path.join('public', 'tmc-reels.js');
  if (!fs.existsSync(reelsPath)) throw new Error(reelsPath + ' not found');

  let content = fs.readFileSync(reelsPath, 'utf8');
  const original = content;

  const MARKER = 'TMC_PATCH108_LOGO_AVATAR';
  if (content.includes(MARKER)) {
    console.log('\n  Already patched - no changes needed');
  } else {
    const oldLine = "    picEl.textContent  = (v.poster_initial || (v.creator_name || 'T').charAt(0)).toUpperCase();\n    picEl.style.background = v.poster_color || '#FF6B00';";

    if (!content.includes(oldLine)) {
      throw new Error('Could not find the expected avatar-rendering line in tmc-reels.js - check file manually');
    }

    const newBlock =
      '    // ' + MARKER + '\n' +
      "    if (!v.creator_name || v.creator_name === 'TapMyCar') {\n" +
      "      picEl.innerHTML = '<img src=\"/shield-icon.png\" alt=\"TapMyCar\" style=\"width:100%;height:100%;object-fit:cover;border-radius:50%\">';\n" +
      "      picEl.style.background = 'transparent';\n" +
      "    } else {\n" +
      "      picEl.textContent = (v.poster_initial || (v.creator_name || 'T').charAt(0)).toUpperCase();\n" +
      "      picEl.style.background = v.poster_color || '#FF6B00';\n" +
      "    }";

    content = content.replace(oldLine, newBlock);
    backup(reelsPath);
    fs.writeFileSync(reelsPath, content, 'utf8');
    console.log('\n  Official TapMyCar videos now show the real logo instead of a letter "T"');
    console.log('  Individual customer review videos (different creator_name) keep their own initial/color');
  }

  console.log('\n=== TMC_PATCH108 complete ===');
  console.log('\nNext steps:');
  console.log('  1. git add -A && git commit -m "TMC_PATCH108: Use real logo instead of letter avatar in demo videos"');
  console.log('  2. git push');
  console.log('  3. This is shared by BOTH platforms - fixes both iOS and Android once rebuilt:');
  console.log('     iOS:     npx cap sync ios     -> bump build number -> new Codemagic build -> TestFlight');
  console.log('     Android: npx cap sync android -> new AAB build -> upload to Play Console\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
