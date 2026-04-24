// ═══════════════════════════════════════════════════════════════
// Retry app.js OTP enhancement — uses regex instead of exact string
// match to handle CRLF/LF differences and whitespace variance.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const appJsPath = path.join(ROOT, 'public', 'app.js');
if (!fs.existsSync(appJsPath)) {
  console.error('public/app.js not found');
  process.exit(1);
}
let content = fs.readFileSync(appJsPath, 'utf8');

// Check if already enhanced
if (content.includes('Spread a 6-digit string across the 6 boxes')) {
  console.log('[OK] app.js already has enhanced OTP logic');
  process.exit(0);
}

// Match initOTP function flexibly — from `function initOTP() {` through its closing `}`
// Use a pattern that matches the function body by counting braces is complex in regex,
// but we know the exact structure: the function ends before `function getOTPValue` or similar.

const startMarker = 'function initOTP() {';
const endMarker = 'function getOTPValue()';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  console.error('[ERROR] Could not locate initOTP function boundaries');
  console.error(`  startIdx=${startIdx}, endIdx=${endIdx}`);
  process.exit(1);
}

// Build the replacement function
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
      // Enter on any OTP box = submit (as long as all 6 are filled)
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
}

`;

// Splice: keep everything before initOTP, insert newInitOTP, keep everything from getOTPValue onward
const newContent = content.substring(0, startIdx) + newInitOTP + content.substring(endIdx);

fs.writeFileSync(appJsPath, newContent, 'utf8');
const rootApp = path.join(ROOT, 'app.js');
if (fs.existsSync(rootApp)) fs.copyFileSync(appJsPath, rootApp);

console.log('[FIX] app.js :: replaced initOTP with enhanced version');
console.log('       (autofill spread + Enter submit + paste handling)');
console.log('[SYNC] public/app.js -> app.js');
console.log('');
console.log('═'.repeat(50));
console.log('');
console.log('IMPORTANT: check git diff carefully before commit');
console.log('The ONLY change should be inside initOTP function.');
console.log('');
console.log('Commands:');
console.log('  git diff public/app.js | Select-Object -First 80');
console.log('  git add -A');
console.log('  git commit -m "OTP: enhance initOTP for autofill + Enter submit"');
console.log('  git push');
