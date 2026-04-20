// ═══════════════════════════════════════════════════════════════════
// TapMyCar — Session 2b hotfix script
// Fixes activation flow so it works with the new pricing backend.
// ═══════════════════════════════════════════════════════════════════
// Run with:  node tapmycar-fix-activation.js
// From dir:  C:\Users\PRAVEEN CHANDU\Documents\tapmycar
//
// Changes made:
//   activate.html  — fix tag display (TMC. → TMC-), fix API call params
//   contact.html   — fix API call params to match new backend
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
let totalFixes = 0;

function patchFile(relPath, patches) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  [SKIP] ${relPath} not found`);
    return;
  }
  let content = fs.readFileSync(fullPath, 'utf8');
  let fileChanges = 0;

  for (const { name, find, replace } of patches) {
    if (content.includes(find)) {
      content = content.replace(find, replace);
      console.log(`  [FIX] ${relPath} :: ${name}`);
      fileChanges++;
      totalFixes++;
    } else if (content.includes(replace)) {
      console.log(`  [OK]  ${relPath} :: ${name} (already patched)`);
    } else {
      console.log(`  [WARN] ${relPath} :: ${name} — pattern not found, manual review needed`);
    }
  }

  if (fileChanges > 0) {
    fs.writeFileSync(fullPath, content, 'utf8');
  }
}

console.log('═══ TapMyCar activation hotfix ═══');
console.log('');

// ─── ACTIVATE.HTML: three fixes ────────────────────────────────
console.log('Patching public/activate.html...');
patchFile('public/activate.html', [
  {
    name: 'placeholder text TMC.XXXXXX → TMC-XXXXXX',
    find: '<div class="result-tag" id="r-token">TMC.XXXXXX</div>',
    replace: '<div class="result-tag" id="r-token">TMC-XXXXXX</div>'
  },
  {
    name: 'tag display formatter (period → dash)',
    find: "document.getElementById('r-token').textContent = 'TMC.' + token.replace('TMC','');",
    replace: "document.getElementById('r-token').textContent = 'TMC-' + token.replace(/^TMC[-.]?/,'');"
  },
  {
    name: 'API call params (add flow, plan, prepay)',
    find: `const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        user_id: s.token,
        plan: 'etag',
        address: address
      })
    });`,
    replace: `const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        user_id: s.token,
        flow: 'activate',
        plan: 'standard',
        prepay: false,
        referral_discount: 0
      })
    });`
  }
]);

// ─── CONTACT.HTML: one fix ─────────────────────────────────────
console.log('');
console.log('Patching public/contact.html...');
patchFile('public/contact.html', [
  {
    name: 'API call params (add flow)',
    find: "const res=await fetch('/api/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:registrationData.userId,plan:'etag',token:currentToken})});",
    replace: "const res=await fetch('/api/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:registrationData.userId,flow:'activate',plan:'standard',prepay:false,referral_discount:0,token:currentToken})});"
  }
]);

// ─── Sync to root copies (Vercel deploys from root, not /public) ─
console.log('');
console.log('Syncing to root copies...');
['activate.html', 'contact.html'].forEach(f => {
  const src = path.join(ROOT, 'public', f);
  const dest = path.join(ROOT, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  [SYNC] public/${f} → ${f}`);
  }
});

console.log('');
console.log('═════════════════════════════════════');
console.log(`Total fixes applied: ${totalFixes}`);
console.log('═════════════════════════════════════');
console.log('');
console.log('Next: commit and push with');
console.log('  git add -A');
console.log('  git commit -m "Session 2b: activation hotfix (API params + tag display)"');
console.log('  git push');
