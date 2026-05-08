// ============================================================================
// TapMyCar — Patch 6 of 7: Phone change resets verification
//
// Concept: if a user (or admin) changes the phone number on a user account,
// reset users.phone_verified=false. Otherwise the verification gate is
// bypassable via "register, verify, change phone to victim's number".
//
// REQUIRES: Patches 4 + 5 already applied locally. Don't push to git yet.
//
// What this patch does:
//   6.1  In api/get-dashboard.js:
//        a) Regular user self-update branch (line ~89): if req.body.phone
//           is provided AND differs from current users.phone, set
//           phone_verified=false and phone_verified_at=null.
//        b) Admin update_user branch (line ~34): same logic — if admin
//           changes phone, verification resets.
//
//   This is a small, surgical patch. One file touched.
//
// Properties:
//   - Idempotent (re-running is a no-op)
//   - Backups to backup-patch6-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch6-phone-change-reset.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch6-phone-change-reset.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch6-phone-change-reset.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch6-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const err = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) err('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
  } catch (e) {
    err('JS syntax error in ' + p + '\n' + e.stderr.toString());
  }
}

log('');
log('TapMyCar Patch 6 \u2014 Phone change resets verification');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_6 = 'TMC_PATCH6_PHONE_RESET';

// ===========================================================================
// 6.1  get-dashboard.js — phone change resets verification
// ===========================================================================

log('6.1  get-dashboard.js: detect phone change and reset phone_verified');

{
  const file = path.join(API, 'get-dashboard.js');
  const content = readFile(file);

  if (content.includes(MARKER_6)) {
    skip('get-dashboard.js (already has phone-reset logic)');
  } else {
    backup(file);
    let updated = content;

    // ──────────────────────────────────────────────────────────────────
    // Branch A: ADMIN update_user (line ~34)
    // Original block is short and clean — replace it with the new logic.
    // ──────────────────────────────────────────────────────────────────
    const adminOld = `      if (action === 'update_user' && user_id) {
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (phone !== undefined) updates.phone = phone;
        if (plan !== undefined) updates.plan = plan;

        const { error } = await supabase
          .from('users')
          .update(updates)
          .eq('id', user_id);

        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
      }`;

    const adminNew = `      if (action === 'update_user' && user_id) {
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (plan !== undefined) updates.plan = plan;

        // ${MARKER_6}
        // If admin changes the phone number, reset phone_verified so the
        // user must re-verify via SMS before activating new tags. The
        // verification gate enforces this; without reset, a phone change
        // would silently bypass it.
        if (phone !== undefined) {
          updates.phone = phone;
          // Look up current phone to detect actual change
          const { data: existing } = await supabase
            .from('users')
            .select('phone, phone_verified')
            .eq('id', user_id)
            .maybeSingle();
          if (existing && existing.phone !== phone) {
            updates.phone_verified = false;
            updates.phone_verified_at = null;
          }
        }

        const { error } = await supabase
          .from('users')
          .update(updates)
          .eq('id', user_id);

        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
      }`;

    if (updated.includes(adminOld)) {
      updated = updated.replace(adminOld, adminNew);
    } else {
      // Try CRLF variant
      const adminOldCRLF = adminOld.replace(/\n/g, '\r\n');
      const adminNewCRLF = adminNew.replace(/\n/g, '\r\n');
      if (updated.includes(adminOldCRLF)) {
        updated = updated.replace(adminOldCRLF, adminNewCRLF);
      } else {
        warn('Admin update_user block: anchor not found, skipping admin branch');
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // Branch B: Regular user self-update (line ~89)
    // Replace `if (phone) updates.phone = phone;` with phone-change detection.
    // ──────────────────────────────────────────────────────────────────
    const userOld = `      if (phone) updates.phone = phone;`;
    const userNew = `      // ${MARKER_6}
      // If user changes their phone, reset phone_verified so they must
      // re-verify via SMS before next activation. The activation gate
      // enforces this on next attempt.
      if (phone) {
        updates.phone = phone;
        const { data: existing } = await supabase
          .from('users')
          .select('phone')
          .eq('id', user_id)
          .maybeSingle();
        if (existing && existing.phone !== phone) {
          updates.phone_verified = false;
          updates.phone_verified_at = null;
        }
      }`;

    if (updated.includes(userOld)) {
      updated = updated.replace(userOld, userNew);
    } else {
      // Try CRLF variant
      const userOldCRLF = userOld.replace(/\n/g, '\r\n');
      const userNewCRLF = userNew.replace(/\n/g, '\r\n');
      if (updated.includes(userOldCRLF)) {
        updated = updated.replace(userOldCRLF, userNewCRLF);
      } else {
        warn('User self-update block: anchor not found, skipping user branch');
      }
    }

    if (updated === content) {
      err('get-dashboard.js: NO changes applied (both anchors missed)');
    }

    writeFile(file, updated);
    validateJs(file);
    ok('get-dashboard.js: phone change in either path now resets phone_verified');
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 6 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('REMINDER: Do NOT git push yet. Patch 7 next, then push all together.');
log('==============================================================');
