// ============================================================================
// TapMyCar - Patch 14: Activity page polish (colors C3 + call location L3)
//
// Two changes to activity.html:
//
// 14.1  Color palette cleanup (Option C3):
//       - Stat-card numbers, tab fills, and per-category icon backgrounds
//         all become brand orange. No more blue/purple/green per category.
//       - Active stat uses brand orange. Inactive stats are gray.
//       - Status badges in call cards KEEP semantic colors (green=connected,
//         red=failed, gray=neutral). Universal language; meaningful signal.
//       - Map markers turn into orange dots (was per-category color).
//
// 14.2  Call location row (Option L3):
//       - Each call card now shows a small location row with:
//           pin icon + "lat, lng" coordinates + "View on map" link
//       - "View on map" opens https://google.com/maps?q=LAT,LNG in new tab
//       - When a call has no captured location, shows "Location not shared"
//         (no link).
//       - Other categories (messages/voice) keep the simple "Location
//         captured" indicator — Calls is where the owner most needs to
//         actually navigate to the spot.
//
// REQUIRES: Patch 13 already applied locally.
//
// Properties:
//   - Idempotent
//   - Backups activity.html to backup-patch14-{timestamp}/
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch14-activity-polish.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch14-activity-polish.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch14-activity-polish.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch14-${ts}`);

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
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 14 \u2014 Activity page polish (orange palette + call location)');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_14 = 'TMC_PATCH14_ACTIVITY_POLISH';

{
  const file = path.join(PUBLIC, 'activity.html');
  const content = readFile(file);

  if (content.includes(MARKER_14)) {
    skip('activity.html (already polished)');
  } else {
    backup(file);
    let updated = content;

    // ── 14.1.a — Stat-card number colors (4 separate rules → all orange) ──
    const oldStatNums = `    .p13-stat[data-cat="calls"] .p13-stat-num{color:#2563EB}
    .p13-stat[data-cat="messages"] .p13-stat-num{color:#FF6B00}
    .p13-stat[data-cat="photos"] .p13-stat-num{color:#7C3AED}
    .p13-stat[data-cat="voice"] .p13-stat-num{color:#16A34A}`;

    const newStatNums = `    /* ${MARKER_14}: orange-led palette (C3) */
    .p13-stat .p13-stat-num{color:#FF6B00}`;

    let r = tryReplace(updated, oldStatNums, newStatNums);
    if (!r) errExit('activity.html: stat-num color rules not found');
    updated = r;

    // ── 14.1.b — Tab active backgrounds (4 colors → all orange) ──
    const oldTabActive = `    .p13-tab.active[data-cat="calls"]{background:#2563EB;color:#fff}
    .p13-tab.active[data-cat="messages"]{background:#FF6B00;color:#fff}
    .p13-tab.active[data-cat="photos"]{background:#7C3AED;color:#fff}
    .p13-tab.active[data-cat="voice"]{background:#16A34A;color:#fff}`;

    const newTabActive = `    .p13-tab.active{background:#FF6B00;color:#fff}`;

    r = tryReplace(updated, oldTabActive, newTabActive);
    if (!r) errExit('activity.html: tab active rules not found');
    updated = r;

    // ── 14.1.c — Per-category icon backgrounds → all orange ──
    const oldItemIcs = `    .p13-item[data-cat="calls"] .p13-item-ic{background:#2563EB}
    .p13-item[data-cat="messages"] .p13-item-ic{background:#FF6B00}
    .p13-item[data-cat="voice"] .p13-item-ic{background:#16A34A}`;

    const newItemIcs = `    .p13-item .p13-item-ic{background:#FF6B00}`;

    r = tryReplace(updated, oldItemIcs, newItemIcs);
    if (!r) errExit('activity.html: item-ic rules not found');
    updated = r;

    // ── 14.1.d — Map marker color: was per-category, now always orange ──
    // The CAT object has `.color` per category. Set them all to orange.
    const oldCatColors = [
      "    color: '#2563EB',",
      "    color: '#FF6B00',",
      "    color: '#7C3AED',",
      "    color: '#16A34A',"
    ];
    // Replace all four CAT.X.color values with brand orange.
    // Just iterate and replace the first occurrence of each.
    for (const c of oldCatColors) {
      if (updated.includes(c)) {
        updated = updated.replace(c, "    color: '#FF6B00',");
      }
    }

    // ── 14.1.e — Add a new style block extension for the call-location row ──
    // Insert just before the existing /* Photo grid */ comment.
    const styleAnchor = `    /* Photo grid */`;
    const styleAddition = `    /* ${MARKER_14}: call location row */
    .p13-call-loc{display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px dashed #F3F4F6;font-size:11.5px;color:#6B7280}
    .p13-call-loc svg{width:12px;height:12px;stroke-width:2.2;fill:none;stroke:#9CA3AF;flex-shrink:0}
    .p13-call-loc-coords{font-family:Menlo,Consolas,monospace;font-size:11px;color:#374151;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .p13-call-loc-link{display:inline-flex;align-items:center;gap:4px;color:#FF6B00;font-weight:700;font-size:11px;text-decoration:none;flex-shrink:0;padding:4px 10px;border-radius:99px;background:#FFF3EC;transition:background .15s}
    .p13-call-loc-link:hover{background:#FFE4CC}
    .p13-call-loc-link svg{width:11px;height:11px;stroke:#FF6B00}
    .p13-call-loc-empty{color:#9CA3AF;font-style:italic;font-size:11.5px}

    /* Photo grid */`;

    r = tryReplace(updated, styleAnchor, styleAddition);
    if (!r) errExit('activity.html: photo-grid style anchor not found');
    updated = r;

    // ── 14.2 — Replace p13RenderCall to use the new location row ──
    // The old function calls p13Loc(scan) inside the head; we keep that
    // (shows "Location captured" or "No location" badge inline). But we
    // ADD a new richer location row at the bottom: coords + Google Maps link.
    //
    // To keep the diff small, we add a helper function and modify the
    // template so the location row appears below the call-row status line.

    // Add the helper function. Insert right before p13RenderCall.
    const helperAnchor = `function p13RenderCall(scan) {`;
    const helperAddition = `function p13CallLocRow(scan) {
  // ${MARKER_14}: rich location row for call cards (L3 - coords + maps link)
  if (scan.latitude && scan.longitude) {
    const lat = Number(scan.latitude).toFixed(4);
    const lng = Number(scan.longitude).toFixed(4);
    const mapsUrl = 'https://www.google.com/maps?q=' + encodeURIComponent(scan.latitude + ',' + scan.longitude);
    return '<div class="p13-call-loc">' +
      '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
      '<div class="p13-call-loc-coords">' + p13Esc(lat) + ', ' + p13Esc(lng) + '</div>' +
      '<a class="p13-call-loc-link" href="' + p13Esc(mapsUrl) + '" target="_blank" rel="noopener noreferrer">' +
        'View on map' +
        '<svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><polyline points="7 7 17 7 17 17"/></svg>' +
      '</a>' +
    '</div>';
  }
  return '<div class="p13-call-loc"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span class="p13-call-loc-empty">Location not shared</span></div>';
}

function p13RenderCall(scan) {`;

    r = tryReplace(updated, helperAnchor, helperAddition);
    if (!r) errExit('activity.html: p13RenderCall anchor not found');
    updated = r;

    // Now modify the call-card template to insert p13CallLocRow(scan) AFTER
    // the existing p13-call-row div (which has "Stranger called" + status badge).
    // Replace the closing of that block + the outer item closing.
    const oldCallTail = `    '<div class="p13-call-row">' +
      '<div class="p13-call-num">Stranger called</div>' +
      '<span class="p13-call-stat ' + p13Esc(status) + '">' + p13Esc(statusLabel) + '</span>' +
    '</div>' +
  '</div>';
}`;

    const newCallTail = `    '<div class="p13-call-row">' +
      '<div class="p13-call-num">Stranger called</div>' +
      '<span class="p13-call-stat ' + p13Esc(status) + '">' + p13Esc(statusLabel) + '</span>' +
    '</div>' +
    p13CallLocRow(scan) +
  '</div>';
}`;

    r = tryReplace(updated, oldCallTail, newCallTail);
    if (!r) errExit('activity.html: p13RenderCall tail not found');
    updated = r;

    // Add the marker comment so idempotent check works
    if (!updated.includes(MARKER_14)) {
      // Should already be present from inserted comments, but ensure it
      errExit('activity.html: marker comment did not land — abort');
    }

    writeFile(file, updated);
    ok('activity.html: orange palette + call location row applied');
  }
}

log('');
log('==============================================================');
log('Patch 14 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 14: activity colors (orange-led) + call location row"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test:');
log('  Open activity.html in fresh incognito.');
log('  - All stat numbers, tab fills, icon backgrounds are now orange.');
log('  - Map markers are orange.');
log('  - Call status badges keep semantic colors (green=Connected,');
log('    purple=Message sent, red=Failed, etc.) - intentional.');
log('  - Each call card shows coordinates + "View on map" button.');
log('  - Tap "View on map" -> opens Google Maps in a new tab at the spot.');
log('  - Calls without location show "Location not shared".');
log('==============================================================');
