// ═══════════════════════════════════════════════════════════════
// Fix large white gap on signup + signin pages
//
// Problem: `.page-inner` / `#step1` has `min-height: calc(100vh - Xpx)`
// combined with `margin-top: auto` on the button container. This
// pushes the button to the very bottom of the viewport, leaving a
// huge empty gap between inputs and the submit button.
//
// Fix: remove the full-viewport-height constraint so the page flows
// naturally. Button sits right under the last input field.
// Footer ("By continuing..." / privacy links) gets a reasonable
// top spacing but isn't forced to the bottom.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

function patchFile(relPath, patches) {
  const filePath = path.join(ROOT, relPath);
  if (!fs.existsSync(filePath)) {
    console.log(`[SKIP] ${relPath} not found`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let fileFixes = 0;

  for (const p of patches) {
    if (content.includes(p.find)) {
      content = content.split(p.find).join(p.replace);
      console.log(`[FIX] ${relPath} :: ${p.label}`);
      fileFixes++;
    } else if (p.flexFind) {
      const m = content.match(p.flexFind);
      if (m) {
        content = content.replace(p.flexFind, p.replace);
        console.log(`[FIX] ${relPath} :: ${p.label} (flex match)`);
        fileFixes++;
      }
    }
  }

  if (fileFixes > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    // Sync to root if applicable
    const rootCopy = path.join(ROOT, path.basename(relPath));
    if (relPath.startsWith('public/') && fs.existsSync(rootCopy)) {
      fs.copyFileSync(filePath, rootCopy);
      console.log(`       └─ synced to ${path.basename(relPath)}`);
    }
  }
  totalFixes += fileFixes;
}

// ─── Fix register.html ──────────────────────────────────────
patchFile('public/register.html', [
  {
    label: 'remove min-height constraint from .page-inner',
    find: '.page-inner{display:flex;flex-direction:column;min-height:calc(100vh - 12px);}',
    replace: '.page-inner{display:flex;flex-direction:column;min-height:auto;padding-bottom:32px;}'
  },
  {
    label: 'remove margin-top:auto push on button container (step1)',
    find: '<div style="margin-top:auto">\n    <button class="btn" onclick="sendOTP()">Send verification code ',
    replace: '<div style="margin-top:24px">\n    <button class="btn" onclick="sendOTP()">Send verification code '
  },
  {
    label: 'remove margin-top:auto push on button container (step2 if present)',
    flexFind: /<div style="margin-top:auto">\s*<button class="btn" onclick="verifyOTP\(\)"/,
    replace: '<div style="margin-top:24px"><button class="btn" onclick="verifyOTP()"'
  }
]);

// ─── Fix signin.html ────────────────────────────────────────
patchFile('public/signin.html', [
  {
    label: 'remove min-height constraint from #step1',
    flexFind: /id="step1"\s*style="display:flex;flex-direction:column;min-height:calc\(100vh[^)]+\);padding:20px"/,
    replace: 'id="step1" style="display:flex;flex-direction:column;padding:20px 20px 32px"'
  },
  {
    label: 'remove min-height constraint from #step2 if present',
    flexFind: /id="step2"\s*style="display:none;flex-direction:column;min-height:calc\(100vh[^)]+\);padding:20px"/,
    replace: 'id="step2" style="display:none;flex-direction:column;padding:20px 20px 32px"'
  },
  {
    label: 'button container margin-top',
    find: '<div style="margin-top:auto">\n    <button class="btn" onclick="signIn()"',
    replace: '<div style="margin-top:24px">\n    <button class="btn" onclick="signIn()"'
  },
  {
    label: 'OTP step button container margin-top (if present)',
    flexFind: /<div style="margin-top:auto">\s*<button class="btn" onclick="verifyOTP\(\)"/,
    replace: '<div style="margin-top:24px"><button class="btn" onclick="verifyOTP()"'
  }
]);

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Remove huge white gap on signup/signin pages"');
console.log('  git push');
