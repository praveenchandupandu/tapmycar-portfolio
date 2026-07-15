const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch111-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH111 - Fix remaining hardcoded signin redirects (billing, dashboard, renew, settings) ===');
console.log('These pages each have their OWN independent auth check that does not go through');
console.log('requireAuth() (fixed in patch110), so they had the same email-dropping bug on their own.');

const targets = [
  {
    file: path.join('public', 'billing.html'),
    old: "if (!s || !s.token) { window.location.href = '/signin.html'; }",
    new: "if (!s || !s.token) { window.location.href = '/signin.html' + window.location.search; }"
  },
  {
    file: path.join('public', 'dashboard.html'),
    old: "if (!token) { window.location.href = '/signin.html'; return; }",
    new: "if (!token) { window.location.href = '/signin.html' + window.location.search; return; }",
    allOccurrences: true
  },
  {
    file: path.join('public', 'renew.html'),
    old: "if (!token) { window.location.href = '/signin.html'; return; }",
    new: "if (!token) { window.location.href = '/signin.html' + window.location.search; return; }"
  },
  {
    file: path.join('public', 'settings.html'),
    old: "if (!s || !s.token) { window.location.href = '/signin.html'; return; }",
    new: "if (!s || !s.token) { window.location.href = '/signin.html' + window.location.search; return; }",
    allOccurrences: true
  }
];

let anyChanged = false;

try {
  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      console.log('\n  ' + t.file + ' not found - skipped');
      continue;
    }

    let content = fs.readFileSync(t.file, 'utf8');
    const original = content;

    if (content.indexOf(t.new) !== -1 && content.indexOf(t.old) === -1) {
      console.log('\n  ' + t.file + ': already fixed');
      continue;
    }

    if (content.indexOf(t.old) === -1) {
      console.log('\n  WARNING: ' + t.file + ': expected pattern not found - check manually');
      continue;
    }

    if (t.allOccurrences) {
      content = content.split(t.old).join(t.new);
    } else {
      content = content.replace(t.old, t.new);
    }

    if (content !== original) {
      backup(t.file);
      fs.writeFileSync(t.file, content, 'utf8');
      const count = (original.split(t.old).length - 1);
      console.log('\n  ' + t.file + ': fixed (' + count + ' occurrence' + (count > 1 ? 's' : '') + ')');
      anyChanged = true;
    }
  }

  console.log('\n=== TMC_PATCH111 complete ===');
  if (anyChanged) {
    console.log('\nNext steps:');
    console.log('  1. git add -A && git commit -m "TMC_PATCH111: Preserve query string on remaining signin redirects"');
    console.log('  2. git push  (website-only fix, no Codemagic rebuild needed, live on Vercel in ~60s)\n');
  } else {
    console.log('\nNo changes were needed.\n');
  }

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
