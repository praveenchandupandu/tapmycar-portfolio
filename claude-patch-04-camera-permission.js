#!/usr/bin/env node
/* ============================================================================
 * claude-patch-04-camera-permission.js
 * ----------------------------------------------------------------------------
 * Fixes: Verify shows "Camera access denied" in the installed app and never
 * asks for permission.
 *
 * CAUSE: the Android app never declares that it uses the camera, so the system
 * blocks getUserMedia (used by the QR scanner) without ever prompting. Browsers
 * prompt on their own, which is why it worked on the web but not in the app.
 *
 * FIX: add to android/app/src/main/AndroidManifest.xml, as children of
 * <manifest>:
 *     <uses-permission android:name="android.permission.CAMERA" />
 *     <uses-feature android:name="android.hardware.camera" android:required="false" />
 * Capacitor's WebView then requests the camera at runtime, so the first time
 * you open Verify you'll get the Allow prompt.
 *
 * NOTE: this edits the NATIVE Android project, not public/, so `npx cap sync`
 * is NOT needed — just rebuild the app in Android Studio. camera is a runtime
 * permission, so it's requested when the scanner starts (not at install).
 *
 * SAFE / IDEMPOTENT:
 *   - timestamped backup,
 *   - does nothing if CAMERA is already declared (reports it),
 *   - inserts right after the <manifest ...> opening tag; aborts safely if that
 *     tag can't be found.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const MANIFEST = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');

const INSERT = [
  '',
  '    <uses-permission android:name="android.permission.CAMERA" />',
  '    <uses-feature android:name="android.hardware.camera" android:required="false" />'
].join('\n');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-04-camera-permission.js');
console.log('-------------------------------------');

if (!fs.existsSync(MANIFEST)) {
  console.log('ABORT - manifest not found at ' + MANIFEST);
  console.log('   (nothing changed)');
  process.exit(1);
}

const original = fs.readFileSync(MANIFEST, 'utf8');

if (/android\.permission\.CAMERA/.test(original)) {
  console.log(MANIFEST + ': CAMERA already declared (no change).');
  console.log('   If Verify still fails, the issue is elsewhere - tell me and I\'ll look at MainActivity.');
  process.exit(0);
}

// find the opening <manifest ...> tag
const m = original.match(/<manifest\b[^>]*>/);
if (!m) {
  console.log('ABORT - could not find the <manifest> opening tag (nothing changed).');
  process.exit(1);
}

const backup = MANIFEST + '.bak-' + stamp();
fs.copyFileSync(MANIFEST, backup);

try {
  const idx = m.index + m[0].length;
  const updated = original.slice(0, idx) + INSERT + original.slice(idx);

  if (!/android\.permission\.CAMERA/.test(updated)) throw new Error('insert verification failed');

  fs.writeFileSync(MANIFEST, Buffer.from(updated, 'utf8')); // UTF-8, no BOM
  console.log(MANIFEST + ': CAMERA permission added.  (backup: ' + path.basename(backup) + ')');
  console.log('-------------------------------------');
  console.log('Done. Rebuild in Android Studio (Run) - no cap sync needed.');
  console.log('Open Verify and you should get the camera Allow prompt.');
  process.exit(0);
} catch (err) {
  fs.copyFileSync(backup, MANIFEST); // restore
  console.log(MANIFEST + ': FAILED -> restored  (' + String(err.message || err) + ')');
  process.exit(1);
}
