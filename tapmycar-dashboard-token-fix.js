// ═══════════════════════════════════════════════════════════════
// TapMyCar — dashboard token display fix
// ═══════════════════════════════════════════════════════════════
// Problem: dashboard.html shows "TMC5GUKD5" (no hyphen) for the
// tag token and tag URL, while settings.html shows "TMC-5GUKD5"
// (with hyphen) correctly.
//
// Fix: Apply the SAME normalization logic that settings.html uses
//      (line 203) inside dashboard.html — if the token lacks a
//      hyphen, add one. This makes the display consistent across
//      both pages regardless of what's actually in the DB or how
//      the token gets transformed somewhere upstream.
//
// Run from project root:  node tapmycar-dashboard-token-fix.js
//
// Touches only public/dashboard.html. Idempotent (safe to re-run).
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const TARGET = path.join(PUBLIC, 'dashboard.html');

if (!fs.existsSync(TARGET)) {
  console.error('ERROR: public/dashboard.html not found.');
  process.exit(1);
}

// ─── BACKUP ──────────────────────────────────────────────────
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-dashboard-token-' + stamp);
fs.mkdirSync(BACKUP, { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP, 'dashboard.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));

// ─── PATCH dashboard.html ────────────────────────────────────
let html = fs.readFileSync(TARGET, 'utf8');

if (html.indexOf('formatTagToken') !== -1) {
  console.log('  Already patched — no changes made');
} else {
  // OLD code block in dashboard.html (~lines 330-337):
  //
  //     const tok = tag.token; // DB token already in TMC-XXXXXX format
  //     tagURL = `https://tapmycar.io/tag/${tok}`;
  //     const displayToken = tag.token; // DB token already in TMC-XXXXXX format
  //
  //     document.getElementById('vehicle-label').textContent = tag.vehicle_label || 'My Vehicle';
  //     document.getElementById('tag-token').textContent = displayToken;
  //     document.getElementById('tag-url').textContent = tagURL;
  //     document.getElementById('hero-sub').textContent = `${displayToken} | Scanned ${data.scanCount} times`;
  //
  // NEW code: normalize the token to ALWAYS have a hyphen, just like
  // settings.html does on its line 203.

  const oldBlock = `      const tok = tag.token; // DB token already in TMC-XXXXXX format
      tagURL = \`https://tapmycar.io/tag/\${tok}\`;
      const displayToken = tag.token; // DB token already in TMC-XXXXXX format`;

  const newBlock = `      // Normalize token to TMC-XXXXXX format (in case DB has it without hyphen)
      function formatTagToken(t) {
        if (!t) return '';
        return t.includes('-') ? t : ('TMC-' + t.replace(/^TMC[-.]?/, ''));
      }
      const tok = formatTagToken(tag.token);
      tagURL = \`https://tapmycar.io/tag/\${tok}\`;
      const displayToken = tok;`;

  if (html.indexOf(oldBlock) === -1) {
    // Try a more lenient regex match in case line endings or whitespace differ
    const fallbackRegex = /const tok = tag\.token; \/\/ DB token already in TMC-XXXXXX format\s*\r?\n\s*tagURL = `https:\/\/tapmycar\.io\/tag\/\$\{tok\}`;\s*\r?\n\s*const displayToken = tag\.token; \/\/ DB token already in TMC-XXXXXX format/;
    if (fallbackRegex.test(html)) {
      html = html.replace(fallbackRegex, newBlock);
      fs.writeFileSync(TARGET, html, 'utf8');
      console.log('  Patched dashboard.html (fallback regex)');
    } else {
      console.error('  ERROR: Could not find the token-display block to patch.');
      console.error('  Look in dashboard.html around line 330 for:');
      console.error('    const tok = tag.token; // DB token already in TMC-XXXXXX format');
      console.error('  Your file may have been modified differently.');
      process.exit(1);
    }
  } else {
    html = html.replace(oldBlock, newBlock);
    fs.writeFileSync(TARGET, html, 'utf8');
    console.log('  Patched dashboard.html (exact match)');
  }
}

console.log('\n═══════════════════════════════════════════════');
console.log('  DASHBOARD TOKEN FIX COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('What changed:');
console.log('  ✓ dashboard.html now normalizes tag.token before display');
console.log('  ✓ If token has hyphen → use as-is (e.g. "TMC-5GUKD5")');
console.log('  ✓ If token missing hyphen → add one (e.g. "TMC5GUKD5"');
console.log('    becomes "TMC-5GUKD5" automatically)');
console.log('  ✓ Same logic settings.html already uses');
console.log('  ✓ Affects: tag-token display, tag-url display, hero-sub');
console.log('    text, QR code URL — all stay consistent');
console.log('');
console.log('Test: hard-refresh public/dashboard.html (Ctrl+Shift+R)');
console.log('You should now see "TMC-5GUKD5" everywhere.');
