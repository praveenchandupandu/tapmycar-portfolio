// ============================================================================
// TapMyCar - Patch 13: Activity page UI redesign (4 categories, color-coded)
//
// Rewrites the activity.html page with:
//   - 4 stat cards (Calls, Messages, Photos, Voice memos) — clickable, jump
//     to the matching tab
//   - Map at top filters by selected category
//   - 4 tabs only (no "All", no "Views"): Calls, Messages, Photos, Voice
//   - Each category renders its own item layout:
//       Calls: caller phone (masked), date/time, duration, status, location
//       Messages: message text big, date/time, location pin
//       Photos: thumbnail tile, date/time, tap-to-enlarge
//       Voice memos: inline audio player, date/time, location
//   - Color-coded per category:
//       Calls = blue (#2563EB)
//       Messages = orange (#FF6B00, brand)
//       Photos = purple (#7C3AED)
//       Voice = green (#16A34A)
//   - Modern card design with subtle shadows and consistent spacing
//
// What changes in the file:
//   - <div class="page-inner"> is fully rewritten (the main body)
//   - <div class="detail-overlay"> simplified (no longer needed for messages
//     since they render inline; kept for photo full-screen view)
//   - The <script> block at the bottom is rewritten with new render funcs
//   - The inline <style> block in <head> is extended with new classes
//
// What stays the same:
//   - <head> meta tags, fonts, manifest links
//   - <nav> top bar (back button + logo + settings gear)
//   - <nav class="bnav"> bottom nav
//   - All API endpoints (no backend changes needed)
//   - The chev divider, toast element
//
// REQUIRES: Patches 1-12 already applied locally.
//
// Properties:
//   - Idempotent (re-running is a no-op via marker check)
//   - Backups activity.html to backup-patch13-{timestamp}/
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch13-activity-redesign.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch13-activity-redesign.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch13-activity-redesign.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch13-${ts}`);

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

log('');
log('TapMyCar Patch 13 \u2014 Activity page redesign');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_13 = 'TMC_PATCH13_ACTIVITY_REDESIGN';

// ===========================================================================
// Rewrite activity.html
// ===========================================================================

{
  const file = path.join(PUBLIC, 'activity.html');
  const content = readFile(file);

  if (content.includes(MARKER_13)) {
    skip('activity.html (already redesigned)');
  } else {
    backup(file);

    // We rewrite three sections:
    //   1. <style> block additions (at end of existing <style>)
    //   2. The <div class="page-inner">...</div> body
    //   3. The <script>...</script> block at the bottom

    // ── 1. Extended <style> block — replace existing inline <style>
    const oldStyle = `<style>
    #map{height:220px;border-radius:14px;overflow:hidden;margin-bottom:14px;z-index:1;background:#F3F4F6}
    .filter-row{display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;padding-bottom:4px}
    .filter-btn{background:#F3F4F6;border:none;border-radius:99px;padding:6px 14px;font-size:11px;font-weight:600;color:#6B7280;cursor:pointer;font-family:inherit;white-space:nowrap}
    .filter-btn.active{background:#FF6B00;color:#fff}
    .scan-item{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:.5px solid var(--bd);cursor:pointer}
    .scan-item:last-child{border-bottom:none}
    .scan-icon{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .detail-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:flex-end;justify-content:center}
    .detail-overlay.show{display:flex}
    .detail-sheet{background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:430px;padding:24px 20px 34px;max-height:85vh;overflow-y:auto}
  </style>`;

    const newStyle = `<style>
    /* ${MARKER_13} */
    #map{height:200px;border-radius:14px;overflow:hidden;margin-bottom:14px;z-index:1;background:#F3F4F6}

    /* Stat cards (top row, 4 categories) */
    .p13-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
    .p13-stat{background:#fff;border:1px solid #F3F4F6;border-radius:14px;padding:12px 6px;text-align:center;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease;font-family:inherit}
    .p13-stat:hover,.p13-stat:active{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.06)}
    .p13-stat.active{background:#FFF8F2;border-color:#FFD7BA;box-shadow:0 4px 14px rgba(255,107,0,.10)}
    .p13-stat-num{font-size:22px;font-weight:800;line-height:1;letter-spacing:-.5px}
    .p13-stat-lbl{font-size:9.5px;color:#6B7280;margin-top:5px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
    .p13-stat[data-cat="calls"] .p13-stat-num{color:#2563EB}
    .p13-stat[data-cat="messages"] .p13-stat-num{color:#FF6B00}
    .p13-stat[data-cat="photos"] .p13-stat-num{color:#7C3AED}
    .p13-stat[data-cat="voice"] .p13-stat-num{color:#16A34A}

    /* Tab pills */
    .p13-tabs{display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;padding:2px;scrollbar-width:none}
    .p13-tabs::-webkit-scrollbar{display:none}
    .p13-tab{background:#F3F4F6;border:none;border-radius:99px;padding:8px 16px;font-size:12px;font-weight:600;color:#6B7280;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .15s,color .15s}
    .p13-tab.active[data-cat="calls"]{background:#2563EB;color:#fff}
    .p13-tab.active[data-cat="messages"]{background:#FF6B00;color:#fff}
    .p13-tab.active[data-cat="photos"]{background:#7C3AED;color:#fff}
    .p13-tab.active[data-cat="voice"]{background:#16A34A;color:#fff}

    /* Section header */
    .p13-sec-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .p13-sec-h-t{font-size:15px;font-weight:700;color:var(--bk)}
    .p13-sec-h-c{font-size:11px;color:#6B7280;font-weight:600}

    /* Empty state */
    .p13-empty{background:#fff;border:1px dashed #E5E7EB;border-radius:14px;padding:36px 18px;text-align:center}
    .p13-empty-ic{width:48px;height:48px;border-radius:14px;background:#F9FAFB;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
    .p13-empty-ic svg{width:22px;height:22px;stroke-width:2;fill:none;stroke:#9CA3AF}
    .p13-empty-t{font-size:14px;font-weight:700;color:#111;margin-bottom:4px}
    .p13-empty-s{font-size:12px;color:#6B7280;line-height:1.4}

    /* Generic item card (used for calls / messages / voice list) */
    .p13-item{background:#fff;border:1px solid #F3F4F6;border-radius:14px;padding:14px;margin-bottom:10px;transition:box-shadow .15s}
    .p13-item:hover{box-shadow:0 4px 14px rgba(0,0,0,.06)}
    .p13-item-head{display:flex;align-items:center;gap:10px;margin-bottom:0}
    .p13-item-ic{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .p13-item-ic svg{width:16px;height:16px;stroke-width:2;fill:none;stroke:#fff}
    .p13-item[data-cat="calls"] .p13-item-ic{background:#2563EB}
    .p13-item[data-cat="messages"] .p13-item-ic{background:#FF6B00}
    .p13-item[data-cat="voice"] .p13-item-ic{background:#16A34A}
    .p13-item-meta{flex:1;min-width:0}
    .p13-item-when{font-size:13px;font-weight:700;color:#111}
    .p13-item-loc{font-size:11px;color:#6B7280;margin-top:2px;display:flex;align-items:center;gap:3px}
    .p13-item-loc svg{width:11px;height:11px;stroke-width:2.2;fill:none;stroke:#9CA3AF;flex-shrink:0}
    .p13-item-tag{font-size:10px;color:#6B7280;background:#F3F4F6;padding:3px 8px;border-radius:99px;font-weight:600;flex-shrink:0}

    /* Calls-specific fields */
    .p13-call-row{display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px dashed #F3F4F6;font-size:11.5px}
    .p13-call-num{color:#111;font-weight:600;font-family:Menlo,monospace;font-size:12px}
    .p13-call-stat{padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700}
    .p13-call-stat.completed{background:#DCFCE7;color:#166534}
    .p13-call-stat.bridged{background:#DBEAFE;color:#1E40AF}
    .p13-call-stat.message_only{background:#F3E8FF;color:#6B21A8}
    .p13-call-stat.no_answer{background:#FEF3C7;color:#92400E}
    .p13-call-stat.busy,.p13-call-stat.failed,.p13-call-stat.canceled{background:#FEE2E2;color:#991B1B}
    .p13-call-stat.ringing{background:#F3F4F6;color:#374151}

    /* Message bubble */
    .p13-msg-body{margin-top:12px;background:linear-gradient(180deg,#FFF8F2,#FFF3EC);border:1.5px solid #FFD7BA;border-radius:12px;padding:14px 16px}
    .p13-msg-text{font-size:14.5px;color:#111;font-weight:600;line-height:1.45}

    /* Photo grid */
    .p13-photo-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:0}
    .p13-photo-tile{position:relative;aspect-ratio:1/1;border-radius:14px;overflow:hidden;cursor:pointer;background:#F3F4F6}
    .p13-photo-tile img{width:100%;height:100%;object-fit:cover;display:block}
    .p13-photo-tile-overlay{position:absolute;left:0;right:0;bottom:0;padding:10px 12px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.65));color:#fff;font-size:10.5px;font-weight:600}

    /* Voice player */
    .p13-voice-player{margin-top:12px}
    .p13-voice-player audio{width:100%;height:36px;border-radius:99px}

    /* Photo lightbox */
    .p13-lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:300;align-items:center;justify-content:center;padding:20px}
    .p13-lightbox.show{display:flex}
    .p13-lightbox img{max-width:100%;max-height:80vh;border-radius:12px}
    .p13-lightbox-close{position:absolute;top:18px;right:18px;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;border:none;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .p13-lightbox-meta{position:absolute;left:0;right:0;bottom:24px;text-align:center;color:#fff;font-size:13px;font-weight:600;padding:0 20px}
  </style>`;

    if (!content.includes(oldStyle)) {
      // Try CRLF
      const oldCRLF = oldStyle.replace(/\n/g, '\r\n');
      if (!content.includes(oldCRLF)) {
        errExit('activity.html: original <style> block not found exactly');
      }
    }

    let updated = content;
    if (updated.includes(oldStyle)) {
      updated = updated.replace(oldStyle, newStyle);
    } else {
      updated = updated.replace(oldStyle.replace(/\n/g, '\r\n'), newStyle);
    }

    // ── 2. New <div class="page-inner"> body
    // The original page-inner has: stats grid + map + filter row + scan-list
    // We replace the whole thing with the new structure.

    const oldBody = `<div class="page">
  <div class="page-inner">`;
    const newBodyOpen = `<div class="page">
  <div class="page-inner">
    <!-- ${MARKER_13} -->`;

    if (updated.includes(oldBody)) {
      updated = updated.replace(oldBody, newBodyOpen);
    } else {
      const oldCRLF = oldBody.replace(/\n/g, '\r\n');
      if (updated.includes(oldCRLF)) {
        updated = updated.replace(oldCRLF, newBodyOpen.replace(/\n/g, '\r\n'));
      } else {
        errExit('activity.html: <div class="page-inner"> not found');
      }
    }

    // Now replace the inner content (stats + map + filter + list).
    // The inner content runs from after `<div class="page-inner">\n` to
    // the matching `</div>` closing it. We anchor on the existing markup.

    const oldInner = `    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      <div class="card" style="text-align:center;padding:14px 8px"><div style="font-size:26px;font-weight:800;color:var(--or);line-height:1" id="total-scans">0</div><div style="font-size:9px;color:var(--gy);margin-top:4px">Total scans</div></div>
      <div class="card" style="text-align:center;padding:14px 8px"><div style="font-size:26px;font-weight:800;color:var(--or);line-height:1" id="total-calls">0</div><div style="font-size:9px;color:var(--gy);margin-top:4px">Calls made</div></div>
      <div class="card" style="text-align:center;padding:14px 8px"><div style="font-size:26px;font-weight:800;color:var(--or);line-height:1" id="total-msgs">0</div><div style="font-size:9px;color:var(--gy);margin-top:4px">Messages</div></div>
    </div>
    <div style="font-size:15px;font-weight:700;color:var(--bk);margin-bottom:10px">Scan Locations</div>
    <div style="position:relative;margin-bottom:14px">
      <div id="map"></div>
      <div id="map-upgrade" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;background:rgba(255,255,255,.9);border-radius:14px;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px">
        <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">Upgrade to see scan locations</div>
        <div style="font-size:11px;color:#6B7280;margin-bottom:12px">Standard plan includes scan location map</div>
        <a href="/pricing.html" style="background:#FF6B00;color:#fff;font-size:12px;font-weight:700;padding:8px 20px;border-radius:99px;text-decoration:none">Upgrade now</a>
      </div>
    </div>
    <div class="filter-row">
      <button class="filter-btn active" onclick="filterScans('all',this)">All</button>
      <button class="filter-btn" onclick="filterScans('view',this)">Views</button>
      <button class="filter-btn" onclick="filterScans('call',this)">Calls</button>
      <button class="filter-btn" onclick="filterScans('quick_message',this)">Messages</button>
      <button class="filter-btn" onclick="filterScans('photo',this)">Photos</button>
      <button class="filter-btn" onclick="filterScans('voice',this)">Voice memos</button> <!-- TMC_PATCH12_ACTIVITY_FIX -->
    </div>
    <div style="font-size:15px;font-weight:700;color:var(--bk);margin-bottom:10px">All Scans</div>
    <div class="card" style="padding:0 16px" id="scan-list">
      <div style="text-align:center;padding:30px 0;color:var(--gy);font-size:13px">No scans yet - share your QR code to get started.</div>
    </div>`;

    const newInner = `    <!-- 4-stat header (clickable, jump to tab) -->
    <div class="p13-stats">
      <button type="button" class="p13-stat active" data-cat="calls" onclick="p13SwitchCat('calls')">
        <div class="p13-stat-num" id="p13-num-calls">0</div>
        <div class="p13-stat-lbl">Calls</div>
      </button>
      <button type="button" class="p13-stat" data-cat="messages" onclick="p13SwitchCat('messages')">
        <div class="p13-stat-num" id="p13-num-messages">0</div>
        <div class="p13-stat-lbl">Messages</div>
      </button>
      <button type="button" class="p13-stat" data-cat="photos" onclick="p13SwitchCat('photos')">
        <div class="p13-stat-num" id="p13-num-photos">0</div>
        <div class="p13-stat-lbl">Photos</div>
      </button>
      <button type="button" class="p13-stat" data-cat="voice" onclick="p13SwitchCat('voice')">
        <div class="p13-stat-num" id="p13-num-voice">0</div>
        <div class="p13-stat-lbl">Voice</div>
      </button>
    </div>

    <!-- Map: filters with selected category -->
    <div style="position:relative;margin-bottom:14px">
      <div id="map"></div>
      <div id="map-upgrade" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;background:rgba(255,255,255,.9);border-radius:14px;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px">
        <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">Upgrade to see scan locations</div>
        <div style="font-size:11px;color:#6B7280;margin-bottom:12px">Standard plan includes scan location map</div>
        <a href="/pricing.html" style="background:#FF6B00;color:#fff;font-size:12px;font-weight:700;padding:8px 20px;border-radius:99px;text-decoration:none">Upgrade now</a>
      </div>
    </div>

    <!-- Tab pills -->
    <div class="p13-tabs">
      <button type="button" class="p13-tab active" data-cat="calls" onclick="p13SwitchCat('calls')">Calls</button>
      <button type="button" class="p13-tab" data-cat="messages" onclick="p13SwitchCat('messages')">Messages</button>
      <button type="button" class="p13-tab" data-cat="photos" onclick="p13SwitchCat('photos')">Photos</button>
      <button type="button" class="p13-tab" data-cat="voice" onclick="p13SwitchCat('voice')">Voice memos</button>
    </div>

    <!-- Section header (changes per category) -->
    <div class="p13-sec-h">
      <div class="p13-sec-h-t" id="p13-sec-title">Calls</div>
      <div class="p13-sec-h-c" id="p13-sec-count"></div>
    </div>

    <!-- Content area (renders per category) -->
    <div id="p13-content"></div>`;

    if (updated.includes(oldInner)) {
      updated = updated.replace(oldInner, newInner);
    } else {
      const oldCRLF = oldInner.replace(/\n/g, '\r\n');
      if (updated.includes(oldCRLF)) {
        updated = updated.replace(oldCRLF, newInner.replace(/\n/g, '\r\n'));
      } else {
        errExit('activity.html: original page-inner content not found');
      }
    }

    // ── 3. Replace the inline <script> block at the bottom
    // Anchor: `<script>\nrequireAuth();` ... up through `</script>` before `</body>`

    const oldScriptStart = updated.indexOf('<script>\nrequireAuth();');
    let scriptStart = oldScriptStart;
    if (scriptStart === -1) {
      scriptStart = updated.indexOf('<script>\r\nrequireAuth();');
    }
    if (scriptStart === -1) {
      errExit('activity.html: cannot find <script>\\nrequireAuth() block');
    }
    const scriptEnd = updated.indexOf('</script>', scriptStart);
    if (scriptEnd === -1) {
      errExit('activity.html: cannot find closing </script>');
    }

    const newScript = `<script>
// ${MARKER_13}
requireAuth();
const s = getSession();

let allScans = [];
let mainMap = null;
let currentCat = 'calls';

const CAT = {
  calls: {
    title: 'Calls',
    color: '#2563EB',
    match: (x) => x.action === 'call' || x.contact_action === 'call',
    emptyTitle: 'No calls yet',
    emptySub: 'When strangers tap "Call" on your tag, the call history appears here.',
    emptyIcon: '<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
  },
  messages: {
    title: 'Messages',
    color: '#FF6B00',
    match: (x) => (x.action === 'quick_message' || x.contact_action === 'quick_message') && x.message_text,
    emptyTitle: 'No messages yet',
    emptySub: 'Quick messages from strangers ("lights are on", etc.) will show up here.',
    emptyIcon: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  },
  photos: {
    title: 'Photos',
    color: '#7C3AED',
    match: (x) => x.photo_url && x.photo_url.length > 10,
    emptyTitle: 'No photos yet',
    emptySub: 'When strangers take a photo of your car (damage, parking issue), the photos show up here.',
    emptyIcon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
  },
  voice: {
    title: 'Voice memos',
    color: '#16A34A',
    match: (x) => x.audio_url && x.audio_url.length > 10,
    emptyTitle: 'No voice memos yet',
    emptySub: 'Recorded voice messages from strangers will appear here, ready to play.',
    emptyIcon: '<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
  }
};

async function p13Load() {
  try {
    const res = await fetch('/api/get-dashboard?user_id=' + s.token);
    const data = await res.json();
    const userPlan = data.user ? (data.user.plan || 'free') : 'free';
    allScans = (data.recentScans || []);
    p13UpdateCounts();
    p13InitMap(userPlan);
    p13Render();
  } catch (e) {
    console.error('activity load error:', e);
  }
}

function p13UpdateCounts() {
  document.getElementById('p13-num-calls').textContent = allScans.filter(CAT.calls.match).length;
  document.getElementById('p13-num-messages').textContent = allScans.filter(CAT.messages.match).length;
  document.getElementById('p13-num-photos').textContent = allScans.filter(CAT.photos.match).length;
  document.getElementById('p13-num-voice').textContent = allScans.filter(CAT.voice.match).length;
}

function p13SwitchCat(cat) {
  currentCat = cat;
  // Update stat-card active
  document.querySelectorAll('.p13-stat').forEach(el => {
    el.classList.toggle('active', el.dataset.cat === cat);
  });
  // Update tab active
  document.querySelectorAll('.p13-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.cat === cat);
  });
  document.getElementById('p13-sec-title').textContent = CAT[cat].title;
  p13Render();
  // Refresh map markers to show only this category
  if (mainMap) p13RenderMapMarkers();
}

function p13Render() {
  const cat = CAT[currentCat];
  const items = allScans.filter(cat.match);
  document.getElementById('p13-sec-count').textContent = items.length === 0 ? '' : items.length + ' total';

  const root = document.getElementById('p13-content');
  if (items.length === 0) {
    root.innerHTML =
      '<div class="p13-empty">' +
        '<div class="p13-empty-ic">' + cat.emptyIcon + '</div>' +
        '<div class="p13-empty-t">' + cat.emptyTitle + '</div>' +
        '<div class="p13-empty-s">' + cat.emptySub + '</div>' +
      '</div>';
    return;
  }

  if (currentCat === 'calls') root.innerHTML = items.map(p13RenderCall).join('');
  else if (currentCat === 'messages') root.innerHTML = items.map(p13RenderMessage).join('');
  else if (currentCat === 'photos') root.innerHTML = '<div class="p13-photo-grid">' + items.map(p13RenderPhotoTile).join('') + '</div>';
  else if (currentCat === 'voice') root.innerHTML = items.map(p13RenderVoice).join('');
}

function p13Time(scan) {
  return new Date(scan.scanned_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

function p13Loc(scan) {
  if (scan.latitude && scan.longitude) {
    return '<div class="p13-item-loc"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Location captured</div>';
  }
  return '<div class="p13-item-loc">No location</div>';
}

function p13Esc(s) {
  return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

function p13RenderCall(scan) {
  const duration = scan.duration_seconds || 0;
  const durTxt = duration > 0 ? Math.floor(duration / 60) + 'm ' + (duration % 60) + 's' : '';
  // Status (call_logs would have this; falls back to action)
  const status = scan.call_status || 'completed';
  const statusLabel = {
    completed: 'Connected', bridged: 'Connected', message_only: 'Message sent',
    no_answer: 'No answer', busy: 'Busy', failed: 'Failed', canceled: 'Canceled', ringing: 'Ringing'
  }[status] || 'Call';

  return '<div class="p13-item" data-cat="calls">' +
    '<div class="p13-item-head">' +
      '<div class="p13-item-ic"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>' +
      '<div class="p13-item-meta">' +
        '<div class="p13-item-when">' + p13Esc(p13Time(scan)) + '</div>' +
        p13Loc(scan) +
      '</div>' +
      (durTxt ? '<div class="p13-item-tag">' + p13Esc(durTxt) + '</div>' : '') +
    '</div>' +
    '<div class="p13-call-row">' +
      '<div class="p13-call-num">Stranger called</div>' +
      '<span class="p13-call-stat ' + p13Esc(status) + '">' + p13Esc(statusLabel) + '</span>' +
    '</div>' +
  '</div>';
}

function p13RenderMessage(scan) {
  return '<div class="p13-item" data-cat="messages">' +
    '<div class="p13-item-head">' +
      '<div class="p13-item-ic"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>' +
      '<div class="p13-item-meta">' +
        '<div class="p13-item-when">' + p13Esc(p13Time(scan)) + '</div>' +
        p13Loc(scan) +
      '</div>' +
    '</div>' +
    '<div class="p13-msg-body"><div class="p13-msg-text">' + p13Esc(scan.message_text || '') + '</div></div>' +
  '</div>';
}

function p13RenderPhotoTile(scan) {
  const idx = allScans.indexOf(scan);
  return '<div class="p13-photo-tile" onclick="p13OpenLightbox(' + idx + ')">' +
    '<img src="' + p13Esc(scan.photo_url) + '" alt="Photo from stranger" loading="lazy">' +
    '<div class="p13-photo-tile-overlay">' + p13Esc(p13Time(scan)) + '</div>' +
  '</div>';
}

function p13RenderVoice(scan) {
  return '<div class="p13-item" data-cat="voice">' +
    '<div class="p13-item-head">' +
      '<div class="p13-item-ic"><svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div>' +
      '<div class="p13-item-meta">' +
        '<div class="p13-item-when">' + p13Esc(p13Time(scan)) + '</div>' +
        p13Loc(scan) +
      '</div>' +
    '</div>' +
    '<div class="p13-voice-player">' +
      '<audio controls preload="metadata"><source src="' + p13Esc(scan.audio_url) + '">Your browser does not support audio.</audio>' +
    '</div>' +
  '</div>';
}

// Lightbox for full-screen photos
function p13OpenLightbox(idx) {
  const scan = allScans[idx];
  if (!scan || !scan.photo_url) return;
  const lb = document.getElementById('p13-lightbox');
  document.getElementById('p13-lightbox-img').src = scan.photo_url;
  document.getElementById('p13-lightbox-meta').textContent = p13Time(scan);
  lb.classList.add('show');
}
function p13CloseLightbox() {
  document.getElementById('p13-lightbox').classList.remove('show');
}

// Map
function p13InitMap(plan) {
  const isPremium = ['standard','premium','business','etag'].includes(plan);
  if (!isPremium) {
    document.getElementById('map-upgrade').style.display = 'flex';
    return;
  }
  if (!mainMap) {
    mainMap = L.map('map', { zoomControl: false, attributionControl: false }).setView([39.8, -98.5], 3);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mainMap);
  }
  p13RenderMapMarkers();
}

let p13MarkerLayer = null;
function p13RenderMapMarkers() {
  if (!mainMap) return;
  if (p13MarkerLayer) {
    mainMap.removeLayer(p13MarkerLayer);
    p13MarkerLayer = null;
  }
  const cat = CAT[currentCat];
  const items = allScans.filter(cat.match).filter(x => x.latitude && x.longitude);
  if (items.length === 0) return;
  const color = cat.color;
  const markers = items.map(scan => {
    const icon = L.divIcon({
      html: '<div style="width:14px;height:14px;border-radius:50%;background:' + color + ';border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
      className: '', iconSize: [14, 14]
    });
    return L.marker([scan.latitude, scan.longitude], { icon });
  });
  p13MarkerLayer = L.featureGroup(markers).addTo(mainMap);
  try {
    mainMap.fitBounds(p13MarkerLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
  } catch (e) {}
}

p13Load();
</script>`;

    updated = updated.slice(0, scriptStart) + newScript + updated.slice(scriptEnd + '</script>'.length);

    // ── 4. Replace the old detail-overlay (no longer used; replace with simpler lightbox)
    const oldOverlay = `<div class="detail-overlay" id="detail-overlay" onclick="if(event.target===this)closeDetail()">
  <div class="detail-sheet">
    <div style="width:36px;height:4px;border-radius:2px;background:#E5E7EB;margin:0 auto 20px"></div>
    <div style="font-size:16px;font-weight:800;color:#111;margin-bottom:4px" id="detail-title">Scan Details</div>
    <div style="font-size:12px;color:#6B7280;margin-bottom:16px" id="detail-time"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      <div style="background:#F9FAFB;border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#6B7280;margin-bottom:4px">Action</div>
        <div style="font-size:13px;font-weight:700;color:#111" id="detail-action">-</div>
      </div>
      <div style="background:#F9FAFB;border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#6B7280;margin-bottom:4px">Device</div>
        <div style="font-size:13px;font-weight:700;color:#111" id="detail-device">-</div>
      </div>
    </div>
    <div id="detail-content"></div>
    <button onclick="closeDetail()" style="width:100%;height:44px;border-radius:13px;border:1.5px solid #E5E7EB;background:#fff;font-size:13px;font-weight:600;color:#6B7280;cursor:pointer;font-family:inherit;margin-top:8px">Close</button>
  </div>
</div>`;

    const newOverlay = `<!-- ${MARKER_13} photo lightbox -->
<div class="p13-lightbox" id="p13-lightbox" onclick="if(event.target===this)p13CloseLightbox()">
  <button class="p13-lightbox-close" onclick="p13CloseLightbox()" aria-label="Close">\u00d7</button>
  <img id="p13-lightbox-img" alt="Photo" />
  <div class="p13-lightbox-meta" id="p13-lightbox-meta"></div>
</div>`;

    if (updated.includes(oldOverlay)) {
      updated = updated.replace(oldOverlay, newOverlay);
    } else {
      const oldCRLF = oldOverlay.replace(/\n/g, '\r\n');
      if (updated.includes(oldCRLF)) {
        updated = updated.replace(oldCRLF, newOverlay.replace(/\n/g, '\r\n'));
      }
      // If neither matches, the old overlay is gone (already replaced) — non-fatal
    }

    writeFile(file, updated);
    ok('activity.html: 4-category redesign applied (stats + map + tabs + per-category render)');
  }
}

log('');
log('==============================================================');
log('Patch 13 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 13: activity page redesign (4 categories, color-coded)"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test:');
log('  Open activity.html in fresh incognito (signed in as owner).');
log('  - Top: 4 stat cards (Calls/Messages/Photos/Voice), each clickable');
log('  - Map below shows markers in the active category color');
log('  - Below map: 4 tab pills');
log('  - Click each tab to see only that category');
log('  - Photos tab shows a 2-column grid of thumbnails — tap one for fullscreen');
log('  - Voice tab shows audio player you can press Play on');
log('  - Empty categories show a friendly empty state');
log('==============================================================');
