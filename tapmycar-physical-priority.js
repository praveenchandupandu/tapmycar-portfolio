// ═══════════════════════════════════════════════════════════════
// TapMyCar — physical tag takes priority over eTag
// ═══════════════════════════════════════════════════════════════
// What this fixes:
//
//   1. DASHBOARD shows the WRONG tag.
//      Currently: data.tags[0] — just the first row from the DB.
//      Result: after physical activation, dashboard often still
//      shows the eTag (TMC-ETxxxxxx) instead of the physical
//      sticker (TMC-xxxxxx).
//
//      FIX: pick the best tag in this order:
//        (a) Active physical tag (token does NOT start with TMC-ET)
//        (b) Active eTag (only if no active physical exists)
//        (c) Any other tag (fallback for paused/inactive states)
//
//   2. STRANGER scans an old eTag URL but the user has activated
//      a physical sticker — should see "this tag is no longer
//      active" instead of the contact page.
//
//      FIX: get-tag.js now ALSO auto-deactivates the eTag at READ
//      time if it detects the same user has an active physical tag.
//      This is a defense in depth — even if the activation flow's
//      POST handler missed deactivating, the next read fixes it.
//
//      Also: contact.html now shows the "disabled" screen for
//      status='inactive' (previously it fell through to "invalid").
//
// Run from project root:  node tapmycar-physical-priority.js
//
// Touches: api/get-tag.js, public/dashboard.html, public/contact.html
// Idempotent — safe to re-run.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const TARGETS = [
  path.join(PUBLIC, 'dashboard.html'),
  path.join(PUBLIC, 'contact.html'),
  path.join(API, 'get-tag.js')
];

for (const t of TARGETS) {
  if (!fs.existsSync(t)) {
    console.error('ERROR: ' + t + ' not found.');
    process.exit(1);
  }
}

// ─── BACKUP ──────────────────────────────────────────────────
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-physical-priority-' + stamp);
fs.mkdirSync(path.join(BACKUP, 'public'), { recursive: true });
fs.mkdirSync(path.join(BACKUP, 'api'), { recursive: true });
fs.copyFileSync(path.join(PUBLIC, 'dashboard.html'), path.join(BACKUP, 'public', 'dashboard.html'));
fs.copyFileSync(path.join(PUBLIC, 'contact.html'), path.join(BACKUP, 'public', 'contact.html'));
fs.copyFileSync(path.join(API, 'get-tag.js'), path.join(BACKUP, 'api', 'get-tag.js'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));

// ════════════════════════════════════════════════════════════
// FIX #1 — DASHBOARD: prefer physical over eTag
// ════════════════════════════════════════════════════════════
{
  const fp = path.join(PUBLIC, 'dashboard.html');
  let html = fs.readFileSync(fp, 'utf8');

  if (html.indexOf('TMC_PICK_BEST_TAG') !== -1) {
    console.log('  dashboard.html: already patched, skipping');
  } else {
    const oldRegex = /if \(data\.tags && data\.tags\.length > 0\) \{\r?\n\s*const tag = data\.tags\[0\];/;

    const newBlock = `if (data.tags && data.tags.length > 0) {
      // TMC_PICK_BEST_TAG: prefer active physical sticker over eTag.
      // Token rule: physical = token does NOT start with "TMC-ET",
      //             eTag     = token starts with "TMC-ET".
      // Sort priority: active physical > active eTag > other.
      function isPhysical(t) {
        return t && t.token && !t.token.toUpperCase().startsWith('TMC-ET');
      }
      function tagScore(t) {
        const active = (t.status === 'active') ? 2 : (t.status === 'paused' ? 1 : 0);
        const physical = isPhysical(t) ? 4 : 0;
        return active + physical;
      }
      const sortedTags = [...data.tags].sort((a, b) => tagScore(b) - tagScore(a));
      const tag = sortedTags[0];`;

    if (!oldRegex.test(html)) {
      console.error('  ERROR: dashboard.html — could not find tag-selection block.');
      console.error('  Look around line 319 for: if (data.tags && data.tags.length > 0)');
      process.exit(1);
    }

    html = html.replace(oldRegex, newBlock);
    fs.writeFileSync(fp, html, 'utf8');
    console.log('  dashboard.html: patched (prefers active physical sticker)');
  }
}

// ════════════════════════════════════════════════════════════
// FIX #2 — CONTACT.HTML: treat 'inactive' status as disabled
// ════════════════════════════════════════════════════════════
{
  const fp = path.join(PUBLIC, 'contact.html');
  let html = fs.readFileSync(fp, 'utf8');

  if (html.indexOf("tag.status==='inactive'") !== -1) {
    console.log('  contact.html: already patched, skipping');
  } else {
    const oldLine = `    if(tag.status==='disabled'){showState('disabled');}`;
    const newLine = `    if(tag.status==='disabled'||tag.status==='inactive'){showState('disabled');}`;

    if (html.indexOf(oldLine) === -1) {
      console.error('  ERROR: contact.html — could not find status check line.');
      process.exit(1);
    }

    html = html.replace(oldLine, newLine);
    fs.writeFileSync(fp, html, 'utf8');
    console.log('  contact.html: patched (treats inactive same as disabled)');
  }
}

// ════════════════════════════════════════════════════════════
// FIX #3 — GET-TAG.JS: auto-deactivate eTag on read if owner
//          has an active physical tag (defense in depth)
// ════════════════════════════════════════════════════════════
{
  const fp = path.join(API, 'get-tag.js');
  let js = fs.readFileSync(fp, 'utf8');

  if (js.indexOf('TMC_AUTO_DEACTIVATE_ON_READ') !== -1) {
    console.log('  api/get-tag.js: already patched, skipping');
  } else {
    const oldRegex = /(\.from\('tags'\)\r?\n\s*\.select\('\*, users\(name, phone, emergency_contact, emergency_name\)'\)\r?\n\s*\.eq\('token', cleanToken\)\r?\n\s*\.single\(\);\r?\n\r?\n\s*if \(error \|\| !tag\) \{\r?\n\s*return res\.status\(404\)\.json\(\{ error: 'Tag not found' \}\);\r?\n\s*\})/;

    const injection = `$1

    // TMC_AUTO_DEACTIVATE_ON_READ
    // If this tag is an eTag (token starts with TMC-ET) and the same
    // owner already has an active physical tag, mark this eTag inactive
    // and tell the stranger it's no longer active. Defense in depth.
    try {
      const tokenUpper = (tag.token || '').toUpperCase();
      const isEtag = tokenUpper.startsWith('TMC-ET') || tag.tag_type === 'etag';
      if (isEtag && tag.owner_id && tag.status === 'active') {
        const { data: physicalTags } = await supabase
          .from('tags')
          .select('token, status')
          .eq('owner_id', tag.owner_id)
          .eq('status', 'active')
          .neq('id', tag.id);
        const hasActivePhysical = physicalTags && physicalTags.some(t => {
          const tk = (t.token || '').toUpperCase();
          return !tk.startsWith('TMC-ET');
        });
        if (hasActivePhysical) {
          await supabase
            .from('tags')
            .update({ status: 'inactive' })
            .eq('id', tag.id);
          tag.status = 'inactive';
          console.log('Auto-deactivated eTag', tag.token, 'on read (owner has active physical)');
        }
      }
    } catch (autoDeactivateErr) {
      console.error('Auto-deactivate on read error (non-fatal):', autoDeactivateErr);
    }`;

    if (!oldRegex.test(js)) {
      console.error('  ERROR: api/get-tag.js — could not find tag-fetch block.');
      console.error('  Look for: .from tags / .eq token cleanToken / .single');
      process.exit(1);
    }

    js = js.replace(oldRegex, injection);
    fs.writeFileSync(fp, js, 'utf8');
    console.log('  api/get-tag.js: patched (auto-deactivates eTag on read)');
  }
}

console.log('\n═══════════════════════════════════════════════');
console.log('  PHYSICAL-TAG PRIORITY PATCH COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('What this does:');
console.log('  ✓ Dashboard now picks the BEST tag:');
console.log('      1st choice: active physical sticker (TMC-xxxxxx)');
console.log('      2nd choice: active eTag (TMC-ETxxxxx)');
console.log('      3rd choice: anything else (paused/etc.)');
console.log('  ✓ Stranger scanning an inactive-status tag now sees');
console.log('    the "disabled" screen instead of "invalid".');
console.log('  ✓ Defense in depth: get-tag.js auto-deactivates the');
console.log('    eTag on read if owner has an active physical tag.');
console.log('');
console.log('To FIX YOUR CURRENT DATA right now:');
console.log('  Open Supabase, go to tags table, find your eTag row');
console.log('  (token starts with TMC-ET), and update its status to');
console.log('  "inactive". OR just visit the eTag URL once after this');
console.log('  patch deploys — the auto-deactivate-on-read kicks in.');
