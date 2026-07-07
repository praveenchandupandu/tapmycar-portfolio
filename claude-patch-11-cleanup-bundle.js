#!/usr/bin/env node
/* ============================================================================
 * claude-patch-11-cleanup-bundle.js
 * ----------------------------------------------------------------------------
 * Removes junk that should NOT ship in the released app (or sit on the live
 * website): the timestamped backup files my patches created, and the unfinished
 * app-shell.html prototype.
 *
 * Deletes ONLY:
 *   - files whose name ends in ".bak" or contains ".bak-"  (patch backups)
 *   - app-shell.html
 * ...under public/ (recursive) and the repo root (top level only).
 * Your live pages (dashboard.html, etc.) are untouched. Git history still keeps
 * every deleted file, so nothing is truly lost.
 *
 * Does NOT touch android/, node_modules/, or any real page.
 *
 * SAFE / IDEMPOTENT: prints every file before deleting; re-running finds none.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const isBackup = (name) => /\.bak$/.test(name) || /\.bak-/.test(name);
const isShell  = (name) => name === 'app-shell.html';
const targetName = (name) => isBackup(name) || isShell(name);

function walk(dir, recurse, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!recurse) continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(full, true, out);
    } else if (e.isFile() && targetName(e.name)) {
      out.push(full);
    }
  }
}

console.log('claude-patch-11-cleanup-bundle.js');
console.log('---------------------------------');

const found = [];
// public/ recursively
if (fs.existsSync('public')) walk('public', true, found);
// repo root, top level only (the vestigial HTML mirrors + their backups)
walk('.', false, found);

if (found.length === 0) {
  console.log('Nothing to clean — no backup files or app-shell.html found.');
  process.exit(0);
}

let bytes = 0, deleted = 0, failed = 0;
for (const f of found) {
  try {
    const sz = fs.statSync(f).size;
    fs.unlinkSync(f);
    bytes += sz; deleted++;
    console.log('  removed: ' + f);
  } catch (e) {
    failed++;
    console.log('  FAILED : ' + f + '  (' + String(e.message || e) + ')');
  }
}

console.log('---------------------------------');
console.log('Removed ' + deleted + ' file(s), ' + (bytes / 1024).toFixed(1) + ' KB.' + (failed ? '  ' + failed + ' failed.' : ''));
console.log('NEXT: git add -A && commit && push  ->  npx cap sync android  ->  rebuild the signed AAB.');
process.exit(failed ? 1 : 0);
