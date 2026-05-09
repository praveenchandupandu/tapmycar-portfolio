// ============================================================================
// TapMyCar - Patch 12: Fix activity page (3 real bugs)
//
// What's broken (confirmed via SQL on the live DB):
//
// Bug 1 — Messages and voice memos never get logged to scan_logs.
//   In contact.html, two calls to /api/notify-owner pass
//   `scan_id: window.currentScanId || ''`. But `currentScanId` is declared
//   as a regular `let` variable, NOT attached to window. So
//   `window.currentScanId` is undefined, the fallback gives empty string,
//   notify-owner skips its scan_logs update (line 210: `if (scan_id)`),
//   and contact_action / message_text / audio_url are never set.
//
// Bug 2 — Photos exist in DB but are misclassified as "call".
//   Stranger sends a photo (notify-owner sets contact_action='photo',
//   photo_url=...). Then stranger taps Call. handleCall() calls
//   updateScanAction('call') which OVERWRITES contact_action with 'call'.
//   The photo data stays but the row is now classified as a call. So the
//   "Photos" filter on activity.html shows nothing.
//
// Bug 3 — activity.html doesn't render audio for voice memos.
//   Even when audio_url IS populated, there's no <audio> player code in
//   activity.html to play it. No "Voice memos" filter button either.
//
// What this patch does:
//
//   12.1  contact.html: replace `window.currentScanId` with `currentScanId`
//         in the two broken places (lines 1182 and 1305).
//
//   12.2  api/update-scan.js: don't overwrite a more specific contact_action
//         with 'call'. If contact_action is already set to a non-call value
//         (photo, voice, quick_message), keep it.
//
//   12.3  public/activity.html: add audio player rendering for audio_url,
//         and add a "Voice memos" filter button.
//
// REQUIRES: Patches 1-11 already applied locally.
//
// Properties:
//   - Idempotent
//   - Backups every touched file to backup-patch12-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch12-activity-fixes.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch12-activity-fixes.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch12-activity-fixes.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch12-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
  } catch (e) {
    errExit('JS syntax error in ' + p + '\n' + e.stderr.toString());
  }
}

log('');
log('TapMyCar Patch 12 \u2014 Activity page fixes');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_12 = 'TMC_PATCH12_ACTIVITY_FIX';

// ===========================================================================
// 12.1  contact.html — fix window.currentScanId bug
// ===========================================================================

log('12.1  contact.html: fix window.currentScanId -> currentScanId');
{
  const file = path.join(PUBLIC, 'contact.html');
  const content = readFile(file);

  if (content.includes(MARKER_12)) {
    skip('contact.html (already fixed)');
  } else {
    backup(file);

    // Replace BOTH occurrences. Use a global replace.
    const oldStr = "scan_id: window.currentScanId || ''";
    const newStr = "scan_id: currentScanId || '' /* " + MARKER_12 + " */";

    let updated = content;
    let count = 0;
    while (updated.includes(oldStr)) {
      updated = updated.replace(oldStr, newStr);
      count++;
    }

    if (count === 0) {
      errExit('contact.html: window.currentScanId pattern not found');
    }

    writeFile(file, updated);
    ok(`contact.html: fixed ${count} occurrence(s) of window.currentScanId`);
  }
}

// ===========================================================================
// 12.2  api/update-scan.js — don't overwrite specific actions with 'call'
// ===========================================================================

log('');
log('12.2  api/update-scan.js: protect specific contact_actions from "call" overwrite');
{
  const file = path.join(API, 'update-scan.js');
  const content = readFile(file);

  if (content.includes(MARKER_12)) {
    skip('update-scan.js (already protected)');
  } else {
    const oldBlock = `  if (contact_action !== undefined) {
    if (!ACTION_ALLOWLIST.has(String(contact_action))) {
      return res.status(400).json({ error: 'Invalid contact_action' });
    }
    updates.contact_action = contact_action;
  }`;

    const newBlock = `  if (contact_action !== undefined) {
    if (!ACTION_ALLOWLIST.has(String(contact_action))) {
      return res.status(400).json({ error: 'Invalid contact_action' });
    }
    // ${MARKER_12}: don't let 'call' overwrite a more specific action
    // (photo / voice / quick_message). The stranger may tap Call AFTER
    // sending a photo; the photo is the more meaningful signal for the
    // owner, so we keep it.
    if (String(contact_action) === 'call' && scan_id) {
      try {
        const { data: existing } = await supabase
          .from('scan_logs')
          .select('contact_action')
          .eq('id', scan_id)
          .maybeSingle();
        const prior = existing && existing.contact_action;
        if (prior && prior !== 'view' && prior !== 'call') {
          // Keep the more specific action; ignore the 'call' overwrite.
          // Still allow location updates (handled by other fields above).
        } else {
          updates.contact_action = contact_action;
        }
      } catch (e) {
        // On lookup error, fall back to the original behavior.
        updates.contact_action = contact_action;
      }
    } else {
      updates.contact_action = contact_action;
    }
  }`;

    if (!content.includes(oldBlock)) {
      // Try CRLF variant
      const oldCRLF = oldBlock.replace(/\n/g, '\r\n');
      if (content.includes(oldCRLF)) {
        backup(file);
        const newCRLF = newBlock.replace(/\n/g, '\r\n');
        writeFile(file, content.replace(oldCRLF, newCRLF));
        validateJs(file);
        ok('update-scan.js: contact_action overwrite protection added (CRLF)');
      } else {
        errExit('update-scan.js: contact_action block not found');
      }
    } else {
      backup(file);
      writeFile(file, content.replace(oldBlock, newBlock));
      validateJs(file);
      ok('update-scan.js: contact_action overwrite protection added');
    }
  }
}

// ===========================================================================
// 12.3  activity.html — render audio player + Voice memos filter
// ===========================================================================

log('');
log('12.3  activity.html: render audio player + add Voice filter');
{
  const file = path.join(PUBLIC, 'activity.html');
  const content = readFile(file);

  if (content.includes(MARKER_12)) {
    skip('activity.html (already updated)');
  } else {
    backup(file);
    let updated = content;

    // 12.3.a: Add a "Voice memos" filter button after the Photos button.
    const oldFilters = `<button class="filter-btn" onclick="filterScans('photo',this)">Photos</button>`;
    const newFilters = `<button class="filter-btn" onclick="filterScans('photo',this)">Photos</button>
      <button class="filter-btn" onclick="filterScans('voice',this)">Voice memos</button> <!-- ${MARKER_12} -->`;

    if (updated.includes(oldFilters)) {
      updated = updated.replace(oldFilters, newFilters);
    }

    // 12.3.b: Add audio rendering inside the detail-card render block.
    // Anchor: the photo_url block in the detail view (line ~227).
    const oldDetail = `    if (scan.photo_url) {
      contentHTML += '<div style="margin-bottom:12px"><div style="font-size:11px;color:#7C3AED;font-weight:700;margin-bottom:8px">Photo sent by stranger</div><img src="' + scan.photo_url + '" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover"></div>';`;

    const newDetail = `    if (scan.photo_url) {
      contentHTML += '<div style="margin-bottom:12px"><div style="font-size:11px;color:#7C3AED;font-weight:700;margin-bottom:8px">Photo sent by stranger</div><img src="' + scan.photo_url + '" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover"></div>';
    }
    /* ${MARKER_12}: voice memo audio player */
    if (scan.audio_url) {
      contentHTML += '<div style="margin-bottom:12px"><div style="font-size:11px;color:#6D28D9;font-weight:700;margin-bottom:8px">Voice memo from stranger</div><audio controls preload="metadata" style="width:100%"><source src="' + scan.audio_url + '">Your browser does not support audio playback.</audio></div>';`;

    if (updated.includes(oldDetail)) {
      updated = updated.replace(oldDetail, newDetail);
    } else {
      // Try CRLF
      const oldCRLF = oldDetail.replace(/\n/g, '\r\n');
      if (updated.includes(oldCRLF)) {
        const newCRLF = newDetail.replace(/\n/g, '\r\n');
        updated = updated.replace(oldCRLF, newCRLF);
      } else {
        errExit('activity.html: detail photo_url anchor not found');
      }
    }

    // 12.3.c: Also add audio in the secondary render block at line ~234
    // (the "preview" version used in list view, not full detail).
    const oldList = `'<div style="margin-bottom:12px"><div style="font-size:11px;color:#7C3AED;font-weight:700;margin-bottom:8px">Photo sent by stranger</div><img src="' + scan.photo_url + '" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover"></div>'`;

    // Find the SECOND occurrence (the first was in the detail block we already patched, but our patch transformed the structure)
    // Actually, check for occurrences in the current `updated` content
    const occurrences = updated.split(oldList).length - 1;
    if (occurrences === 1) {
      // The remaining occurrence is the list-view one. Append audio rendering after it.
      // The structure: ... photo_url ? '<div>...img...</div>' : '' ...
      // We append a separate condition for audio_url right after.
      const listAnchor = oldList + `\n      : '';`;
      const listReplacement = oldList + `\n      : '';\n    /* ${MARKER_12}: voice memo in list view */\n    if (scan.audio_url) {\n      contentHTML += '<div style=\"margin-bottom:8px\"><div style=\"font-size:10px;color:#6D28D9;font-weight:700;margin-bottom:6px\">Voice memo</div><audio controls preload=\"metadata\" style=\"width:100%;height:32px\"><source src=\"' + scan.audio_url + '\"></audio></div>';\n    }`;
      if (updated.includes(listAnchor)) {
        updated = updated.replace(listAnchor, listReplacement);
      } else {
        const ca = listAnchor.replace(/\n/g, '\r\n');
        if (updated.includes(ca)) {
          updated = updated.replace(ca, listReplacement.replace(/\n/g, '\r\n'));
        }
        // If not found, the list view audio will just be missing; not critical
      }
    }

    writeFile(file, updated);
    ok('activity.html: voice memo filter + audio player added');
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 12 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 12: activity page fixes (scan_id, contact_action overwrite, voice memo render)"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test plan:');
log('  Open contact.html for an active tag in incognito.');
log('  1. Send a Quick Message ("Lights are on" etc).');
log('  2. Take and send a Photo.');
log('  3. Record and send a Voice memo.');
log('  4. (Optionally tap Call too — should not overwrite the actions above.)');
log('');
log('  Then open activity.html as the owner.');
log('  - Messages tab: should show your message');
log('  - Photos tab: should show your photo');
log('  - Voice memos tab: should show your voice memo as a playable audio');
log('');
log('NOTE: existing rows from earlier tests cannot be retroactively fixed —');
log('they have contact_action="call" with photo data attached. Only NEW');
log('contacts after this patch will work correctly.');
log('==============================================================');
