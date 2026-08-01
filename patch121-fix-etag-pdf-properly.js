const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch121-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH121 - Properly fix eTag PDF save using native Filesystem + Share ===');
console.log('patch120 tried opening the PDF via Safari using a data: URI - that does not work,');
console.log('since Safari\'s in-app browser view is built for real web pages, not raw file data,');
console.log('and fails silently. This uses the actual correct mechanism: write the file to the');
console.log('device, then open the native iOS Share Sheet so the user can Save to Files.');

try {
  const etagPath = path.join('public', 'etag.html');
  if (!fs.existsSync(etagPath)) throw new Error(etagPath + ' not found');

  let content = fs.readFileSync(etagPath, 'utf8');
  const original = content;

  const marker = 'TMC_PATCH121_FILESYSTEM_SHARE';
  if (content.includes(marker)) {
    console.log('\n  Already fixed - no changes needed');
  } else {
    const oldBlock =
      "    // Save PDF\n" +
      "    // TMC_PATCH120_NATIVE_PDF_SAVE\n" +
      "    var tmcIsNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());\n" +
      "    if (tmcIsNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {\n" +
      "      var tmcPdfDataUri = doc.output('datauristring');\n" +
      "      window.Capacitor.Plugins.Browser.open({ url: tmcPdfDataUri });\n" +
      "    } else {\n" +
      "      doc.save('TapMyCar-eTag-' + tagToken + '.pdf');\n" +
      "    }\n" +
      "\n" +
      "    btn.innerHTML = '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.5\" stroke-linecap=\"round\"><polyline points=\"20 6 9 17 4 12\"/></svg> Downloaded!';\n" +
      "    btn.style.background = 'var(--gn)';\n" +
      "    showToast('eTag PDF saved! Check your Downloads folder.');\n";

    if (!content.includes(oldBlock)) {
      throw new Error('Could not find the patch120 block to replace - check public/etag.html manually');
    }

    const newBlock =
      "    // Save PDF\n" +
      "    // " + marker + "\n" +
      "    var tmcIsNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());\n" +
      "    var tmcShowSuccess = function () {\n" +
      "      btn.innerHTML = '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.5\" stroke-linecap=\"round\"><polyline points=\"20 6 9 17 4 12\"/></svg> Downloaded!';\n" +
      "      btn.style.background = 'var(--gn)';\n" +
      "      showToast(tmcIsNative ? 'eTag PDF ready - choose Save to Files' : 'eTag PDF saved! Check your Downloads folder.');\n" +
      "    };\n" +
      "    var tmcShowError = function () {\n" +
      "      btn.innerHTML = 'Download free eTag PDF';\n" +
      "      btn.disabled = false;\n" +
      "      showToast('Could not save PDF - please try again');\n" +
      "    };\n" +
      "\n" +
      "    if (tmcIsNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {\n" +
      "      var tmcDataUri = doc.output('datauristring');\n" +
      "      var tmcBase64 = tmcDataUri.split(',')[1];\n" +
      "      var tmcFileName = 'TapMyCar-eTag-' + tagToken + '.pdf';\n" +
      "      window.Capacitor.Plugins.Filesystem.writeFile({\n" +
      "        path: tmcFileName,\n" +
      "        data: tmcBase64,\n" +
      "        directory: 'CACHE'\n" +
      "      }).then(function (result) {\n" +
      "        tmcShowSuccess();\n" +
      "        return window.Capacitor.Plugins.Share.share({ title: 'TapMyCar eTag', url: result.uri });\n" +
      "      }).catch(function (err) {\n" +
      "        console.error('eTag PDF save/share failed:', err);\n" +
      "        tmcShowError();\n" +
      "      });\n" +
      "    } else {\n" +
      "      doc.save('TapMyCar-eTag-' + tagToken + '.pdf');\n" +
      "      tmcShowSuccess();\n" +
      "    }\n";

    content = content.replace(oldBlock, newBlock);
    backup(etagPath);
    fs.writeFileSync(etagPath, content, 'utf8');
    console.log('\n  Fixed - eTag PDF now uses Filesystem.writeFile + native Share Sheet on iOS/Android');
  }

  console.log('\n=== TMC_PATCH121 complete ===');
  console.log('\nIMPORTANT - this needs two NEW packages installed first. Run BEFORE cap sync:');
  console.log('  npm install @capacitor/filesystem @capacitor/share');
  console.log('\nThen: npx cap sync ios -> bump build -> commit -> push -> rebuild -> retest\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
