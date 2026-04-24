// ═══════════════════════════════════════════════════════════════
// OTP UX improvements:
// 1. Add autocomplete="one-time-code" + inputmode="numeric" to first OTP box
//    → iOS auto-suggests OTP from SMS/email above the keyboard
// 2. When iOS or paste fills all 6 digits into one box, spread them
//    across all 6 boxes automatically
// 3. Press Enter on last OTP box → auto-submit (signIn / verifyOTP)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

// ─── 1. Add autocomplete + inputmode to FIRST otp-box on signin + register ──
function patchFirstOtpBox(fileRel) {
  const file = path.join(ROOT, fileRel);
  if (!fs.existsSync(file)) {
    console.log(`[SKIP] ${fileRel} not found`);
    return;
  }
  let content = fs.readFileSync(file, 'utf8');

  // Match the first occurrence of <input class="otp-box" type="tel" maxlength="1">
  const firstOtpPattern = /<input class="otp-box" type="tel" maxlength="1">/;
  const newFirstOtp = '<input class="otp-box" type="tel" maxlength="6" inputmode="numeric" autocomplete="one-time-code">';

  // We only want to change THE FIRST occurrence, not all 6.
  // JavaScript replace() with string (not regex /g) already only replaces first — good.
  const before = content;
  content = content.replace(firstOtpPattern, newFirstOtp);

  if (before === content) {
    if (content.includes('autocomplete="one-time-code"')) {
      console.log(`[OK] ${fileRel} :: already has autocomplete`);
    } else {
      console.log(`[WARN] ${fileRel} :: otp-box pattern not found`);
    }
    return;
  }

  fs.writeFileSync(file, content, 'utf8');
  const rootCopy = path.join(ROOT, path.basename(fileRel));
  if (fileRel.startsWith('public/') && fs.existsSync(rootCopy)) {
    fs.copyFileSync(file, rootCopy);
  }
  console.log(`[FIX] ${fileRel} :: added autocomplete="one-time-code" to first OTP box`);
  totalFixes++;
}

patchFirstOtpBox('public/signin.html');
patchFirstOtpBox('public/register.html');

// ─── 2. Enhance initOTP in app.js ──────────────────────────
const appJsPath = path.join(ROOT, 'public', 'app.js');
if (!fs.existsSync(appJsPath)) {
  console.log('[SKIP] public/app.js not found');
} else {
  let content = fs.readFileSync(appJsPath, 'utf8');

  const oldInitOTP = `function initOTP() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val.length >= 1) {
        box.value = val[val.length - 1];
        box.classList.add('filled');
        if (i < boxes.length - 1) boxes[i + 1].focus();
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].classList.remove('filled');
      }
    });
  });
}`;

  const newInitOTP = `function initOTP() {
  const boxes = document.querySelectorAll('.otp-box');
  if (!boxes.length) return;

  // Detect which submit to trigger (signin vs register)
  function submitOTP() {
    if (typeof window.signIn === 'function') window.signIn();
    else if (typeof window.verifyOTP === 'function') window.verifyOTP();
  }

  // Spread a 6-digit string across the 6 boxes
  function fillBoxes(digits) {
    const clean = String(digits || '').replace(/\\D/g, '').slice(0, boxes.length);
    if (!clean) return;
    for (let i = 0; i < boxes.length; i++) {
      boxes[i].value = clean[i] || '';
      if (clean[i]) boxes[i].classList.add('filled');
      else boxes[i].classList.remove('filled');
    }
    const lastFilled = Math.min(clean.length, boxes.length) - 1;
    if (lastFilled >= 0) boxes[lastFilled].focus();
    // Auto-submit when all 6 are filled (great UX for iOS autofill)
    if (clean.length === boxes.length) setTimeout(submitOTP, 200);
  }

  boxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      // If iOS autofill or paste dumped multiple digits into this box, spread them
      if (val.length > 1) {
        fillBoxes(val);
        return;
      }
      if (val.length >= 1) {
        box.value = val[val.length - 1];
        box.classList.add('filled');
        if (i < boxes.length - 1) boxes[i + 1].focus();
      } else {
        box.classList.remove('filled');
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].classList.remove('filled');
      }
      // Enter on any OTP box → submit (as long as something is filled)
      if (e.key === 'Enter') {
        e.preventDefault();
        const full = Array.from(boxes).map(b => b.value).join('');
        if (full.length === boxes.length) submitOTP();
      }
    });
    // Handle paste into any box
    box.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      if (pasted && /\\d/.test(pasted)) {
        e.preventDefault();
        fillBoxes(pasted);
      }
    });
  });
}`;

  if (content.includes(oldInitOTP)) {
    content = content.replace(oldInitOTP, newInitOTP);
    fs.writeFileSync(appJsPath, content, 'utf8');
    const rootApp = path.join(ROOT, 'app.js');
    if (fs.existsSync(rootApp)) fs.copyFileSync(appJsPath, rootApp);
    console.log('[FIX] app.js :: enhanced initOTP (autofill spread + Enter submit + paste)');
    totalFixes++;
  } else if (content.includes('// Spread a 6-digit string across the 6 boxes')) {
    console.log('[OK] app.js :: already has enhanced initOTP');
  } else {
    console.log('[WARN] app.js :: initOTP pattern not found exactly, skipping');
  }
}

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "OTP: iOS autofill + Enter to submit + paste support"');
console.log('  git push');
