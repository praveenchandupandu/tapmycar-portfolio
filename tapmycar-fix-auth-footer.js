// ═══════════════════════════════════════════════════════════════
// Fix signin.html (and same pattern on register.html):
// 1. Move the footer (Privacy/Terms/Support + copyright) INSIDE
//    the flex container so it's visible on screen
// 2. Remove the border-top separator between "Sign up free" and
//    the footer (no gap, no line)
// 3. Tighten the button wrapper margin so there's a small breath
//    of space but everything fits without scroll
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

// ─── signin.html ────────────────────────────────────────────
const signinPath = path.join(ROOT, 'public', 'signin.html');
if (!fs.existsSync(signinPath)) {
  console.log('[SKIP] public/signin.html not found');
} else {
  let content = fs.readFileSync(signinPath, 'utf8');
  let changed = false;

  // Strategy: find the standalone footer block that sits outside #step1,
  // extract it, remove border-top + margin-top, move it INSIDE #step1
  // as the last child (after the Sign up free link container).

  // Match the standalone footer block (varies slightly but usually contains Privacy + Terms + Praman Tech LLC)
  const footerMatch = content.match(/<div style="padding:20px 20px 32px;text-align:center;border-top:\.5px solid #E5E7EB;margin-top:24px;background:#fff">[\s\S]*?<\/div>/);

  if (footerMatch) {
    const originalFooter = footerMatch[0];
    // Strip border-top + margin-top and reduce padding (no separator line, no gap)
    const cleanFooter = originalFooter
      .replace(';border-top:.5px solid #E5E7EB', '')
      .replace(';margin-top:24px', '')
      .replace('padding:20px 20px 32px', 'padding:16px 20px 8px');

    // Remove footer from its current (outside #step1) position
    content = content.replace(originalFooter, '');

    // Insert it INSIDE #step1, right before closing </div> of the margin-top:auto wrapper
    // The button wrapper looks like:  <div style="margin-top:auto"> ... </div>\n</div>
    // (last </div> closes #step1)
    // We want footer inside that wrapper so flex-pushes them together.

    // Simpler: insert just before the closing </div> of #step1 itself
    // Find the closing </div> that ends #step1. #step1 opens with id="step1", we need the matching closer.
    // Easiest: find the last </div> before the toast block (which comes right after #step1)
    const toastIdx = content.indexOf('<div class="toast"');
    if (toastIdx > 0) {
      // Find the </div> just before it (should be step1's closer)
      const beforeToast = content.substring(0, toastIdx);
      const lastCloseDiv = beforeToast.lastIndexOf('</div>');
      if (lastCloseDiv > 0) {
        content = content.substring(0, lastCloseDiv) + cleanFooter + '\n' + content.substring(lastCloseDiv);
        console.log('[FIX] signin.html :: moved footer inside step1 (no border-top, no gap)');
        changed = true;
        totalFixes++;
      }
    }
  } else {
    console.log('[INFO] signin.html :: no standalone footer block found (may already be inside or absent)');
  }

  // Also reduce the min-height so everything fits
  if (content.includes('min-height:calc(100dvh - 6px)')) {
    // Already using dvh, good
  } else if (content.includes('min-height:calc(100vh - 6px)')) {
    content = content.replace('min-height:calc(100vh - 6px)', 'min-height:calc(100dvh - 6px)');
    console.log('[FIX] signin.html :: vh → dvh');
    changed = true;
    totalFixes++;
  }

  // Reduce margin-top between OTP section and button so everything fits
  // (margin-top:auto is fine, but we could add slight top-padding reduction to step1)
  if (content.includes('min-height:calc(100dvh - 6px);padding:20px"')) {
    content = content.replace(
      'min-height:calc(100dvh - 6px);padding:20px"',
      'min-height:calc(100dvh - 6px);padding:16px 20px 0"'
    );
    console.log('[FIX] signin.html :: reduced padding to give footer room');
    changed = true;
    totalFixes++;
  }

  if (changed) {
    fs.writeFileSync(signinPath, content, 'utf8');
    const root = path.join(ROOT, 'signin.html');
    if (fs.existsSync(root)) fs.copyFileSync(signinPath, root);
  }
}

// ─── register.html ────────────────────────────────────────────
const registerPath = path.join(ROOT, 'public', 'register.html');
if (!fs.existsSync(registerPath)) {
  console.log('[SKIP] public/register.html not found');
} else {
  let content = fs.readFileSync(registerPath, 'utf8');
  let changed = false;

  // Same pattern for register.html
  const footerMatch = content.match(/<div style="padding:20px 20px 32px;text-align:center;border-top:\.5px solid #E5E7EB;margin-top:24px;background:#fff">[\s\S]*?<\/div>/);

  if (footerMatch) {
    const originalFooter = footerMatch[0];
    const cleanFooter = originalFooter
      .replace(';border-top:.5px solid #E5E7EB', '')
      .replace(';margin-top:24px', '')
      .replace('padding:20px 20px 32px', 'padding:16px 20px 8px');

    content = content.replace(originalFooter, '');

    // Find the step1/step2 panel we want to inject footer into — step1 is active by default
    // register has .page-inner for both step1 and step2. We want footer inside step1.
    const step1Close = content.indexOf('<div class="page-inner" id="step2"');
    if (step1Close > 0) {
      // Insert footer right before step2 starts (which means inside/after step1's last content)
      // But step1 is already closed by its </div> before step2 opens. Find that closer.
      const beforeStep2 = content.substring(0, step1Close);
      const lastCloseDiv = beforeStep2.lastIndexOf('</div>');
      if (lastCloseDiv > 0) {
        content = content.substring(0, lastCloseDiv) + cleanFooter + '\n' + content.substring(lastCloseDiv);
        console.log('[FIX] register.html :: moved footer inside step1');
        changed = true;
        totalFixes++;
      }
    }
  } else {
    console.log('[INFO] register.html :: no standalone footer block found');
  }

  // vh → dvh
  if (content.includes('min-height:calc(100vh - 12px)')) {
    content = content.replace('min-height:calc(100vh - 12px)', 'min-height:calc(100dvh - 12px)');
    console.log('[FIX] register.html :: vh → dvh');
    changed = true;
    totalFixes++;
  }

  if (changed) {
    fs.writeFileSync(registerPath, content, 'utf8');
    const root = path.join(ROOT, 'register.html');
    if (fs.existsSync(root)) fs.copyFileSync(registerPath, root);
  }
}

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));

if (totalFixes === 0) {
  console.log('[WARN] No changes. Share current file content for deeper diagnosis.');
}

console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Auth: move footer inside flex container, remove separator"');
console.log('  git push');
