// ============================================================================
// TapMyCar - Patch 16: Admin dashboard color visibility fix
//
// Problem: even after Patch 15 brightened the labels and added autofill
// override, your screenshot shows:
//   - Form inputs render with WHITE background (should be dark)
//   - "How many?", "Batch #" labels still look almost invisible
//   - Placeholder text "e.g. 1", "e.g. 5" barely visible against white
//
// Root cause: Chrome on Windows applies its native LIGHT form theme to
// <input type="number"> elements unless the page declares
// `color-scheme: dark`. The CSS in admin.html sets dark backgrounds via
// .gen-input { background: var(--bg-elev) }, but Chrome's UA stylesheet
// for number inputs has higher specificity and wins.
//
// Fix:
//   1. Set `color-scheme: dark` at the :root level. This tells the
//      browser "use dark theme for all form widgets on this page".
//      Affects every <input>, <select>, <textarea>, scrollbar, etc.
//   2. Add `!important` overrides on .gen-input background/color to
//      guarantee they apply even against UA defaults.
//   3. Brighten the placeholder color to be readable on dark.
//   4. Brighten labels further (--text-2 was still too dim in practice).
//
// Affects: only admin.html visuals. No backend, no other pages.
//
// REQUIRES: Patches 1-15 already applied locally.
//
// Properties:
//   - Idempotent
//   - Backups admin.html to backup-patch16-{timestamp}/
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch16-admin-colors.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch16-admin-colors.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch16-admin-colors.js
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch16-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 16 \u2014 Admin dashboard color visibility fix');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_16 = 'TMC_PATCH16_ADMIN_COLORS';

// ===========================================================================
// admin.html — force dark form theme + brighten labels
// ===========================================================================

{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  if (content.includes(MARKER_16)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // ── Step 1: Add color-scheme:dark at :root
    // The :root block defines CSS custom properties starting around line 24.
    // We add color-scheme just inside it.
    const oldRoot = `:root {
  --bg: #070A17;`;
    const newRoot = `:root {
  /* ${MARKER_16}: force dark theme on form widgets (number inputs, scrollbars, etc.) */
  color-scheme: dark;
  --bg: #070A17;`;

    let r = tryReplace(updated, oldRoot, newRoot);
    if (!r) errExit('admin.html: :root block not found');
    updated = r;

    // ── Step 2: Replace .gen-input rule with !important overrides
    // We need the background/color to win against UA styles for type=number.
    const oldGenInput = `.gen-input {
  height: 44px;
  border: 1.5px solid var(--border);
  border-radius: var(--r);
  padding: 0 14px;
  font-size: 14px;
  background: var(--bg-elev);
  color: var(--text);
  outline: none;
  transition: all .15s;
  width: 100%;
}`;

    const newGenInput = `.gen-input {
  height: 44px;
  border: 1.5px solid var(--border);
  border-radius: var(--r);
  padding: 0 14px;
  font-size: 14px;
  background-color: var(--bg-elev) !important; /* ${MARKER_16}: beat Chrome UA */
  color: var(--text) !important;
  outline: none;
  transition: all .15s;
  width: 100%;
  color-scheme: dark; /* per-element fallback */
}`;

    r = tryReplace(updated, oldGenInput, newGenInput);
    if (!r) errExit('admin.html: .gen-input rule not found');
    updated = r;

    // ── Step 3: Brighten placeholder
    const oldPlaceholder = `.gen-input::placeholder { color: var(--text-4); }`;
    const newPlaceholder = `.gen-input::placeholder { color: var(--text-3) !important; opacity: 1; } /* ${MARKER_16} */`;

    r = tryReplace(updated, oldPlaceholder, newPlaceholder);
    if (!r) errExit('admin.html: placeholder rule not found');
    updated = r;

    // ── Step 4: Brighten labels further. Patch 15 set them to --text-2
    // (#D8DCE6). Looking at the screenshot, even that's reading as dark.
    // The cause: the labels live inside .gen-box / .repl-box / .danger-box
    // which set their own background gradients. We override at higher
    // specificity.
    const oldFieldLabel = `.field-label { font-size: 12px; color: var(--text-2); font-weight: 600; } /* TMC_PATCH15_VERIFY_GATE */`;
    const newFieldLabel = `.field-label { font-size: 12px; color: #E5E7EB !important; font-weight: 700; margin-bottom: 6px; display: block; } /* ${MARKER_16}: explicit bright */`;

    // Fall back to original Patch 15-less variant if needed.
    r = tryReplace(updated, oldFieldLabel, newFieldLabel);
    if (!r) {
      const oldOriginal = `.field-label { font-size: 12px; color: var(--text-3); font-weight: 600; }`;
      r = tryReplace(updated, oldOriginal, newFieldLabel);
    }
    if (!r) errExit('admin.html: .field-label rule not found');
    updated = r;

    // ── Step 5: Override Chrome's UA on number inputs spinners
    // Number inputs have a tiny spin button that's hard to style. We
    // hide it (since the inputs already validate via min/max attributes
    // and most users prefer typing). This also removes the visual
    // discrepancy where the spinner shows as a light element.
    //
    // Insert these rules just after the placeholder rule we already edited.
    const styleInsertAnchor = newPlaceholder; // we just inserted this
    const styleAddition = newPlaceholder + `
/* ${MARKER_16}: hide number-input spinners for cleaner dark UI */
.gen-input[type="number"]::-webkit-outer-spin-button,
.gen-input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.gen-input[type="number"] { -moz-appearance: textfield; }
/* ${MARKER_16}: ensure label visibility inside nested boxes */
.gen-box .field-label,
.repl-box .field-label,
.danger-box .field-label,
.verify-box .field-label {
  color: #E5E7EB !important;
  text-shadow: 0 1px 0 rgba(0,0,0,.25);
}`;

    r = tryReplace(updated, styleInsertAnchor, styleAddition);
    // The above replaces the placeholder rule with itself + additions.
    // Should always succeed since we just inserted it.
    if (!r) {
      // We need to find it after the previous replace. Skip the check
      // since it MUST succeed if the prior replace worked.
      log('  ! style addition anchor not found post-replace — non-fatal');
    } else {
      updated = r;
    }

    writeFile(file, updated);
    ok('admin.html: color-scheme:dark + !important overrides + brighter labels');
  }
}

log('');
log('==============================================================');
log('Patch 16 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 16: admin dashboard color visibility fix"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test:');
log('  Open https://tapmycar.io/admin.html in fresh incognito.');
log('  - "How many?", "Batch #", "How many failed?", "Original batch #",');
log('    and all other labels should be clearly readable bright gray.');
log('  - Number inputs should have DARK BACKGROUNDS (not white).');
log('  - Placeholder text "e.g. 1", "e.g. 5" should be visible.');
log('  - Number input spinner arrows are removed (cleaner look).');
log('  - The orange Generate / Create replacements buttons unchanged.');
log('');
log('If colors STILL look wrong after deploy:');
log('  - Hard refresh (Ctrl+Shift+R) to bypass service worker cache.');
log('  - Try in a different browser to rule out Chrome extension theming.');
log('==============================================================');
