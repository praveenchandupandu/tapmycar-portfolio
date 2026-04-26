// ════════════════════════════════════════════════════════════════
// FIX: admin.html scanToken — strict full-token matching
//
// Only accept tokens in the exact 'TMC-XXXXXX' format
// (case-insensitive). Partial inputs like 'EL6TYH' should NOT
// match — too risky for accidental matches across batches.
//
// Also still strip the URL prefix (https://tapmycar.io/tag/TMC-XXX)
// since QR scanners output the full URL.
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'admin.html');
if (!fs.existsSync(filePath)) {
  console.error('public/admin.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

// We need to find the entire scanToken function's input cleanup + matching block
// and replace with stricter logic.
// 
// Old (broken) lines:
//   token = token.replace(/^HTTPS?:\/\/TAPMYCAR\.IO\/TAG\//i, '');
//   token = token.replace(/^TMC[-.]?/i, '');     ← strips prefix (BAD - allows partials)
//   ...
//   const found = batchTokens.find(t => {
//     const clean = t.token.replace(/^TMC/i, '');
//     return t.token.toUpperCase() === token || clean.toUpperCase() === token || t.token.toUpperCase() === 'TMC' + token;
//   });

const oldBlock = `  // Clean  remove URL prefix, TMC- prefix, TMC. prefix
  token = token.replace(/^HTTPS?:\\/\\/TAPMYCAR\\.IO\\/TAG\\//i, '');
  token = token.replace(/^TMC[-.]?/i, '');

  if (!currentVerifyBatch) { showToast('Select a batch first'); return; }

  const batchTokens = batchTokensMap[currentVerifyBatch] || [];
  const found = batchTokens.find(t => {
    const clean = t.token.replace(/^TMC/i, '');
    return t.token.toUpperCase() === token || clean.toUpperCase() === token || t.token.toUpperCase() === 'TMC' + token;
  });`;

const newBlock = `  // Strip URL prefix only (e.g. https://tapmycar.io/tag/TMC-XXXXXX -> TMC-XXXXXX)
  // We do NOT strip the TMC- prefix because we require full token match for safety.
  token = token.replace(/^HTTPS?:\\/\\/TAPMYCAR\\.IO\\/TAG\\//i, '');

  // Validate: must be in exact TMC-XXXXXX format
  if (!/^TMC-[A-Z0-9]+$/.test(token)) {
    showToast('Invalid format. Token must be like TMC-XXXXXX');
    input.value = ''; input.focus(); return;
  }

  if (!currentVerifyBatch) { showToast('Select a batch first'); return; }

  const batchTokens = batchTokensMap[currentVerifyBatch] || [];
  // Strict match: full token equality (case-insensitive)
  const found = batchTokens.find(t => t.token.toUpperCase() === token);`;

if (content.indexOf(newBlock) !== -1) {
  console.log('[OK] admin.html scanToken already has strict matching');
  process.exit(0);
}

if (content.indexOf(oldBlock) === -1) {
  console.error('[ERROR] Could not find old scanToken block');
  console.error('It may have already been partially patched. Looking for individual lines...');
  
  // Try a more flexible match
  const partialOld = /token = token\.replace\(\/\^TMC\[-\.\]\?\/i, ''\);/;
  if (partialOld.test(content)) {
    console.error('Found old partial-strip line. The full block must have changed slightly.');
    console.error('Run this in PowerShell to see the current scanToken:');
    console.error('  Select-String -Path "public\\admin.html" -Pattern "function scanToken" -Context 0,30');
  }
  process.exit(1);
}

content = content.replace(oldBlock, newBlock);

fs.writeFileSync(filePath, content, 'utf8');
const rootCopy = path.join(ROOT, 'admin.html');
if (fs.existsSync(rootCopy)) {
  fs.copyFileSync(filePath, rootCopy);
}

console.log('[FIX] admin.html scanToken now requires exact TMC-XXXXXX format');
console.log('[SYNC] public/admin.html -> admin.html');
console.log('');
console.log('Behavior changes:');
console.log('  TMC-EL6TYH               -> matches if in batch');
console.log('  https://.../tag/TMC-XXX  -> matches (URL prefix stripped)');
console.log('  EL6TYH (no prefix)       -> rejected: "Invalid format"');
console.log('  TMC.EL6TYH (legacy dot)  -> rejected: "Invalid format"');
console.log('');
console.log('Commit and push:');
console.log('  git diff public/admin.html');
console.log('  git add -A');
console.log('  git commit -m "Admin scan: strict TMC-XXXXXX format match only"');
console.log('  git push');
