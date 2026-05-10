// ============================================================================
// TapMyCar - Patch 18: Admin user-support & visibility
//
// Three improvements to the admin user-detail panel + a global error-message
// improvement. Touches only public/admin.html.
//
// 18.1  User-detail header — show full picture:
//       - Phone verified status badge (green check / yellow warning)
//       - Total scans counter
//       - Stranger contact stats: "X calls · Y messages · Z photos · W voice"
//       - Vehicle details: make/model/year/color, license plate
//       - Stripe subscription_id with "View in Stripe" button
//         (links to dashboard.stripe.com/subscriptions/{id})
//       - Last activity timestamp
//
// 18.2  User-detail body — 4 contact-category tabs:
//       - Calls / Messages / Photos / Voice memos
//       - Each shows actual content (message text, photo thumb, audio player)
//       - Photos open in fullscreen lightbox
//       - Same data model the user sees on their own activity.html page,
//         so admin and user see identical info for support investigations.
//
// 18.3  Specific error messages on all admin actions:
//       - Replace "errors: N" toasts with the actual API error text from
//         data.error. If error message is long, truncates with ellipsis.
//       - Affects: suspend/reactivate, gift plan, gift activation, update
//         user, delete batch, finalize receive, change order status, etc.
//
// Properties:
//   - Idempotent
//   - Backups admin.html to backup-patch18-{timestamp}/
//
// REQUIRES: Patches 1-17 already applied locally.
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch18-user-support.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch18-user-support.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch18-user-support.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch18-${ts}`);

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
log('TapMyCar Patch 18 \u2014 Admin user-support & visibility');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_18 = 'TMC_PATCH18_USER_SUPPORT';

{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  if (content.includes(MARKER_18)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // ── 18.0 - Add CSS for the redesigned user-detail panel ──
    const cssAnchor = `/* TMC_PATCH16_ADMIN_COLORS: hide number-input spinners for cleaner dark UI */`;
    const cssAddition = `/* ${MARKER_18}: user-detail support panel */
.p18-row{display:flex;align-items:center;gap:8px;font-size:11.5px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.p18-row:last-child{border-bottom:none}
.p18-row-k{color:#64748B;font-weight:500;flex-shrink:0;min-width:90px}
.p18-row-v{color:#E5E7EB;font-weight:600;text-align:right;flex:1;word-break:break-all}
.p18-row-v.dim{color:#94A3B8;font-style:italic;font-weight:500}
.p18-row-v.brand{color:#FF6B00;font-weight:700}
.p18-row-v.green{color:#4ADE80}
.p18-row-v.yellow{color:#FDE047}
.p18-row-v.mono{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:10.5px}
.p18-row-link{color:#60A5FA !important;font-weight:600;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:11px}
.p18-row-link:hover{text-decoration:underline}
.p18-row-link svg{width:10px;height:10px;stroke:currentColor;stroke-width:2.4;fill:none}
.p18-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 0 14px}
.p18-stat-grid > div{background:#0F1F3D;border-radius:10px;padding:10px 4px;text-align:center}
.p18-stat-num{font-size:18px;font-weight:800;color:#FF6B00;line-height:1}
.p18-stat-lbl{font-size:9px;color:#94A3B8;font-weight:600;margin-top:4px;text-transform:uppercase;letter-spacing:.4px}
.p18-pv-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px}
.p18-pv-badge.ok{background:#14532D;color:#4ADE80}
.p18-pv-badge.warn{background:#713F12;color:#FDE047}
.p18-pv-badge svg{width:10px;height:10px;stroke:currentColor;stroke-width:2.5;fill:none}

/* Contact tabs inside user detail */
.p18-tabs{display:flex;gap:5px;margin:10px 0;background:#0A1730;padding:4px;border-radius:10px}
.p18-tab{flex:1;background:transparent;border:none;padding:8px 6px;border-radius:7px;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.p18-tab.active{background:#FF6B00;color:#fff}
.p18-tab-count{display:inline-block;margin-left:4px;font-size:9px;opacity:.8}

.p18-content{min-height:80px}
.p18-empty{padding:24px 12px;text-align:center;color:#64748B;font-size:11px}

.p18-item{background:#0F1F3D;border:1px solid rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;margin-bottom:6px}
.p18-item-time{font-size:10px;color:#94A3B8;font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:6px}
.p18-item-time .p18-loc-link{margin-left:auto;color:#60A5FA;text-decoration:none;font-size:9.5px;font-weight:700}
.p18-item-msg{background:#1A2D4A;border-left:3px solid #FF6B00;border-radius:6px;padding:8px 10px;font-size:12px;color:#E5E7EB;line-height:1.4;margin-top:4px}
.p18-item-stat{font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;display:inline-block}
.p18-item-stat.completed,.p18-item-stat.bridged{background:#14532D;color:#4ADE80}
.p18-item-stat.message_only{background:#581C87;color:#D8B4FE}
.p18-item-stat.no_answer{background:#713F12;color:#FDE047}
.p18-item-stat.busy,.p18-item-stat.failed,.p18-item-stat.canceled{background:#7F1D1D;color:#FCA5A5}

.p18-photo-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.p18-photo-tile{position:relative;aspect-ratio:1/1;border-radius:8px;overflow:hidden;background:#0F1F3D;cursor:pointer}
.p18-photo-tile img{width:100%;height:100%;object-fit:cover;display:block}
.p18-photo-tile-time{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,transparent,rgba(0,0,0,.75));color:#fff;font-size:9px;font-weight:600;padding:6px 8px}

.p18-voice-player audio{width:100%;height:32px;margin-top:6px;border-radius:99px}

.p18-lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:500;align-items:center;justify-content:center;padding:20px}
.p18-lightbox.show{display:flex}
.p18-lightbox img{max-width:100%;max-height:80vh;border-radius:10px}
.p18-lightbox-close{position:absolute;top:18px;right:18px;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;border:none;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.p18-lightbox-meta{position:absolute;left:0;right:0;bottom:24px;text-align:center;color:#fff;font-size:13px;font-weight:600}

/* TMC_PATCH16_ADMIN_COLORS: hide number-input spinners for cleaner dark UI */`;

    let r = tryReplace(updated, cssAnchor, cssAddition);
    if (!r) errExit('admin.html: CSS anchor for patch 16 not found');
    updated = r;

    // ── 18.1 + 18.2 — Replace the user-detail sheet HTML ──
    const oldSheet = `<div id="user-detail-sheet" style="display:none;position:fixed;bottom:0;left:0;right:0;max-width:430px;margin:0 auto;background:#1E2D4A;border-radius:20px 20px 0 0;z-index:401;max-height:85vh;overflow-y:auto;padding:20px">`;
    const newSheet = `<div id="user-detail-sheet" style="display:none;position:fixed;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;background:#1E2D4A;border-radius:20px 20px 0 0;z-index:401;max-height:90vh;overflow-y:auto;padding:20px"> <!-- ${MARKER_18} -->`;

    r = tryReplace(updated, oldSheet, newSheet);
    if (!r) errExit('admin.html: user-detail-sheet anchor not found');
    updated = r;

    // Replace the inner info-card block to add new rows
    const oldInfoCard = `        <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#64748B">Email</span><span style="color:#fff" id="ud-email">-</span></div>
        <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#64748B">Phone</span><span style="color:#fff" id="ud-phone">-</span></div>
        <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#64748B">Plan</span><span style="color:#FF6B00;font-weight:700" id="ud-plan">-</span></div>
        <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#64748B">User ID</span><span style="color:#64748B;font-size:9px;font-family:monospace" id="ud-id">-</span></div>`;

    const newInfoCard = `        <!-- ${MARKER_18}: enriched info rows -->
        <div class="p18-row"><span class="p18-row-k">Email</span><span class="p18-row-v" id="ud-email">-</span></div>
        <div class="p18-row"><span class="p18-row-k">Phone</span><span class="p18-row-v" id="ud-phone-row">-</span></div>
        <div class="p18-row"><span class="p18-row-k">Plan</span><span class="p18-row-v brand" id="ud-plan">-</span></div>
        <div class="p18-row"><span class="p18-row-k">Subscription</span><span class="p18-row-v" id="ud-sub">-</span></div>
        <div class="p18-row"><span class="p18-row-k">Last seen</span><span class="p18-row-v" id="ud-last-seen">-</span></div>
        <div class="p18-row"><span class="p18-row-k">User ID</span><span class="p18-row-v mono" id="ud-id">-</span></div>`;

    r = tryReplace(updated, oldInfoCard, newInfoCard);
    if (!r) errExit('admin.html: info-card anchor not found');
    updated = r;

    // Insert the new stat-grid + contact-tabs + content area AFTER the
    // tags card and BEFORE the scans card.
    const oldTagsAndScans = `    <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Tags</div>
    <div id="ud-tags" style="background:#0F1F3D;border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;color:#64748B">Loading tags...</div>
    </div>

    <!-- User's Recent Scans -->
    <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Recent Scans</div>
    <div id="ud-scans" style="background:#0F1F3D;border-radius:12px;padding:12px;margin-bottom:16px">
      <div style="font-size:11px;color:#64748B">Loading scans...</div>
    </div>`;

    const newTagsAndStats = `    <!-- ${MARKER_18}: vehicle card -->
    <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Vehicle</div>
    <div id="ud-vehicle-card" style="background:#0F1F3D;border-radius:12px;padding:12px;margin-bottom:12px">
      <div id="ud-vehicle" style="font-size:11px;color:#64748B">No vehicle info</div>
    </div>

    <!-- ${MARKER_18}: stat grid -->
    <div class="p18-stat-grid">
      <div><div class="p18-stat-num" id="ud-stat-scans">0</div><div class="p18-stat-lbl">Scans</div></div>
      <div><div class="p18-stat-num" id="ud-stat-calls">0</div><div class="p18-stat-lbl">Calls</div></div>
      <div><div class="p18-stat-num" id="ud-stat-msgs">0</div><div class="p18-stat-lbl">Msgs</div></div>
      <div><div class="p18-stat-num" id="ud-stat-photos">0</div><div class="p18-stat-lbl">Photos</div></div>
    </div>

    <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Tags</div>
    <div id="ud-tags" style="background:#0F1F3D;border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;color:#64748B">Loading tags...</div>
    </div>

    <!-- ${MARKER_18}: stranger-contact tabs -->
    <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Stranger contacts</div>
    <div class="p18-tabs">
      <button type="button" class="p18-tab active" data-p18cat="calls" onclick="p18SwitchCat('calls')">Calls<span class="p18-tab-count" id="p18-c-calls"></span></button>
      <button type="button" class="p18-tab" data-p18cat="messages" onclick="p18SwitchCat('messages')">Msgs<span class="p18-tab-count" id="p18-c-messages"></span></button>
      <button type="button" class="p18-tab" data-p18cat="photos" onclick="p18SwitchCat('photos')">Photos<span class="p18-tab-count" id="p18-c-photos"></span></button>
      <button type="button" class="p18-tab" data-p18cat="voice" onclick="p18SwitchCat('voice')">Voice<span class="p18-tab-count" id="p18-c-voice"></span></button>
    </div>
    <div class="p18-content" id="p18-content" style="margin-bottom:16px"></div>

    <!-- Legacy ud-scans kept hidden for safety -->
    <div id="ud-scans" style="display:none"></div>`;

    r = tryReplace(updated, oldTagsAndScans, newTagsAndStats);
    if (!r) errExit('admin.html: ud-tags / ud-scans anchor not found');
    updated = r;

    // Append the photo lightbox once, at end of user-detail-sheet
    const oldSheetClose = `        <button id="ud-suspend-btn" onclick="toggleSuspend()" style="flex:1;background:#DC2626;color:#fff;font-size:11px;font-weight:700;padding:10px 0;border-radius:10px;border:none;cursor:pointer;font-family:'Inter',sans-serif">Suspend User</button>`;
    if (!updated.includes(oldSheetClose) && !updated.includes(oldSheetClose.replace(/\n/g, '\r\n'))) {
      errExit('admin.html: suspend button anchor not found');
    }

    // Insert lightbox right after user-detail-sheet's closing </div> structure.
    // The cleanest place is right before the next sibling element after the sheet.
    // We'll insert near the existing user-detail-overlay block.
    const oldOverlayMarker = `<!-- User Detail Slide-up -->`;
    const newOverlayMarker = `<!-- ${MARKER_18}: photo lightbox -->
<div class="p18-lightbox" id="p18-lightbox" onclick="if(event.target===this)p18CloseLightbox()">
  <button class="p18-lightbox-close" onclick="p18CloseLightbox()" aria-label="Close">\u00d7</button>
  <img id="p18-lightbox-img" alt="Photo" />
  <div class="p18-lightbox-meta" id="p18-lightbox-meta"></div>
</div>

<!-- User Detail Slide-up -->`;

    r = tryReplace(updated, oldOverlayMarker, newOverlayMarker);
    if (!r) errExit('admin.html: User Detail Slide-up comment anchor not found');
    updated = r;

    // ── 18.3 — Replace openUserDetail() function to populate all new fields ──
    const oldOpenFn = `function openUserDetail(userId) {
  const user = allUsersData.find(u => u.id === userId);
  if (!user) { showToast('User not found'); return; }
  currentDetailUser = user;

  // Fill basic info
  document.getElementById('ud-avatar').textContent = (user.name || 'U')[0].toUpperCase();
  document.getElementById('ud-name').textContent = user.name || 'Unknown';
  document.getElementById('ud-joined').textContent = 'Joined ' + new Date(user.created_at).toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});
  document.getElementById('ud-email').textContent = user.email || '';
  document.getElementById('ud-phone').textContent = user.phone || '';
  document.getElementById('ud-plan').textContent = (user.plan || 'etag').toUpperCase();
  document.getElementById('ud-id').textContent = user.id;`;

    const newOpenFn = `// ${MARKER_18}: state for category tabs
let p18CurrentCat = 'calls';
let p18UserScans = [];

function p18Esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}
function p18Time(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function p18Match(scan, cat) {
  if (cat === 'calls') return scan.action === 'call' || scan.contact_action === 'call';
  if (cat === 'messages') return (scan.action === 'quick_message' || scan.contact_action === 'quick_message') && scan.message_text;
  if (cat === 'photos') return scan.photo_url && scan.photo_url.length > 10;
  if (cat === 'voice') return scan.audio_url && scan.audio_url.length > 10;
  return false;
}
function p18LocLink(scan) {
  if (scan.latitude && scan.longitude) {
    const url = 'https://www.google.com/maps?q=' + encodeURIComponent(scan.latitude + ',' + scan.longitude);
    return '<a class="p18-loc-link" href="' + p18Esc(url) + '" target="_blank" rel="noopener">View on map ↗</a>';
  }
  return '';
}
function p18RenderCallItem(scan) {
  const dur = scan.duration_seconds || 0;
  const durTxt = dur > 0 ? ' \u00b7 ' + Math.floor(dur/60) + 'm ' + (dur % 60) + 's' : '';
  const status = scan.call_status || (scan.contact_action === 'call' ? 'completed' : 'completed');
  const statusLabel = { completed:'Connected', bridged:'Connected', message_only:'Message sent', no_answer:'No answer', busy:'Busy', failed:'Failed', canceled:'Canceled', ringing:'Ringing' }[status] || 'Call';
  return '<div class="p18-item">' +
    '<div class="p18-item-time">' + p18Esc(p18Time(scan.scanned_at)) + p18Esc(durTxt) + p18LocLink(scan) + '</div>' +
    '<span class="p18-item-stat ' + p18Esc(status) + '">' + p18Esc(statusLabel) + '</span>' +
  '</div>';
}
function p18RenderMsgItem(scan) {
  return '<div class="p18-item">' +
    '<div class="p18-item-time">' + p18Esc(p18Time(scan.scanned_at)) + p18LocLink(scan) + '</div>' +
    '<div class="p18-item-msg">' + p18Esc(scan.message_text || '') + '</div>' +
  '</div>';
}
function p18RenderPhotoTile(scan, idx) {
  return '<div class="p18-photo-tile" onclick="p18OpenLightbox(' + idx + ')">' +
    '<img src="' + p18Esc(scan.photo_url) + '" alt="" loading="lazy">' +
    '<div class="p18-photo-tile-time">' + p18Esc(p18Time(scan.scanned_at)) + '</div>' +
  '</div>';
}
function p18RenderVoiceItem(scan) {
  return '<div class="p18-item">' +
    '<div class="p18-item-time">' + p18Esc(p18Time(scan.scanned_at)) + p18LocLink(scan) + '</div>' +
    '<div class="p18-voice-player"><audio controls preload="metadata"><source src="' + p18Esc(scan.audio_url) + '"></audio></div>' +
  '</div>';
}
function p18SwitchCat(cat) {
  p18CurrentCat = cat;
  document.querySelectorAll('.p18-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.p18cat === cat);
  });
  p18Render();
}
function p18UpdateCounts() {
  ['calls','messages','photos','voice'].forEach(c => {
    const el = document.getElementById('p18-c-' + c);
    if (el) {
      const n = p18UserScans.filter(s => p18Match(s, c)).length;
      el.textContent = n > 0 ? '(' + n + ')' : '';
    }
  });
}
function p18Render() {
  const root = document.getElementById('p18-content');
  if (!root) return;
  const items = p18UserScans.filter(s => p18Match(s, p18CurrentCat));
  if (items.length === 0) {
    const labels = { calls:'No calls received', messages:'No messages received', photos:'No photos received', voice:'No voice memos received' };
    root.innerHTML = '<div class="p18-empty">' + labels[p18CurrentCat] + '</div>';
    return;
  }
  if (p18CurrentCat === 'calls') root.innerHTML = items.map(p18RenderCallItem).join('');
  else if (p18CurrentCat === 'messages') root.innerHTML = items.map(p18RenderMsgItem).join('');
  else if (p18CurrentCat === 'photos') root.innerHTML = '<div class="p18-photo-grid">' + items.map((s) => p18RenderPhotoTile(s, p18UserScans.indexOf(s))).join('') + '</div>';
  else if (p18CurrentCat === 'voice') root.innerHTML = items.map(p18RenderVoiceItem).join('');
}
function p18OpenLightbox(idx) {
  const scan = p18UserScans[idx];
  if (!scan || !scan.photo_url) return;
  document.getElementById('p18-lightbox-img').src = scan.photo_url;
  document.getElementById('p18-lightbox-meta').textContent = p18Time(scan.scanned_at);
  document.getElementById('p18-lightbox').classList.add('show');
}
function p18CloseLightbox() {
  document.getElementById('p18-lightbox').classList.remove('show');
}
window.p18SwitchCat = p18SwitchCat;
window.p18OpenLightbox = p18OpenLightbox;
window.p18CloseLightbox = p18CloseLightbox;

function openUserDetail(userId) {
  const user = allUsersData.find(u => u.id === userId);
  if (!user) { showToast('User not found'); return; }
  currentDetailUser = user;

  // Basic header
  document.getElementById('ud-avatar').textContent = (user.name || 'U')[0].toUpperCase();
  document.getElementById('ud-name').textContent = user.name || 'Unknown';
  document.getElementById('ud-joined').textContent = 'Joined ' + new Date(user.created_at).toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});
  document.getElementById('ud-email').textContent = user.email || '\u2014';

  // ${MARKER_18}: phone with verified badge
  const phoneEl = document.getElementById('ud-phone-row');
  if (phoneEl) {
    const phone = user.phone ? p18Esc(user.phone) : '<span class="dim">Not set</span>';
    const verified = !!user.phone_verified;
    const badge = user.phone
      ? (verified
          ? '<span class="p18-pv-badge ok"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Verified</span>'
          : '<span class="p18-pv-badge warn"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Unverified</span>')
      : '';
    phoneEl.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">' + phone + ' ' + badge + '</span>';
  }

  document.getElementById('ud-plan').textContent = (user.plan || 'etag').toUpperCase();

  // ${MARKER_18}: subscription_id with Stripe link
  const subEl = document.getElementById('ud-sub');
  if (subEl) {
    if (user.subscription_id) {
      const sid = p18Esc(user.subscription_id);
      const stripeUrl = 'https://dashboard.stripe.com/subscriptions/' + encodeURIComponent(user.subscription_id);
      subEl.innerHTML = '<a class="p18-row-link" href="' + p18Esc(stripeUrl) + '" target="_blank" rel="noopener">' + sid.slice(0, 20) + (sid.length > 20 ? '…' : '') + ' <svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><polyline points="7 7 17 7 17 17"/></svg></a>';
    } else {
      subEl.innerHTML = '<span class="dim">None</span>';
    }
  }

  document.getElementById('ud-id').textContent = user.id;

  // ${MARKER_18}: status badge`;

    r = tryReplace(updated, oldOpenFn, newOpenFn);
    if (!r) errExit('admin.html: openUserDetail anchor not found');
    updated = r;

    // Now we need to handle the rest of openUserDetail — find the next block
    // that renders tags, then ensure we insert vehicle + stat updates.
    // ── 18.3 cont. — Replace the JS that renders user's tags so it works
    // with the new HTML structure (the "User's tags" label is now outside
    // the box, not injected into innerHTML).
    const oldTagsBlock = `  // Find user's tags
  const userTags = allTagsData.filter(t => t.owner_id === userId);
  if (userTags.length > 0) {
    document.getElementById('ud-tags').innerHTML = userTags.map(t => {
      const sc = t.status === 'active' ? 'ba' : t.status === 'unclaimed' ? 'bw' : 'br';
      return \`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:.5px solid rgba(255,255,255,.05)"><div><div style="font-size:12px;font-weight:700;color:#FF6B00;font-family:monospace">\${formatToken(t.token)}</div><div style="font-size:9px;color:#64748B">\${t.license_plate || 'No plate'}  \${t.vehicle_label || ''}</div></div><span class="\${sc}" style="font-size:8px">\${t.status}</span></div>\`;
    }).join('');
  } else {
    document.getElementById('ud-tags').innerHTML = '<div style="font-size:11px;color:#64748B">No tags assigned</div>';
  }

  // Load user's scan activity
  document.getElementById('ud-scans').innerHTML = '<div style="font-size:11px;color:#64748B">Loading...</div>';
  loadUserScans(userId, userTags);`;

    const newTagsBlock = `  // Find user's tags
  const userTags = allTagsData.filter(t => t.owner_id === userId);
  if (userTags.length > 0) {
    document.getElementById('ud-tags').innerHTML = userTags.map(t => {
      const sc = t.status === 'active' ? 'ba' : t.status === 'unclaimed' ? 'bw' : 'br';
      return \`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:.5px solid rgba(255,255,255,.05)"><div><div style="font-size:12px;font-weight:700;color:#FF6B00;font-family:monospace">\${formatToken(t.token)}</div><div style="font-size:9px;color:#64748B">\${t.license_plate || 'No plate'} \u00b7 \${t.vehicle_label || ''}</div></div><span class="\${sc}" style="font-size:8px">\${t.status}</span></div>\`;
    }).join('');
  } else {
    document.getElementById('ud-tags').innerHTML = '<div style="font-size:11px;color:#64748B">No tags assigned</div>';
  }

  // ${MARKER_18}: vehicle card — first tag's car details
  const vehEl = document.getElementById('ud-vehicle');
  if (vehEl) {
    const firstTag = userTags[0];
    if (firstTag && (firstTag.car_make || firstTag.car_model || firstTag.car_year || firstTag.car_color || firstTag.license_plate)) {
      const car = [firstTag.car_year, firstTag.car_color, firstTag.car_make, firstTag.car_model].filter(Boolean).join(' ');
      const plate = firstTag.license_plate ? '<span style="background:#1A2D4A;color:#FF6B00;padding:3px 10px;border-radius:6px;font-family:monospace;font-size:11px;font-weight:700;letter-spacing:.5px">' + p18Esc(firstTag.license_plate) + '</span>' : '';
      const carHtml = car ? '<span style="color:#E5E7EB;font-size:12px;font-weight:600">' + p18Esc(car) + '</span>' : '<span style="color:#64748B;font-size:11px;font-style:italic">Unnamed vehicle</span>';
      vehEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' + carHtml + ' ' + plate + '</div>';
    } else {
      vehEl.innerHTML = '<div style="font-size:11px;color:#64748B;font-style:italic">No vehicle info</div>';
    }
  }

  // ${MARKER_18}: load scans + populate stats + render category tabs
  p18UserScans = [];
  document.getElementById('ud-stat-scans').textContent = '\u2026';
  document.getElementById('ud-stat-calls').textContent = '\u2026';
  document.getElementById('ud-stat-msgs').textContent = '\u2026';
  document.getElementById('ud-stat-photos').textContent = '\u2026';
  document.getElementById('p18-content').innerHTML = '<div class="p18-empty">Loading\u2026</div>';
  loadUserScansP18(userId, userTags);`;

    r = tryReplace(updated, oldTagsBlock, newTagsBlock);
    if (!r) errExit('admin.html: user-tags block anchor not found');
    updated = r;

    // ── 18.3 cont. — Replace loadUserScans with rich version ──
    const oldLoadScans = `async function loadUserScans(userId, userTags) {
  if (!userTags || userTags.length === 0) {
    document.getElementById('ud-scans').innerHTML = '<div style="font-size:11px;color:#64748B">No scans  user has no tags</div>';
    return;
  }
  try {
    const res = await fetch('/api/get-dashboard?user_id=' + userId);
    const data = await res.json();
    if (data.recentScans && data.recentScans.length > 0) {
      document.getElementById('ud-scans').innerHTML = data.recentScans.map(s => {
        const date = new Date(s.scanned_at).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
        const action = s.contact_action || s.action || 'view';
        return \`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:.5px solid rgba(255,255,255,.05)"><div style="font-size:11px;color:#fff">\${date}</div><span class="bw" style="font-size:8px">\${action}</span></div>\`;
      }).join('');
    } else {
      document.getElementById('ud-scans').innerHTML = '<div style="font-size:11px;color:#64748B">No scans yet</div>';
    }
  } catch(e) {
    document.getElementById('ud-scans').innerHTML = '<div style="font-size:11px;color:#FCA5A5">Failed to load</div>';
  }
}`;

    const newLoadScans = `// ${MARKER_18}: loads user scans, populates stat grid and category tabs.
//   Also updates the "Last seen" row in the header.
async function loadUserScansP18(userId, userTags) {
  if (!userTags || userTags.length === 0) {
    p18UserScans = [];
    document.getElementById('ud-stat-scans').textContent = '0';
    document.getElementById('ud-stat-calls').textContent = '0';
    document.getElementById('ud-stat-msgs').textContent = '0';
    document.getElementById('ud-stat-photos').textContent = '0';
    document.getElementById('p18-content').innerHTML = '<div class="p18-empty">User has no tags yet</div>';
    document.getElementById('ud-last-seen').innerHTML = '<span class="dim">Never</span>';
    p18UpdateCounts();
    return;
  }
  try {
    const res = await fetch('/api/get-dashboard?user_id=' + userId);
    const data = await res.json();
    p18UserScans = data.recentScans || [];

    // Total scans count from data.scanCount (full count, not capped to 50)
    const scanTotal = (data.scanCount != null) ? data.scanCount : p18UserScans.length;
    document.getElementById('ud-stat-scans').textContent = scanTotal;
    document.getElementById('ud-stat-calls').textContent = p18UserScans.filter(s => p18Match(s, 'calls')).length;
    document.getElementById('ud-stat-msgs').textContent = p18UserScans.filter(s => p18Match(s, 'messages')).length;
    document.getElementById('ud-stat-photos').textContent = p18UserScans.filter(s => p18Match(s, 'photos')).length;

    // Last seen = most recent scanned_at across recentScans
    const lastSeenEl = document.getElementById('ud-last-seen');
    if (lastSeenEl) {
      if (p18UserScans.length > 0) {
        const newest = p18UserScans.reduce((a, b) => new Date(a.scanned_at) > new Date(b.scanned_at) ? a : b);
        lastSeenEl.textContent = p18Time(newest.scanned_at);
      } else {
        lastSeenEl.innerHTML = '<span class="dim">No scans yet</span>';
      }
    }

    p18UpdateCounts();
    p18CurrentCat = 'calls';
    document.querySelectorAll('.p18-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.p18cat === 'calls');
    });
    p18Render();
  } catch(e) {
    document.getElementById('p18-content').innerHTML = '<div class="p18-empty" style="color:#FCA5A5">Failed to load user data: ' + p18Esc(e && e.message ? e.message : 'network error') + '</div>';
  }
}

// Old function kept as no-op alias for any inline onclicks still referencing it
function loadUserScans() {}`;

    r = tryReplace(updated, oldLoadScans, newLoadScans);
    if (!r) errExit('admin.html: loadUserScans anchor not found');
    updated = r;

    // ── 18.3 — Replace error toast patterns to show specific messages ──
    // Generic pattern across admin: showToast(... + 'errors)') and showToast(data.error || 'Failed')
    // We improve specific spots by changing 'errors: N' to include the first error message.
    // Targeted replacements for high-frequency error displays.

    // Specific suspend/reactivate error display
    const oldSuspendErr = `showToast('Failed to update');`;
    const newSuspendErr = `showToast(p18ErrText(data && data.error) || 'Failed to update'); /* ${MARKER_18} */`;
    // do this only on first occurrence
    if (updated.includes(oldSuspendErr)) {
      updated = updated.replace(oldSuspendErr, newSuspendErr);
    }

    // Gift plan errors
    const oldGiftErr = `} else { showToast(data.error || 'Failed'); }`;
    const newGiftErr = `} else { showToast(p18ErrText(data && data.error) || 'Failed'); } /* ${MARKER_18} */`;
    // Replace ALL occurrences (about 10 in the file)
    let occCount = 0;
    while (updated.includes(oldGiftErr)) {
      updated = updated.replace(oldGiftErr, newGiftErr.replace('/* ' + MARKER_18 + ' */', '/* ' + MARKER_18 + ' ' + (++occCount) + ' */'));
    }

    // Insert the helper function once
    const helperAnchor = `function openUserDetail(userId) {`;
    const helperAddition = `// ${MARKER_18}: error text helper — formats API errors clearly
function p18ErrText(err) {
  if (!err) return '';
  const s = String(err);
  if (s.length > 80) return s.slice(0, 77) + '…';
  return s;
}
function openUserDetail(userId) {`;

    r = tryReplace(updated, helperAnchor, helperAddition);
    if (!r) errExit('admin.html: helper anchor not found');
    updated = r;

    writeFile(file, updated);
    ok('admin.html: user-detail support panel + categories + error messages');
  }
}

log('');
log('==============================================================');
log('Patch 18 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 18: admin user-support panel + contact categories"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test plan:');
log('  1. Open admin > Users');
log('  2. Tap any user');
log('  3. Verify the user detail sheet shows:');
log('     - Phone with green Verified or yellow Unverified badge');
log('     - Plan + Subscription with Stripe link (if premium/standard)');
log('     - Last seen timestamp');
log('     - Vehicle card with make/model/year/color + license plate');
log('     - 4 stat cards: Scans / Calls / Msgs / Photos');
log('     - 4 contact tabs: Calls / Msgs / Photos / Voice');
log('     - Click each tab — see the actual data (msg text, photo, audio)');
log('     - Tap a photo thumbnail — opens full-screen lightbox');
log('  4. Try an action that fails (e.g. suspend a non-existent user via');
log('     network throttling) — toast should show specific error.');
log('==============================================================');
