// ============================================================================
// TapMyCar — Patch 2-fix: register.html navigates to OTP screen BEFORE
// awaiting the send-otp response. This means even when the backend
// correctly rejects a malformed email with 400, the user has already
// been moved to the OTP entry screen, and the toast error is invisible.
//
// What this patch does:
//   - Adds a frontend isValidEmail() check (mirror of the server-side
//     check in send-otp.js) so obviously bad emails are rejected
//     immediately with a toast, before any network call.
//   - Restructures sendOTP() in register.html so the screen change
//     happens AFTER the await and only if the response was successful.
//     If the API errors, we stay on step 1 and show the error toast.
//
// Properties:
//   - Idempotent
//   - Backs up register.html to backup-patch2fix-{timestamp}/
//   - Touches only public/register.html
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch2fix-register-flow.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch2fix-register-flow.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch2fix-register-flow.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch2fix-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const err = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) err('File not found: ' + p);
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
log('TapMyCar Patch 2-fix \u2014 register.html navigation timing');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Fix register.html sendOTP()
// ---------------------------------------------------------------------------

const MARKER = 'TMC_PATCH2FIX_REGISTER_FLOW';

{
  const file = path.join(PUBLIC, 'register.html');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('public/register.html (already fixed)');
  } else {
    // The buggy block — exactly as it appears in the file.
    const oldBlock = `async function sendOTP() {
  const email = document.getElementById('email').value.trim();
  const name = document.getElementById('name').value.trim();
  const countryCode = document.getElementById('country-code').value.replace('-CA',''); const phoneRaw = document.getElementById('phone').value.trim().replace(/[^0-9]/g,''); const phone = phoneRaw ? countryCode + phoneRaw : '';
  if (!name) { showToast('Please enter your name'); return; }
  if (!email) { showToast('Please enter your email'); return; }
  if (!phone) { showToast('Please enter your phone number'); return; }

  document.getElementById('step1').style.display = 'none';
  document.getElementById('step2').style.display = 'flex';
  document.getElementById('step2').style.flexDirection = 'column';
  document.getElementById('otp-subtitle').textContent = 'Sent to ' + email;
  startCountdown('resend-btn');

  try {
    const res = await fetch('/api/send-otp', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, name, phone })
    });
    const data = await res.json();
    if (!data.success) showToast(data.error || 'Failed to send code');
  } catch(e) { showToast('Network error'); }
}`;

    // Fixed version: validate, await, then change screen on success only.
    const newBlock = `// ${MARKER}
function tmcIsValidEmail(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 5 || s.length > 254) return false;
  return /^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$/.test(s);
}

async function sendOTP() {
  const email = document.getElementById('email').value.trim();
  const name = document.getElementById('name').value.trim();
  const countryCode = document.getElementById('country-code').value.replace('-CA',''); const phoneRaw = document.getElementById('phone').value.trim().replace(/[^0-9]/g,''); const phone = phoneRaw ? countryCode + phoneRaw : '';
  if (!name) { showToast('Please enter your name'); return; }
  if (!email) { showToast('Please enter your email'); return; }
  if (!tmcIsValidEmail(email)) { showToast('Please enter a valid email address'); return; }
  if (!phone) { showToast('Please enter your phone number'); return; }

  // Disable the button so users don't double-tap while we wait
  const btn = document.querySelector('button[onclick="sendOTP()"]') || document.querySelector('.send-otp-btn');
  if (btn) { btn.disabled = true; btn.dataset.tmcOrig = btn.textContent; btn.textContent = 'Sending...'; }

  try {
    const res = await fetch('/api/send-otp', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, name, phone })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      // Failure — stay on step 1, show the error
      showToast(data.error || 'Failed to send code');
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.tmcOrig || 'Send code'; }
      return;
    }

    // Success — NOW we navigate to the OTP screen
    document.getElementById('step1').style.display = 'none';
    document.getElementById('step2').style.display = 'flex';
    document.getElementById('step2').style.flexDirection = 'column';
    document.getElementById('otp-subtitle').textContent = 'Sent to ' + email;
    startCountdown('resend-btn');
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.tmcOrig || 'Send code'; }
  } catch(e) {
    showToast('Network error');
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.tmcOrig || 'Send code'; }
  }
}`;

    if (!content.includes(oldBlock)) {
      // Try with CRLF line endings (Windows-saved file)
      const oldBlockCRLF = oldBlock.replace(/\n/g, '\r\n');
      if (content.includes(oldBlockCRLF)) {
        // Also use CRLF in the new block to preserve file's line ending style
        const newBlockCRLF = newBlock.replace(/\n/g, '\r\n');
        backup(file);
        writeFile(file, content.replace(oldBlockCRLF, newBlockCRLF));
        ok('public/register.html sendOTP() fixed (CRLF line endings preserved)');
        // Skip the LF path below
      } else {
        err('public/register.html: expected sendOTP() block not found. Manual check required \u2014 file may have drifted from the audited state.');
      }
    } else {
      backup(file);
      writeFile(file, content.replace(oldBlock, newBlock));
      ok('public/register.html sendOTP() fixed: navigation now happens AFTER successful API response');
    }
  }
}

log('');
log('==============================================================');
log('Patch 2-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 2-fix: register.html OTP navigation timing"');
log('  git push');
log('');
log('Wait ~60 seconds for Vercel deploy, then test:');
log('  - Type "abc" as email -> should see "Please enter a valid email"');
log('    and STAY on step 1 (no navigation to OTP screen)');
log('  - Type valid email -> button shows "Sending..." briefly,');
log('    then navigates to OTP screen on success');
log('==============================================================');
