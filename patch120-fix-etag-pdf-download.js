const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch120-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH120 - Fix eTag PDF not actually downloading inside the native app ===');
console.log('Root cause: doc.save() uses a browser download mechanism (blob + hidden link click)');
console.log('that works fine in real Safari/Chrome, but silently does nothing inside a Capacitor');
console.log('app\'s WKWebView - there is no "Downloads" folder there. The success message was');
console.log('showing regardless, since nothing actually checked whether the save worked.');
console.log('Fix: on native platforms, open the PDF via the system browser instead, where iOS/');
console.log('Android\'s built-in PDF viewer gives a real Save/Share option that works.');

try {
  const etagPath = path.join('public', 'etag.html');
  if (!fs.existsSync(etagPath)) throw new Error(etagPath + ' not found');

  let content = fs.readFileSync(etagPath, 'utf8');
  const original = content;

  const marker = 'TMC_PATCH120_NATIVE_PDF_SAVE';
  if (content.includes(marker)) {
    console.log('\n  Already fixed - no changes needed');
  } else {
    const oldLine = "    doc.save('TapMyCar-eTag-' + tagToken + '.pdf');";

    const newBlock =
      "    // " + marker + "\n" +
      "    var tmcIsNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());\n" +
      "    if (tmcIsNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {\n" +
      "      var tmcPdfDataUri = doc.output('datauristring');\n" +
      "      window.Capacitor.Plugins.Browser.open({ url: tmcPdfDataUri });\n" +
      "    } else {\n" +
      "      doc.save('TapMyCar-eTag-' + tagToken + '.pdf');\n" +
      "    }";

    if (!content.includes(oldLine)) {
      throw new Error('Could not find the doc.save() line - check public/etag.html manually');
    }

    content = content.replace(oldLine, newBlock);
    backup(etagPath);
    fs.writeFileSync(etagPath, content, 'utf8');
    console.log('\n  Fixed - eTag PDF now opens in the system browser on iOS/Android, where the');
    console.log('  user gets a real Save/Share/Print option from the native PDF viewer');
  }

  console.log('\n=== TMC_PATCH120 complete ===');
  console.log('\nIMPORTANT - this is a genuinely different code path than before, so please test it');
  console.log('specifically on your phone after rebuilding: tap "Download free eTag PDF" and confirm');
  console.log('a PDF viewer actually opens with a working Save option. This fixes BOTH iOS and Android');
  console.log('since the same file is used by both, but only iOS gets rebuilt today.');
  console.log('\nNext steps: npx cap sync ios -> bump build -> commit -> push -> rebuild -> retest\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
