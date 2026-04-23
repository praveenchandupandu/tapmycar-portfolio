// ═══════════════════════════════════════════════════════════════
// 1. Hide chatbot on signin/register pages (auth flow — no clutter)
// 2. Apply clean layout to signin + register so content fills screen
//    naturally without huge white gap
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

// ─── PART 1: Hide chatbot on signin + register ──────────────
const appJsPath = path.join(ROOT, 'public', 'app.js');
if (fs.existsSync(appJsPath)) {
  let content = fs.readFileSync(appJsPath, 'utf8');

  const oldGuard = `function injectChatbot() {
  if (window.location.pathname.includes('admin')) return;`;

  const newGuard = `function injectChatbot() {
  const path = window.location.pathname;
  // Skip chatbot on admin pages and auth pages (signin/register)
  if (path.includes('admin')) return;
  if (path.includes('signin') || path.includes('register')) return;`;

  if (content.includes(oldGuard)) {
    content = content.replace(oldGuard, newGuard);
    fs.writeFileSync(appJsPath, content, 'utf8');
    const rootCopy = path.join ? path.join(ROOT, 'app.js') : ROOT + '/app.js';
    if (fs.existsSync(require('path').join(ROOT, 'app.js'))) {
      fs.copyFileSync(appJsPath, require('path').join(ROOT, 'app.js'));
    }
    console.log('[FIX] app.js :: chatbot now hidden on signin + register');
    totalFixes++;
  } else if (content.includes("path.includes('signin')")) {
    console.log('[OK] app.js :: chatbot already hidden on auth pages');
  }
}

// ─── PART 2: Fix signin.html layout ─────────────────────────
const signinPath = path.join(ROOT, 'public', 'signin.html');
if (fs.existsSync(signinPath)) {
  let content = fs.readFileSync(signinPath, 'utf8');
  let fileFixes = 0;

  // Replace step1 opening div with flex layout that naturally distributes content
  const step1Variants = [
    '<div id="step1" style="display:flex;flex-direction:column;padding:20px 20px 32px">',
    '<div id="step1" style="display:flex;flex-direction:column;min-height:calc(100vh - 6px);padding:20px">'
  ];

  const newStep1 = '<div id="step1" style="display:flex;flex-direction:column;min-height:100vh;padding:20px 20px 24px;box-sizing:border-box;justify-content:space-between">';

  for (const v of step1Variants) {
    if (content.includes(v)) {
      content = content.replace(v, newStep1);
      console.log('[FIX] signin.html :: step1 uses space-between flex layout');
      fileFixes++;
      break;
    }
  }

  // Reduce logo header margin (32px → 20px, no padding-top if min-height handles it)
  const oldHeader = '<div style="text-align:center;margin-bottom:32px;padding-top:24px">';
  const newHeader = '<div style="text-align:center;margin-bottom:20px">';
  if (content.includes(oldHeader)) {
    content = content.replace(oldHeader, newHeader);
    console.log('[FIX] signin.html :: tightened header spacing');
    fileFixes++;
  }

  // Button container should sit at the bottom of the flex space-between naturally
  // Remove any margin-top:auto (we don't need it with justify-content:space-between)
  if (content.includes('<div style="margin-top:auto">')) {
    content = content.split('<div style="margin-top:auto">').join('<div style="margin-top:24px">');
    console.log('[FIX] signin.html :: removed margin-top:auto');
    fileFixes++;
  }

  if (fileFixes > 0) {
    fs.writeFileSync(signinPath, content, 'utf8');
    const rootSignin = path.join(ROOT, 'signin.html');
    if (fs.existsSync(rootSignin)) fs.copyFileSync(signinPath, rootSignin);
  }
  totalFixes += fileFixes;
}

// ─── PART 3: Fix register.html layout ───────────────────────
const registerPath = path.join(ROOT, 'public', 'register.html');
if (fs.existsSync(registerPath)) {
  let content = fs.readFileSync(registerPath, 'utf8');
  let fileFixes = 0;

  // Update the .page-inner style to use space-between
  const oldPageInner1 = '.page-inner{display:flex;flex-direction:column;padding-bottom:32px;}';
  const oldPageInner2 = '.page-inner{display:flex;flex-direction:column;min-height:calc(100vh - 12px);}';
  const newPageInner = '.page-inner{display:flex;flex-direction:column;min-height:100vh;box-sizing:border-box;justify-content:space-between;}';

  if (content.includes(oldPageInner1)) {
    content = content.replace(oldPageInner1, newPageInner);
    console.log('[FIX] register.html :: .page-inner uses space-between');
    fileFixes++;
  } else if (content.includes(oldPageInner2)) {
    content = content.replace(oldPageInner2, newPageInner);
    console.log('[FIX] register.html :: .page-inner uses space-between (from original)');
    fileFixes++;
  }

  // Tighten header margin on register too
  const oldRegHeader = '<div style="margin-bottom:18px">';
  const newRegHeader = '<div style="margin-bottom:16px">';
  if (content.includes(oldRegHeader)) {
    content = content.replace(oldRegHeader, newRegHeader);
    console.log('[FIX] register.html :: tightened header margin');
    fileFixes++;
  }

  if (fileFixes > 0) {
    fs.writeFileSync(registerPath, content, 'utf8');
    const rootReg = path.join(ROOT, 'register.html');
    if (fs.existsSync(rootReg)) fs.copyFileSync(registerPath, rootReg);
  }
  totalFixes += fileFixes;
}

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Auth pages: hide chatbot + use space-between flex layout"');
console.log('  git push');
