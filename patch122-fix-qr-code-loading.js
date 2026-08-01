const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch122-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH122 - Fix broken QR codes with retry + visible fallback ===');
console.log('Root cause: the QR code library loads from an external CDN with zero error');
console.log('handling. If that script is slow (or the API data comes back faster than the');
console.log('script finishes loading - a real race condition), the QR silently never renders,');
console.log('leaving an empty box with no feedback. This adds automatic retry (up to ~3');
console.log('seconds) and a real "Tap to retry" fallback if it still fails.');

const HELPER = `
    // TMC_PATCH122_SAFE_QRCODE
    function tmcSafeQRCode(containerId, options, retriesLeft) {
      retriesLeft = typeof retriesLeft === 'number' ? retriesLeft : 20;
      var container = document.getElementById(containerId);
      if (!container) return;
      var tryAgain = function () {
        if (retriesLeft > 0) {
          setTimeout(function () { tmcSafeQRCode(containerId, options, retriesLeft - 1); }, 150);
        } else {
          container.innerHTML = '<div style="cursor:pointer;font-size:11px;color:#DC2626;text-align:center;padding:10px;line-height:1.4" onclick="location.reload()">Couldn\\'t load QR<br>Tap to retry</div>';
        }
      };
      if (typeof QRCode === 'undefined') { tryAgain(); return; }
      try {
        container.innerHTML = '';
        new QRCode(container, options);
      } catch (e) {
        tryAgain();
      }
    }
`;

let anyChanged = false;

try {
  // ===================================================================
  // FIX 1 — dashboard.html
  // ===================================================================
  const dashPath = path.join('public', 'dashboard.html');
  if (fs.existsSync(dashPath)) {
    let content = fs.readFileSync(dashPath, 'utf8');
    const original = content;

    if (!content.includes('TMC_PATCH122_SAFE_QRCODE')) {
      const oldCall =
        "      document.getElementById('qr-container').innerHTML = '';\n" +
        "      new QRCode(document.getElementById('qr-container'), {\n" +
        "        text: tagURL,\n" +
        "        width: 114,\n" +
        "        height: 114,\n" +
        "        colorDark: '#111111',\n" +
        "        colorLight: '#ffffff',\n" +
        "        correctLevel: QRCode.CorrectLevel.M\n" +
        "      });";

      const newCall =
        "      tmcSafeQRCode('qr-container', {\n" +
        "        text: tagURL,\n" +
        "        width: 114,\n" +
        "        height: 114,\n" +
        "        colorDark: '#111111',\n" +
        "        colorLight: '#ffffff',\n" +
        "        correctLevel: QRCode.CorrectLevel.M\n" +
        "      });";

      if (content.includes(oldCall)) {
        content = content.replace(oldCall, newCall);
        content = content.replace('async function loadDashboard()', HELPER + '\n    async function loadDashboard()');
        backup(dashPath);
        fs.writeFileSync(dashPath, content, 'utf8');
        console.log('\n  dashboard.html: fixed - QR code now retries automatically with a visible fallback');
        anyChanged = true;
      } else {
        console.log('\n  dashboard.html: expected QR code pattern not found - check manually');
      }
    } else {
      console.log('\n  dashboard.html: already fixed');
    }
  }

  // ===================================================================
  // FIX 2 — etag.html (3 QR codes: preview, hidden, app)
  // ===================================================================
  const etagPath = path.join('public', 'etag.html');
  if (fs.existsSync(etagPath)) {
    let content = fs.readFileSync(etagPath, 'utf8');
    const original = content;

    if (!content.includes('TMC_PATCH122_SAFE_QRCODE')) {
      const replacements = [
        {
          old: "    document.getElementById('qr-preview').innerHTML = '';\n" +
               "    new QRCode(document.getElementById('qr-preview'), {\n" +
               "      text: tagURL, width: 90, height: 90,\n" +
               "      colorDark: '#111111', colorLight: '#ffffff',\n" +
               "      correctLevel: QRCode.CorrectLevel.M\n" +
               "    });",
          new: "    tmcSafeQRCode('qr-preview', {\n" +
               "      text: tagURL, width: 90, height: 90,\n" +
               "      colorDark: '#111111', colorLight: '#ffffff',\n" +
               "      correctLevel: QRCode.CorrectLevel.M\n" +
               "    });"
        },
        {
          old: "    document.getElementById('qr-hidden').innerHTML = '';\n" +
               "    new QRCode(document.getElementById('qr-hidden'), {\n" +
               "      text: tagURL, width: 400, height: 400,\n" +
               "      colorDark: '#111111', colorLight: '#ffffff',\n" +
               "      correctLevel: QRCode.CorrectLevel.H\n" +
               "    });",
          new: "    tmcSafeQRCode('qr-hidden', {\n" +
               "      text: tagURL, width: 400, height: 400,\n" +
               "      colorDark: '#111111', colorLight: '#ffffff',\n" +
               "      correctLevel: QRCode.CorrectLevel.H\n" +
               "    });"
        },
        {
          old: "    document.getElementById('qr-app').innerHTML = '';\n" +
               "    new QRCode(document.getElementById('qr-app'), {\n" +
               "      text: 'https://tapmycar.io', width: 300, height: 300,\n" +
               "      colorDark: '#111111', colorLight: '#ffffff',\n" +
               "      correctLevel: QRCode.CorrectLevel.H\n" +
               "    });",
          new: "    tmcSafeQRCode('qr-app', {\n" +
               "      text: 'https://tapmycar.io', width: 300, height: 300,\n" +
               "      colorDark: '#111111', colorLight: '#ffffff',\n" +
               "      correctLevel: QRCode.CorrectLevel.H\n" +
               "    });"
        }
      ];

      let allFound = true;
      for (const r of replacements) {
        if (!content.includes(r.old)) { allFound = false; break; }
      }

      if (allFound) {
        for (const r of replacements) {
          content = content.replace(r.old, r.new);
        }
        content = content.replace('async function loadTagData()', HELPER + '\n    async function loadTagData()');
        backup(etagPath);
        fs.writeFileSync(etagPath, content, 'utf8');
        console.log('  etag.html: fixed - all 3 QR codes now retry automatically with a visible fallback');
        anyChanged = true;
      } else {
        console.log('  etag.html: one or more expected QR code patterns not found - check manually');
      }
    } else {
      console.log('  etag.html: already fixed');
    }
  }

  console.log('\n=== TMC_PATCH122 complete ===');
  if (anyChanged) {
    console.log('\nNext steps: this affects the WEBSITE only (public/ files served by Vercel),');
    console.log('not the app bundle specifically, but run the usual: .\\prebuild.ps1 -> rebuild');
    console.log('for the app too, and git push handles the website automatically in ~60s.\n');
  }

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
