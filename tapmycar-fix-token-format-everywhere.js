// ════════════════════════════════════════════════════════════════
// COMPREHENSIVE TOKEN FORMAT FIX
//
// Problem: Many places in the codebase still convert tokens to/from
// the old TMC.XXXXXX (dot) or TMCXXXXXX (no dash) formats. The DB
// stores tokens as TMC-XXXXXX (with dash) — that's the format we
// should display and pass to the API everywhere.
//
// Files patched:
//   - activate.html  (already fixed if previous patch ran, idempotent here)
//   - manage.html    (display TMC.XXXXX -> just show tag.token)
//   - settings.html  (display TMC.XXXXX -> just show tag.token)
//   - dashboard.html (already handles dash correctly, no change needed)
//   - admin.html     (formatToken helper updated to passthrough)
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

let totalFixes = 0;

function patch(fileRel, rules) {
  const file = path.join(ROOT, fileRel);
  if (!fs.existsSync(file)) {
    console.log('[SKIP] ' + fileRel + ' not found');
    return;
  }
  let content = fs.readFileSync(file, 'utf8');
  let count = 0;

  for (const r of rules) {
    if (content.indexOf(r.find) !== -1) {
      content = content.split(r.find).join(r.replace);
      console.log('[FIX] ' + fileRel + ' :: ' + r.label);
      count++;
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

// ─── activate.html ─────────────────────────────────────────
patch('public/activate.html', [
  {
    label: 'placeholder text',
    find: 'placeholder="e.g. TMCGKFJXM"',
    replace: 'placeholder="e.g. TMC-XXXXXX"'
  },
  {
    label: 'default display TMC.XXXXXX -> TMC-XXXXXX',
    find: '<div class="result-tag" id="r-token">TMC.XXXXXX</div>',
    replace: '<div class="result-tag" id="r-token">TMC-XXXXXX</div>'
  },
  {
    label: 'manual entry handler — preserve dash + validate',
    find: "  // Clean token \u2014 remove TMC prefix and dots if user types TMC.XXXXX\n  const cleanToken = token.replace('TMC.','TMC').replace('TMC-','TMC');\n  processToken(cleanToken);",
    replace: "  // Strip URL prefix if pasted; require exact TMC-XXXXXX format\n  let cleanToken = token.replace(/^HTTPS?:\\/\\/TAPMYCAR\\.IO\\/TAG\\//i, '');\n  if (!/^TMC-[A-Z0-9]+$/.test(cleanToken)) {\n    showToast('Invalid format. Tag ID must be like TMC-XXXXXX');\n    return;\n  }\n  processToken(cleanToken);"
  },
  {
    label: 'r-token display — show tag.token directly',
    find: "  document.getElementById('r-token').textContent = 'TMC.' + token.replace('TMC','');",
    replace: "  document.getElementById('r-token').textContent = token;"
  }
]);

// ─── manage.html ────────────────────────────────────────────
patch('public/manage.html', [
  {
    label: 'tag display — show tag.token directly',
    find: "      document.getElementById('m-token').textContent = 'TMC.' + tag.token.replace('TMC','');",
    replace: "      document.getElementById('m-token').textContent = tag.token;"
  }
]);

// ─── settings.html ──────────────────────────────────────────
patch('public/settings.html', [
  {
    label: 'tag display — show tag.token directly',
    find: "      document.getElementById('tag-info').textContent = 'TMC.' + tagData.token.replace('TMC','') + ' - ' + (tagData.status || 'unknown');",
    replace: "      document.getElementById('tag-info').textContent = tagData.token + ' - ' + (tagData.status || 'unknown');"
  }
]);

// ─── admin.html ──────────────────────────────────────────────
// formatToken/rawToken helpers do conversion that's no longer needed
// (DB tokens already in TMC-XXXXXX format). Make them passthroughs.
patch('public/admin.html', [
  {
    label: 'formatToken helper — return token as-is',
    find: "function formatToken(token) {\n  if (!token) return '';\n  // Remove any existing TMC, TMC-, TMC. prefix to get raw 6 chars\n  let raw = token.replace(/^TMC[-.]?/i, '');\n  return 'TMC-' + raw;\n}",
    replace: "function formatToken(token) {\n  // DB stores tokens in canonical TMC-XXXXXX format already.\n  // Keep this helper for compatibility but just return as-is (uppercased).\n  if (!token) return '';\n  return String(token).toUpperCase();\n}"
  },
  {
    label: 'rawToken helper — return token as-is',
    find: "function rawToken(token) {\n  // Get the clean database token: TMCXXXXXX\n  if (!token) return '';\n  return 'TMC' + token.replace(/^TMC[-.]?/i, '');\n}",
    replace: "function rawToken(token) {\n  // DB tokens are already canonical TMC-XXXXXX. Return as-is.\n  if (!token) return '';\n  return String(token).toUpperCase();\n}"
  }
]);

// ─── dashboard.html ────────────────────────────────────────────
// Lines 243-245: ternary logic that handles both dash/no-dash. Tokens are 
// always with-dash now. Simplify to just use tag.token directly.
patch('public/dashboard.html', [
  {
    label: 'simplify token formatting (already includes dash)',
    find: '      const tok = tag.token.includes("-") ? tag.token : "TMC-" + tag.token.replace(/^TMC/i,"");',
    replace: '      const tok = tag.token; // DB token already in TMC-XXXXXX format'
  },
  {
    label: 'simplify display token (already includes dash)',
    find: "      const displayToken = tag.token.includes('-') ? tag.token : 'TMC-' + tag.token.replace(/^TMC/i,'');",
    replace: "      const displayToken = tag.token; // DB token already in TMC-XXXXXX format"
  }
]);

console.log('');
console.log('═'.repeat(50));
console.log('Total fixes: ' + totalFixes);
console.log('═'.repeat(50));

if (totalFixes === 0) {
  console.log('[INFO] No fixes needed - all token formats look clean.');
}

console.log('');
console.log('Commit and push:');
console.log('  git diff public/activate.html public/manage.html public/settings.html public/dashboard.html public/admin.html | Select-Object -First 200');
console.log('  git add -A');
console.log('  git commit -m "Standardize TMC-XXXXXX format across all pages (no more TMC. or TMC dot conversions)"');
console.log('  git push');
