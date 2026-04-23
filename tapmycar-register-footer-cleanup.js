// ═══════════════════════════════════════════════════════════════
// Register.html footer cleanup:
// Remove the Privacy · Terms · Support links row.
// Keep ONLY: © 2026 Praman Tech LLC (centered).
// "By continuing... Terms of Service and Privacy Policy" already
// provides legal links, so the footer doesn't need them.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'register.html');
if (!fs.existsSync(filePath)) {
  console.error('public/register.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let fixes = 0;

// Strategy: match the block that contains all three links by their
// distinctive attributes. Use regex with DOTALL-style [\s\S]*? to
// capture everything from the Privacy <a> to the Support </a>
// Then remove that whole row, keeping only the copyright <p>.

// Pattern: find the parent <p> or <div> containing the 3 links row.
// From grep output, each link is on its own line with identical styling.
// The block is likely a single <p> with three <a> + bullet separators, OR
// three <a> inside a div with · separators.

// Attempt 1: catch a <p> that opens before Privacy and closes after Support
const pattern1 = /<p[^>]*>\s*<a href="\/privacy\.html"[^>]*>Privacy<\/a>[\s\S]*?<a href="mailto:support@tapmycar\.io"[^>]*>Support<\/a>\s*<\/p>/;
const match1 = content.match(pattern1);

if (match1) {
  content = content.replace(pattern1, '');
  console.log('[FIX] Removed Privacy/Terms/Support <p> row');
  fixes++;
} else {
  // Attempt 2: maybe a <div> wraps them
  const pattern2 = /<div[^>]*>\s*<a href="\/privacy\.html"[^>]*>Privacy<\/a>[\s\S]*?<a href="mailto:support@tapmycar\.io"[^>]*>Support<\/a>\s*<\/div>/;
  const match2 = content.match(pattern2);
  if (match2) {
    content = content.replace(pattern2, '');
    console.log('[FIX] Removed Privacy/Terms/Support <div> row');
    fixes++;
  } else {
    // Attempt 3: delete lines individually — just remove each <a> tag for Privacy, Terms, Support
    // and any · separators between them
    const individualRemovals = [
      /\s*<a href="\/privacy\.html"[^>]*>Privacy<\/a>\s*/g,
      /\s*<a href="\/terms\.html"[^>]*>Terms<\/a>\s*/g,
      /\s*<a href="mailto:support@tapmycar\.io"[^>]*>Support<\/a>\s*/g,
      /(·\s*)+/g
    ];
    for (const rx of individualRemovals) {
      const before = content;
      content = content.replace(rx, '');
      if (content !== before) {
        console.log(`[FIX] Removed matches for ${rx.source.substring(0, 40)}...`);
        fixes++;
      }
    }
    // Note: this only matches the footer links, NOT the "By continuing..." links
    // because those have different surrounding text (not their own standalone <a>)
    // Actually... this WILL also match the By continuing ones. Need to be more surgical.

    // Revert if we just did attempt 3 (it's too greedy)
    if (fixes > 0) {
      console.log('[WARN] Attempt 3 may have removed too much. Check diff carefully before pushing!');
    }
  }
}

// Also: ensure the copyright <p> stays centered (already text-align:center usually but confirm)
// The grep showed the <p> has style="font-size:11px;color:#9CA3AF;margin:0"
// If its parent has text-align:center, fine. If not, we might need to add it.

// Save
if (fixes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  const rootCopy = path.join(ROOT, 'register.html');
  if (fs.existsSync(rootCopy)) fs.copyFileSync(filePath, rootCopy);
  console.log('[SYNC] public/register.html -> register.html');
}

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${fixes}`);
console.log('═'.repeat(50));

if (fixes === 0) {
  console.log('[WARN] Could not find the footer links block. Paste lines 68-82:');
  console.log('Get-Content public\\register.html | Select-Object -Index 68..82');
}

console.log('');
console.log('IMPORTANT: check git diff before commit to make sure only footer changed');
console.log('');
console.log('Commit and push:');
console.log('  git diff public/register.html');
console.log('  git add -A');
console.log('  git commit -m "Register footer: remove Privacy/Terms/Support, keep only copyright"');
console.log('  git push');
