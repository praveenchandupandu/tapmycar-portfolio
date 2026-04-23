// ═══════════════════════════════════════════════════════════════
// Combined fix: Add min-height:100dvh + margin-top:auto so button
// sits at bottom of visible screen (like user's target screenshot).
// Uses dvh (dynamic viewport height) so button is always visible,
// never hidden behind browser toolbar.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

function patch(fileRel, rules) {
  const file = path.join(ROOT, fileRel);
  if (!fs.existsSync(file)) {
    console.log(`[SKIP] ${fileRel} not found`);
    return;
  }
  let content = fs.readFileSync(file, 'utf8');
  let count = 0;

  for (const r of rules) {
    const occ = (content.split(r.find).length - 1);
    if (occ > 0) {
      content = content.split(r.find).join(r.replace);
      console.log(`[FIX] ${fileRel} :: ${r.label}${occ > 1 ? ' (×' + occ + ')' : ''}`);
      count += occ;
    }
  }

  if (count > 0) {
    fs.writeFileSync(file, content, 'utf8');
    const rootCopy = path.join(ROOT, path.basename(fileRel));
    if (fileRel.startsWith('public/') && fs.existsSync(rootCopy)) {
      fs.copyFileSync(file, rootCopy);
    }
  }
  totalFixes += count;
}

// ─── signin.html ──────────────────────────
patch('public/signin.html', [
  {
    label: 'add min-height:100dvh to step1',
    find: '<div id="step1" style="display:flex;flex-direction:column;padding:20px 20px 32px">',
    replace: '<div id="step1" style="display:flex;flex-direction:column;min-height:calc(100dvh - 6px);padding:20px">'
  },
  {
    label: 'restore margin-top:auto on button container',
    find: '<div style="margin-top:24px">',
    replace: '<div style="margin-top:auto">'
  }
]);

// ─── register.html ──────────────────────────
patch('public/register.html', [
  {
    label: 'add min-height:100dvh to .page-inner',
    find: '.page-inner{display:flex;flex-direction:column;padding-bottom:32px;}',
    replace: '.page-inner{display:flex;flex-direction:column;min-height:calc(100dvh - 12px);}'
  },
  {
    label: 'also handle alt variant',
    find: '.page-inner{display:flex;flex-direction:column;min-height:auto;padding-bottom:32px;}',
    replace: '.page-inner{display:flex;flex-direction:column;min-height:calc(100dvh - 12px);}'
  }
]);

// For register.html we also need margin-top:auto on button containers (there are 2 - step1 and step2)
// Current state shows no margin-top references — so register's buttons aren't being pushed down at all.
// We need to add margin-top:auto to the button wrappers.
// Look at actual current state of register.html before this transformation

const registerPath = path.join(ROOT, 'public', 'register.html');
if (fs.existsSync(registerPath)) {
  let content = fs.readFileSync(registerPath, 'utf8');
  let changed = false;

  // The button wrappers — need to find them by their contents
  // Step 1 button: "Send verification code"
  // Step 2 button: "verifyOTP" (create account)
  const step1Pattern = /<div>\s*<button class="btn" onclick="sendOTP\(\)">Send verification code/;
  const step2Pattern = /<div>\s*<button class="btn" onclick="verifyOTP\(\)"/;

  if (step1Pattern.test(content)) {
    content = content.replace(step1Pattern, '<div style="margin-top:auto">\n    <button class="btn" onclick="sendOTP()">Send verification code');
    console.log('[FIX] register.html :: added margin-top:auto on Send verification button');
    changed = true;
    totalFixes++;
  } else if (/<div style="margin-top:(24px|32px)">\s*<button class="btn" onclick="sendOTP\(\)"/.test(content)) {
    content = content.replace(/<div style="margin-top:(24px|32px)">\s*<button class="btn" onclick="sendOTP\(\)"/, '<div style="margin-top:auto">\n    <button class="btn" onclick="sendOTP()"');
    console.log('[FIX] register.html :: changed Send verification button wrapper to margin-top:auto');
    changed = true;
    totalFixes++;
  }

  if (step2Pattern.test(content)) {
    content = content.replace(step2Pattern, '<div style="margin-top:auto">\n    <button class="btn" onclick="verifyOTP()"');
    console.log('[FIX] register.html :: added margin-top:auto on verifyOTP button');
    changed = true;
    totalFixes++;
  } else if (/<div style="margin-top:(24px|32px)">\s*<button class="btn" onclick="verifyOTP\(\)"/.test(content)) {
    content = content.replace(/<div style="margin-top:(24px|32px)">\s*<button class="btn" onclick="verifyOTP\(\)"/, '<div style="margin-top:auto">\n    <button class="btn" onclick="verifyOTP()"');
    console.log('[FIX] register.html :: changed verifyOTP button wrapper to margin-top:auto');
    changed = true;
    totalFixes++;
  }

  if (changed) {
    fs.writeFileSync(registerPath, content, 'utf8');
    const rootCopy = path.join(ROOT, 'register.html');
    if (fs.existsSync(rootCopy)) fs.copyFileSync(registerPath, rootCopy);
  }
}

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));

if (totalFixes === 0) {
  console.log('[WARN] No changes applied. Files may already match target state.');
}

console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Auth pages: min-height:100dvh + margin-top:auto (button at bottom)"');
console.log('  git push');
