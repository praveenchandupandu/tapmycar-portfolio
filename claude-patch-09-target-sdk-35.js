#!/usr/bin/env node
/* ============================================================================
 * claude-patch-09-target-sdk-35.js
 * ----------------------------------------------------------------------------
 * Raises the Android build to target SDK 35 (Android 15) - the minimum Google
 * Play now accepts for new submissions.
 *
 * Coordinated version bump (SDK 35 needs newer Gradle + AGP than Capacitor 6
 * ships). Matches Capacitor 7's proven Android tooling for SDK 35:
 *   android/variables.gradle : compileSdkVersion 34 -> 35, targetSdkVersion 34 -> 35
 *   android/build.gradle      : AGP 8.2.1 -> 8.7.2, google-services 4.4.0 -> 4.4.2
 *   android/gradle/wrapper/gradle-wrapper.properties : Gradle 8.2.1 -> 8.11.1
 *
 * PREREQUISITES on your machine (or the rebuild fails):
 *   - Android Studio updated to the latest version (AGP 8.7.2 needs it)
 *   - SDK Manager: install "Android 15 (API 35)" platform + Build-Tools 35
 *
 * IMPORTANT: this is a build-config change. Its real validation is the Gradle
 * rebuild in Android Studio (File > Sync Project with Gradle Files, then Run).
 * If the sync/build errors, send me the message and I'll align the versions.
 *
 * SAFE / IDEMPOTENT: per-file timestamped backups, UTF-8 no-BOM, no-op if all
 * three are already at target. Verifies every expected current value is present
 * BEFORE writing; if anything is unexpected it aborts and changes NOTHING.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const VARS = path.join('android', 'variables.gradle');
const BUILD = path.join('android', 'build.gradle');
const WRAP = path.join('android', 'gradle', 'wrapper', 'gradle-wrapper.properties');

// file -> list of { label, from, to, done }
const plan = {
  [VARS]: [
    { label: 'compileSdkVersion -> 35', from: /compileSdkVersion\s*=\s*34\b/, to: 'compileSdkVersion = 35', done: /compileSdkVersion\s*=\s*35\b/ },
    { label: 'targetSdkVersion -> 35',  from: /targetSdkVersion\s*=\s*34\b/,  to: 'targetSdkVersion = 35',  done: /targetSdkVersion\s*=\s*35\b/ }
  ],
  [BUILD]: [
    { label: 'AGP -> 8.7.2',             from: /com\.android\.tools\.build:gradle:8\.2\.1/, to: 'com.android.tools.build:gradle:8.7.2', done: /com\.android\.tools\.build:gradle:8\.7\.2/ },
    { label: 'google-services -> 4.4.2', from: /com\.google\.gms:google-services:4\.4\.0/,   to: 'com.google.gms:google-services:4.4.2', done: /com\.google\.gms:google-services:4\.4\.2/ }
  ],
  [WRAP]: [
    { label: 'Gradle -> 8.11.1', from: /gradle-8\.2\.1-all\.zip/, to: 'gradle-8.11.1-all.zip', done: /gradle-8\.11\.1-all\.zip/ }
  ]
};

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-09-target-sdk-35.js');
console.log('--------------------------------');

// ---- pass 1: read + compute, detect anything unexpected ----
const files = Object.keys(plan);
const compute = {};
let anyChange = false;
let abort = null;

for (const f of files) {
  if (!fs.existsSync(f)) { abort = 'missing file: ' + f; break; }
  let text = fs.readFileSync(f, 'utf8');
  const notes = [];
  for (const e of plan[f]) {
    if (e.done.test(text)) { notes.push(e.label + ': already done'); continue; }
    const m = text.match(new RegExp(e.from, 'g'));
    const n = m ? m.length : 0;
    if (n === 0) { abort = f + ' -> "' + e.label + '": expected current value not found (versions differ from what I saw). Nothing changed.'; break; }
    if (n > 1)  { abort = f + ' -> "' + e.label + '": matched ' + n + ' times (expected 1). Nothing changed.'; break; }
    text = text.replace(e.from, e.to);
    notes.push(e.label + ': WILL CHANGE');
    anyChange = true;
  }
  if (abort) break;
  compute[f] = { text, notes };
}

if (abort) { console.log('ABORT - ' + abort); process.exit(1); }

if (!anyChange) {
  console.log('All three already at target (SDK 35 / AGP 8.7.2 / Gradle 8.11.1). Nothing to do.');
  process.exit(0);
}

// ---- pass 2: backup + write ----
let failed = false;
for (const f of files) {
  const orig = fs.readFileSync(f, 'utf8');
  if (orig === compute[f].text) { console.log(f + ': (no change)'); continue; }
  const b = f + '.bak-' + stamp();
  try {
    fs.copyFileSync(f, b);
    fs.writeFileSync(f, Buffer.from(compute[f].text, 'utf8')); // UTF-8, no BOM
    console.log(f + ':');
    compute[f].notes.forEach((nn) => console.log('   - ' + nn));
    console.log('   (backup: ' + path.basename(b) + ')');
  } catch (e) {
    try { fs.copyFileSync(b, f); } catch (_) {}
    console.log(f + ': FAILED -> restored (' + String(e.message || e) + ')');
    failed = true;
  }
}

console.log('--------------------------------');
if (failed) { console.log('Done WITH ERRORS.'); process.exit(1); }
console.log('Version bump written. NEXT: update Android Studio + install SDK 35,');
console.log('then File > Sync Project with Gradle Files, then rebuild. Send me any error.');
process.exit(0);
