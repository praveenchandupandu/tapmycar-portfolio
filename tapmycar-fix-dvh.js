// ═══════════════════════════════════════════════════════════════
// Fix: change min-height: 100vh → 100dvh on signin + register
// This makes the page respect the browser toolbar area, so the
// Sign in button is always visible without scrolling.
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
    label: '100vh → 100dvh (step1)',
    find: 'min-height:calc(100vh - 6px)',
    replace: 'min-height:calc(100dvh - 6px)'
  },
  {
    label: '100vh → 100dvh (step2 if exists)',
    find: 'min-height:calc(100vh - 12px)',
    replace: 'min-height:calc(100dvh - 12px)'
  },
  {
    label: '100vh → 100dvh (plain)',
    find: 'min-height:100vh',
    replace: 'min-height:100dvh'
  }
]);

// ─── register.html ──────────────────────────
patch('public/register.html', [
  {
    label: '100vh → 100dvh (.page-inner)',
    find: 'min-height:calc(100vh - 12px)',
    replace: 'min-height:calc(100dvh - 12px)'
  },
  {
    label: '100vh → 100dvh (plain)',
    find: 'min-height:100vh',
    replace: 'min-height:100dvh'
  }
]);

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));

if (totalFixes === 0) {
  console.log('[WARN] No 100vh patterns found. Checking current state...');
  console.log('       Run: Select-String -Path "public\\signin.html","public\\register.html" -Pattern "min-height"');
}

console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Use 100dvh so signin button always visible above browser toolbar"');
console.log('  git push');
