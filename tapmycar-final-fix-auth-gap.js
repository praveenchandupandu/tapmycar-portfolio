// ═══════════════════════════════════════════════════════════════
// FINAL fix for white gap on signup + signin pages.
// Previous patch used regex that didn't match. This one uses exact
// strings verified from the actual file contents.
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
    // Use split/join for multiple occurrences
    const before = content;
    content = content.split(r.find).join(r.replace);
    if (before !== content) {
      const occurrences = (before.split(r.find).length - 1);
      console.log(`[FIX] ${fileRel} :: ${r.label}${occurrences > 1 ? ' (×' + occurrences + ')' : ''}`);
      count += occurrences;
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

// ─── register.html ──────────────────────────────────────────
patch('public/register.html', [
  {
    label: '.page-inner min-height',
    find: '.page-inner{display:flex;flex-direction:column;min-height:calc(100vh - 12px);}',
    replace: '.page-inner{display:flex;flex-direction:column;padding-bottom:32px;}'
  },
  {
    label: 'also handle if above was our previous half-fix',
    find: '.page-inner{display:flex;flex-direction:column;min-height:auto;padding-bottom:32px;}',
    replace: '.page-inner{display:flex;flex-direction:column;padding-bottom:32px;}'
  },
  {
    label: 'button container margin-top:auto → 24px',
    find: '<div style="margin-top:auto">',
    replace: '<div style="margin-top:24px">'
  }
]);

// ─── signin.html ────────────────────────────────────────────
patch('public/signin.html', [
  {
    label: 'step1 min-height',
    find: '<div id="step1" style="display:flex;flex-direction:column;min-height:calc(100vh - 6px);padding:20px">',
    replace: '<div id="step1" style="display:flex;flex-direction:column;padding:20px 20px 32px">'
  },
  {
    label: 'step2 min-height (if present)',
    find: '<div id="step2" style="display:none;flex-direction:column;min-height:calc(100vh - 6px);padding:20px">',
    replace: '<div id="step2" style="display:none;flex-direction:column;padding:20px 20px 32px">'
  },
  {
    label: 'button container margin-top:auto → 24px',
    find: '<div style="margin-top:auto">',
    replace: '<div style="margin-top:24px">'
  }
]);

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));

if (totalFixes === 0) {
  console.log('[WARN] No fixes applied. Files may already be in final state.');
}

console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "FINAL: collapse white gap on signup/signin"');
console.log('  git push');
