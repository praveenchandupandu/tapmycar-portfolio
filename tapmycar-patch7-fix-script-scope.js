// ============================================================================
// TapMyCar — Patch 7-fix: Patch 7's new JS got injected into the wrong
// <script> block (it landed inside a <script src="..."> tag, where
// browsers ignore inline content). Result: flowAfterVehicle and pvSend*
// functions are undefined when proceedToPayment() calls them.
//
// Symptom (caught in browser console):
//   Uncaught ReferenceError: flowAfterVehicle is not defined
//     at proceedToPayment (activate.html:512:3)
//
// Fix: move the entire MARKER_7 block out of the broken position and
// into a fresh <script> block right before </body>. Idempotent — safe
// to run multiple times.
//
// REQUIRES: Patch 7 already applied (so the broken inline JS is in the file).
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch7-fix-script-scope.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch7-fix-script-scope.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch7-fix-script-scope.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch7fix-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}

log('');
log('TapMyCar Patch 7-fix \u2014 Move new JS into a proper <script> block');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_FIX = 'TMC_PATCH7FIX_SCRIPT_SCOPE';
const MARKER_7 = 'TMC_PATCH7_ACTIVATE_SMS';

{
  const file = path.join(PUBLIC, 'activate.html');
  const content = readFile(file);

  if (content.includes(MARKER_FIX)) {
    skip('activate.html (already fixed)');
  } else {
    backup(file);
    let updated = content;

    // Step 1: Find the broken inline JS that got injected inside a
    // <script src="..."> tag. The block starts with the marker comment
    // and ends with the IIFE for URL token reading.
    //
    // Easier: find the first occurrence of `\n// ===== TMC_PATCH7_ACTIVATE_SMS`
    // and the matching closing `})();` of the URL token reader (the very
    // last function in our injected block).
    const blockStartMarker = '\n// ===== ' + MARKER_7 + ' =====';
    const blockStartIdx = updated.indexOf(blockStartMarker);
    if (blockStartIdx === -1) {
      errExit('Could not find Patch 7 inline JS start marker. Was Patch 7 actually applied?');
    }

    // The injected block ends with `})();\n` after the IIFE.
    // The IIFE ends with `})();` followed by a newline.
    // We search forward from blockStartIdx to find the LAST `})();\n` before
    // the next `</script>` tag.
    const nextScriptClose = updated.indexOf('</script>', blockStartIdx);
    if (nextScriptClose === -1) {
      errExit('Could not find closing </script> after Patch 7 inline JS');
    }

    // Find the last `})();` before nextScriptClose
    const region = updated.slice(blockStartIdx, nextScriptClose);
    const lastIife = region.lastIndexOf('})();');
    if (lastIife === -1) {
      errExit('Could not find IIFE close `})();` of URL token reader');
    }
    // End-of-block index = blockStartIdx + lastIife + length of `})();`
    const blockEndIdx = blockStartIdx + lastIife + '})();'.length;

    // Extract the JS block (without surrounding whitespace/newlines)
    const extractedJs = updated.slice(blockStartIdx, blockEndIdx);

    // Sanity: the extracted JS should contain our key function names
    if (!extractedJs.includes('function flowAfterVehicle') ||
        !extractedJs.includes('function activateEtag') ||
        !extractedJs.includes('function pvSendCode')) {
      errExit('Extracted JS block is missing expected functions. Aborting to avoid corruption.');
    }

    // Step 2: Remove the broken inline JS from where it is
    updated = updated.slice(0, blockStartIdx) + updated.slice(blockEndIdx);

    // Step 3: Insert a fresh <script> block with the JS right before </body>
    const newScriptBlock = `\n<script>\n// ${MARKER_FIX}\n// Patch 7's new JS was originally inserted into the wrong <script> tag\n// (a <script src="..."> tag, where browsers ignore inline content).\n// This is the same JS, now in a properly-isolated inline script block.\n${extractedJs}\n</script>\n`;

    const bodyClose = '</body>';
    const bodyCloseIdx = updated.lastIndexOf(bodyClose);
    if (bodyCloseIdx === -1) errExit('No </body> tag found in activate.html');

    updated = updated.slice(0, bodyCloseIdx) + newScriptBlock + updated.slice(bodyCloseIdx);

    writeFile(file, updated);
    ok('activate.html: Patch 7 JS moved from broken <script src> location to fresh <script> block before </body>');
  }
}

log('');
log('==============================================================');
log('Patch 7-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 7-fix: move activate.html JS to proper script block"');
log('  git push');
log('');
log('Wait ~60 seconds for Vercel deploy, then retry the eTag activation test:');
log('  - Click Continue on Vehicle Details');
log('  - Should now navigate to phone-verify step (no more console error)');
log('==============================================================');
