// ═══════════════════════════════════════════════════════════════
// Minimal change: add small breathing room above Sign in button
// (and Send verification code button on register page).
// No layout restructure. Just a margin-top bump.
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

// Bump margin-top on the button container from `auto` to 32px
// (margin-top:auto pushes button far down → 32px gives just a nice breathing gap)
patch('public/signin.html', [
  {
    label: 'breathing gap above Sign in button',
    find: '<div style="margin-top:auto">',
    replace: '<div style="margin-top:32px">'
  }
]);

patch('public/register.html', [
  {
    label: 'breathing gap above Send verification / verify button',
    find: '<div style="margin-top:auto">',
    replace: '<div style="margin-top:32px">'
  }
]);

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));

if (totalFixes === 0) {
  console.log('[WARN] No margin-top:auto patterns found. Files may already be fixed.');
  console.log('       Run these PowerShell commands to check current state:');
  console.log('       Select-String -Path "public\\signin.html" -Pattern "margin-top"');
  console.log('       Select-String -Path "public\\register.html" -Pattern "margin-top"');
}

console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Add breathing gap above auth buttons"');
console.log('  git push');
