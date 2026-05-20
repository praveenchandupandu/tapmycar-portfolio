// ============================================================================
// TapMyCar - Patch 35b-scan: NFC tap + QR scan for Gift Activate form
//
// Adds two buttons above the token input on the Gift Activate Tag form:
//
//   1. "Tap NFC" - uses the browser's NDEFReader API (Android Chrome only).
//      Auto-hides on iOS / unsupported browsers.
//
//   2. "Scan QR" - opens a full-screen camera overlay with a centered
//      viewfinder. Uses jsQR (~45KB) loaded from cdnjs on demand. When a
//      TapMyCar tag QR is detected, validates the format and auto-fills
//      the token input.
//
// Both methods:
//   - Validate the detected URL matches the TapMyCar /tag/TMC-XXXXXX
//     pattern
//   - Auto-fill the token input and trigger a visible flash so the admin
//     knows it worked
//   - Allow re-scanning if something invalid is detected
//
// No backend / no schema changes. Pure UI enhancement to Patch 35b.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35bscan-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) { return fs.readFileSync(p, 'utf8'); }
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
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 35b-scan \u2014 NFC + QR for Gift Activate form');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35BSCAN_NFC_QR';

const file = path.join(PUBLIC, 'admin.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('admin.html (already patched)');
  process.exit(0);
}
backup(file);

let updated = content;

// =============================================================================
// 35b-scan.1  Insert scan buttons above the token input
// =============================================================================

const oldField = `        <div class="field">
          <label class="field-label">Tag token</label>
          <input type="text" class="gen-input" id="p35b-token" placeholder="TMC-XXXXXX" oninput="this.value=this.value.toUpperCase()" maxlength="16">
        </div>`;

const newField = `        <div class="field">
          <label class="field-label">Tag token</label>
          <!-- ${MARKER}: scan buttons -->
          <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <button type="button" class="gen-btn" id="p35bs-nfc-btn" onclick="p35bsTapNfc()" style="display:none;flex:1;min-width:120px;padding:11px 14px;background:#0E0E0E;color:#fff">
              <svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-3px;margin-right:6px" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
              Tap NFC
            </button>
            <button type="button" class="gen-btn" id="p35bs-qr-btn" onclick="p35bsScanQr()" style="flex:1;min-width:120px;padding:11px 14px;background:#FF6B00;color:#fff">
              <svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-3px;margin-right:6px" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z M17 17h4v4h-4z M14 19h2v2h-2z"/></svg>
              Scan QR
            </button>
          </div>
          <input type="text" class="gen-input" id="p35b-token" placeholder="TMC-XXXXXX (or use Tap / Scan above)" oninput="this.value=this.value.toUpperCase()" maxlength="16">
        </div>`;

const r1 = safeReplace(updated, oldField, newField);
if (!r1) errExit('admin.html: token field anchor not found');
updated = r1;
ok('Scan buttons added above token input');

// =============================================================================
// 35b-scan.2  Add the full-screen QR overlay HTML + JS at the end of <body>
//             (before the closing </body>)
// =============================================================================

const oldBodyClose = `</body>
</html>`;

const newBodyClose = `
<!-- ${MARKER}: Full-screen QR scan overlay -->
<div id="p35bs-qr-overlay" style="display:none;position:fixed;inset:0;background:#000;z-index:9999;flex-direction:column">
  <div style="position:absolute;top:0;left:0;right:0;padding:16px 18px;background:linear-gradient(180deg,rgba(0,0,0,0.7),transparent);color:#fff;display:flex;align-items:center;justify-content:space-between;z-index:2">
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#FFAB6D">Gift Activate</div>
      <div style="font-size:15px;font-weight:700;margin-top:2px">Scan a TapMyCar tag</div>
    </div>
    <button onclick="p35bsCloseQr()" style="background:rgba(255,255,255,0.15);color:#fff;border:0;border-radius:50%;width:40px;height:40px;font-size:24px;font-weight:300;line-height:1;cursor:pointer">\u00d7</button>
  </div>

  <video id="p35bs-qr-video" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"></video>

  <!-- Viewfinder overlay -->
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2">
    <div style="position:relative;width:240px;height:240px">
      <div style="position:absolute;top:0;left:0;width:34px;height:34px;border-top:4px solid #FF6B00;border-left:4px solid #FF6B00;border-radius:6px 0 0 0"></div>
      <div style="position:absolute;top:0;right:0;width:34px;height:34px;border-top:4px solid #FF6B00;border-right:4px solid #FF6B00;border-radius:0 6px 0 0"></div>
      <div style="position:absolute;bottom:0;left:0;width:34px;height:34px;border-bottom:4px solid #FF6B00;border-left:4px solid #FF6B00;border-radius:0 0 0 6px"></div>
      <div style="position:absolute;bottom:0;right:0;width:34px;height:34px;border-bottom:4px solid #FF6B00;border-right:4px solid #FF6B00;border-radius:0 0 6px 0"></div>
      <!-- scanning line -->
      <div id="p35bs-scanline" style="position:absolute;top:0;left:8px;right:8px;height:2px;background:linear-gradient(90deg,transparent,#FF6B00,transparent);box-shadow:0 0 12px #FF6B00;animation:p35bs-scan 2s ease-in-out infinite"></div>
    </div>
  </div>

  <div id="p35bs-qr-status" style="position:absolute;bottom:0;left:0;right:0;padding:20px 24px 28px;background:linear-gradient(0deg,rgba(0,0,0,0.85),transparent);color:#fff;text-align:center;z-index:2">
    <div id="p35bs-qr-msg" style="font-size:14px;font-weight:600;letter-spacing:-0.2px">Point the camera at the QR code on the back of the sticker.</div>
  </div>

  <canvas id="p35bs-qr-canvas" style="display:none"></canvas>
</div>

<style>
@keyframes p35bs-scan {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(232px); }
}
</style>

<script>
// ${MARKER}: NFC + QR scan logic

(function() {
  /* Show NFC button only if the browser supports NDEFReader (Android Chrome) */
  function checkNfcSupport() {
    var btn = document.getElementById('p35bs-nfc-btn');
    if (!btn) return;
    if ('NDEFReader' in window) {
      btn.style.display = '';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkNfcSupport);
  } else {
    checkNfcSupport();
  }
})();

/* Extract a TMC-XXXXXX token from a URL or raw string. Returns null if
   the value does not look like a TapMyCar tag. */
function p35bsExtractToken(raw) {
  if (!raw) return null;
  var s = String(raw).trim();
  /* Pattern 1: a full URL like https://tapmycar.io/tag/TMC-44HSQ5 */
  var m = s.match(/\\/tag\\/(TMC-[A-Z0-9]{6,12})/i);
  if (m) return m[1].toUpperCase();
  /* Pattern 2: a bare token TMC-XXXXXX */
  m = s.match(/^(TMC-[A-Z0-9]{6,12})$/i);
  if (m) return m[1].toUpperCase();
  /* Pattern 3: token embedded anywhere in a string */
  m = s.match(/(TMC-[A-Z0-9]{6,12})/i);
  if (m) return m[1].toUpperCase();
  return null;
}

function p35bsFillToken(token) {
  var input = document.getElementById('p35b-token');
  if (!input) return;
  input.value = token;
  /* visual feedback - flash the input */
  var orig = input.style.background;
  input.style.background = '#FFF3EC';
  input.style.transition = 'background 0.4s ease';
  setTimeout(function() { input.style.background = orig; }, 1200);
  /* also flash the result area with success */
  var result = document.getElementById('p35b-result');
  if (result) {
    result.innerHTML = '<div class="p26-ok">\u2705 Token captured: <strong>' + token + '</strong>. Set plan + months below, then activate.</div>';
  }
}

/* ---------- NFC tap (Android Chrome) ---------- */
async function p35bsTapNfc() {
  if (!('NDEFReader' in window)) {
    alert('NFC reading is only supported on Android Chrome. Use Scan QR instead.');
    return;
  }
  var btn = document.getElementById('p35bs-nfc-btn');
  var origText = btn.innerHTML;
  btn.innerHTML = 'Hold sticker to phone\u2026';
  btn.disabled = true;
  try {
    var reader = new NDEFReader();
    await reader.scan();
    /* Listen ONCE - we want one tap to fill, not continuous reading */
    var done = false;
    reader.onreading = function(event) {
      if (done) return;
      var msg = event.message;
      var url = null;
      for (var i = 0; i < msg.records.length; i++) {
        var rec = msg.records[i];
        if (rec.recordType === 'url' || rec.recordType === 'absolute-url') {
          var dec = new TextDecoder();
          url = dec.decode(rec.data);
          break;
        }
        if (rec.recordType === 'text') {
          var dec2 = new TextDecoder();
          url = dec2.decode(rec.data);
          break;
        }
      }
      var token = p35bsExtractToken(url);
      if (token) {
        done = true;
        p35bsFillToken(token);
      } else {
        var result = document.getElementById('p35b-result');
        if (result) result.innerHTML = '<div class="p26-error">\u274c Tag detected but not a TapMyCar tag. Try another sticker.</div>';
      }
      btn.innerHTML = origText;
      btn.disabled = false;
    };
    reader.onreadingerror = function() {
      var result = document.getElementById('p35b-result');
      if (result) result.innerHTML = '<div class="p26-error">\u274c NFC read failed. Try again.</div>';
      btn.innerHTML = origText;
      btn.disabled = false;
    };
    /* Auto-reset button after 20 sec if no scan */
    setTimeout(function() {
      if (!done) {
        btn.innerHTML = origText;
        btn.disabled = false;
      }
    }, 20000);
  } catch (e) {
    var msg = (e && e.message) || 'NFC error';
    var result = document.getElementById('p35b-result');
    if (result) result.innerHTML = '<div class="p26-error">\u274c ' + msg + '</div>';
    btn.innerHTML = origText;
    btn.disabled = false;
  }
}

/* ---------- QR scan (camera + jsQR) ---------- */

let p35bsQrStream = null;
let p35bsQrLoopActive = false;
let p35bsQrLib = null;

async function p35bsLoadJsQr() {
  if (p35bsQrLib || (typeof jsQR === 'function')) {
    return Promise.resolve();
  }
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js';
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error('Failed to load QR library')); };
    document.head.appendChild(s);
  });
}

async function p35bsScanQr() {
  var overlay = document.getElementById('p35bs-qr-overlay');
  var video = document.getElementById('p35bs-qr-video');
  var canvas = document.getElementById('p35bs-qr-canvas');
  var statusMsg = document.getElementById('p35bs-qr-msg');
  if (!overlay || !video || !canvas) return;

  overlay.style.display = 'flex';
  statusMsg.textContent = 'Loading scanner\u2026';

  try {
    await p35bsLoadJsQr();
  } catch (e) {
    statusMsg.innerHTML = '<span style="color:#FCA5A5">Could not load QR scanner. Check your internet connection.</span>';
    return;
  }

  try {
    p35bsQrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = p35bsQrStream;
    await video.play();
    statusMsg.textContent = 'Point the camera at the QR code on the back of the sticker.';
  } catch (e) {
    statusMsg.innerHTML = '<span style="color:#FCA5A5">Camera access denied. Enable it in browser settings and try again.</span>';
    return;
  }

  p35bsQrLoopActive = true;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  function loop() {
    if (!p35bsQrLoopActive) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = window.jsQR(imageData.data, canvas.width, canvas.height, {
        inversionAttempts: 'dontInvert'
      });
      if (code && code.data) {
        var token = p35bsExtractToken(code.data);
        if (token) {
          p35bsQrLoopActive = false;
          statusMsg.innerHTML = '<span style="color:#34D399">\u2705 ' + token + ' captured!</span>';
          /* Brief success flash, then close */
          setTimeout(function() {
            p35bsFillToken(token);
            p35bsCloseQr();
          }, 600);
          return;
        } else {
          /* Detected a QR but not a TapMyCar one. Keep looking. */
          statusMsg.innerHTML = '<span style="color:#FCA5A5">Not a TapMyCar tag. Try a different sticker.</span>';
        }
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function p35bsCloseQr() {
  p35bsQrLoopActive = false;
  var overlay = document.getElementById('p35bs-qr-overlay');
  var video = document.getElementById('p35bs-qr-video');
  if (p35bsQrStream) {
    try {
      p35bsQrStream.getTracks().forEach(function(t) { t.stop(); });
    } catch (e) {}
    p35bsQrStream = null;
  }
  if (video) {
    try { video.pause(); video.srcObject = null; } catch (e) {}
  }
  if (overlay) overlay.style.display = 'none';
}
</script>

</body>
</html>`;

const r2 = safeReplace(updated, oldBodyClose, newBodyClose);
if (!r2) errExit('admin.html: body close anchor not found');
updated = r2;
ok('QR overlay + NFC/QR JS appended to body');

// =============================================================================
// Validate result
// =============================================================================

writeFile(file, updated);

const verify = readFile(file);
const markers = (verify.match(/TMC_PATCH35BSCAN_NFC_QR/g) || []).length;
const hasScanButtons = verify.includes('p35bs-nfc-btn') && verify.includes('p35bs-qr-btn');
const hasOverlay = verify.includes('p35bs-qr-overlay');
const hasJsQrLoader = verify.includes('p35bsLoadJsQr');
const hasNfcHandler = verify.includes('async function p35bsTapNfc');
const hasQrHandler = verify.includes('async function p35bsScanQr');
const balanced = verify.split('<script').length === verify.split('</script>').length;

log('');
log('Verification:');
log('  markers: ' + markers + ' (>=3 expected)');
log('  scan buttons present: ' + hasScanButtons);
log('  overlay present: ' + hasOverlay);
log('  jsQR loader present: ' + hasJsQrLoader);
log('  NFC handler present: ' + hasNfcHandler);
log('  QR handler present: ' + hasQrHandler);
log('  script tags balanced: ' + balanced);

if (markers < 3) errExit('Marker count too low');
if (!hasScanButtons) errExit('Scan buttons missing');
if (!hasOverlay) errExit('Overlay missing');
if (!hasNfcHandler) errExit('NFC handler missing');
if (!hasQrHandler) errExit('QR handler missing');
if (!balanced) errExit('Script tags unbalanced');

ok('All structural checks passed');

log('');
log('==============================================================');
log('Patch 35b-scan complete.');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35b-scan: NFC + QR scan for Gift Activate"');
log('  git push');
log('  Wait ~60 sec.');
log('');
log('IMPORTANT \u2014 HTTPS required:');
log('  Both NFC and camera APIs ONLY work over HTTPS. They will not');
log('  work on http://localhost or http://. Since tapmycar.io is HTTPS,');
log('  this is fine in production.');
log('');
log('Test plan:');
log('  Open https://tapmycar.io/admin.html ON YOUR PHONE (not desktop).');
log('  Go to Promos tab. The Gift Activate Tag card now shows two buttons');
log('  above the token field:');
log('    - "Tap NFC"  (only visible on Android Chrome; iOS hides it)');
log('    - "Scan QR"  (visible everywhere)');
log('');
log('  NFC test (Android only):');
log('    1. Tap "Tap NFC" \u2192 button shows "Hold sticker to phone..."');
log('    2. Touch a physical TapMyCar sticker to the back of your phone');
log('    3. Token auto-fills into the input. Result area shows success.');
log('    4. Fill plan/months, click "Activate as Gift".');
log('');
log('  QR test (iOS + Android):');
log('    1. Tap "Scan QR" \u2192 browser asks for camera permission \u2192 allow');
log('    2. Full-screen camera opens with orange viewfinder corners');
log('    3. Point at the QR code on the back of a TapMyCar sticker');
log('    4. On detection: "TMC-XXXXX captured!" \u2192 closes automatically');
log('       \u2192 token is filled in. Continue with plan/months/activate.');
log('    5. If a non-TapMyCar QR is in view, status says "Not a TapMyCar');
log('       tag" and scanning keeps going. Tap \u00d7 in top-right to cancel.');
log('==============================================================');
