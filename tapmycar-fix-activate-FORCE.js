// ════════════════════════════════════════════════════════════════
// FORCEFUL fix for activate.html token logic
// Uses regex patterns that work regardless of whitespace, em-dashes,
// or quote style differences. Targets the ACTUAL bugs:
//
// 1. cleanToken line that strips the dash (sends wrong format to API)
// 2. r-token display line that converts back to TMC.XXXXXX format
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'activate.html');
if (!fs.existsSync(filePath)) {
  console.error('public/activate.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let fixes = 0;

// ─── FIX 1: cleanToken line (the main bug) ──────────────
// Pattern: any whitespace tolerance + handle both single and double quotes
const cleanTokenPattern = /const cleanToken = token\.replace\(['"]TMC\.['"],\s*['"]TMC['"]\)\.replace\(['"]TMC-['"],\s*['"]TMC['"]\);[\r\n]+\s*processToken\(cleanToken\);/;

if (cleanTokenPattern.test(content)) {
  content = content.replace(cleanTokenPattern,
    `let cleanToken = token.replace(/^HTTPS?:\\/\\/TAPMYCAR\\.IO\\/TAG\\//i, '');\r\n  if (!/^TMC-[A-Z0-9]+$/.test(cleanToken)) {\r\n    showToast('Invalid format. Tag ID must be like TMC-XXXXXX');\r\n    return;\r\n  }\r\n  processToken(cleanToken);`);
  console.log('[FIX] activate.html :: cleanToken now preserves dash + validates format');
  fixes++;
}

// Even more flexible: just match the pattern we want to remove
const looserPattern = /const cleanToken\s*=\s*token\.replace\([^)]+\)\.replace\([^)]+\);/;
if (fixes === 0 && looserPattern.test(content)) {
  // Find the comment line above too
  const commentPattern = /\s*\/\/[^\n]*remove TMC prefix[^\n]*\n/;
  content = content.replace(commentPattern, '\n  ');
  content = content.replace(looserPattern,
    `let cleanToken = token.replace(/^HTTPS?:\\/\\/TAPMYCAR\\.IO\\/TAG\\//i, '');\n  if (!/^TMC-[A-Z0-9]+$/.test(cleanToken)) {\n    showToast('Invalid format. Tag ID must be like TMC-XXXXXX');\n    return;\n  }`);
  console.log('[FIX] activate.html :: cleanToken replaced (loose match)');
  fixes++;
}

// ─── FIX 2: r-token display line ────────────────────────
const rTokenPattern = /document\.getElementById\(['"]r-token['"]\)\.textContent\s*=\s*['"]TMC\.['"][^\n;]*\.replace\(['"]TMC['"][^)]*\);/;

if (rTokenPattern.test(content)) {
  content = content.replace(rTokenPattern,
    `document.getElementById('r-token').textContent = token;`);
  console.log('[FIX] activate.html :: r-token display shows token directly');
  fixes++;
}

// ─── FIX 3: default placeholder text in HTML ────────────
const oldDisplayDefault = '<div class="result-tag" id="r-token">TMC.XXXXXX</div>';
const newDisplayDefault = '<div class="result-tag" id="r-token">TMC-XXXXXX</div>';
if (content.indexOf(oldDisplayDefault) !== -1) {
  content = content.replace(oldDisplayDefault, newDisplayDefault);
  console.log('[FIX] activate.html :: default display text TMC.XXXXXX -> TMC-XXXXXX');
  fixes++;
}

// Save
if (fixes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  const rootCopy = path.join(ROOT, 'activate.html');
  if (fs.existsSync(rootCopy)) {
    fs.copyFileSync(filePath, rootCopy);
  }
  console.log('[SYNC] public/activate.html -> activate.html');
}

console.log('');
console.log('═'.repeat(50));
console.log('Total fixes: ' + fixes);
console.log('═'.repeat(50));

if (fixes === 0) {
  console.log('[WARN] No fixes applied. Show me current state with:');
  console.log('  Get-Content public\\activate.html | Select-Object -Index 240..265');
}
