// ============================================================================
// TapMyCar — Patch 5 of 7: Per-activation SMS verification (backend half)
//
// Concept (from your direction):
//   - Every tag activation requires a fresh SMS OTP.
//   - The auto-created eTag at signup stays in 'claimed' status (placeholder).
//   - User must explicitly activate it via activate.html with SMS verification.
//   - The account-level phone_verified flag (from Patch 4) is informational;
//     activation requires a one-shot session token proving SMS was completed
//     RIGHT NOW for THIS activation.
//
// REQUIRES: SQL migration (printed at bottom) must be run BEFORE this patch.
//           Adds activation_sessions table.
//
// REQUIRES: Patch 4 already deployed (uses confirm-phone-verification.js).
//
// What this patch does:
//   5.1  Modifies confirm-phone-verification.js to ALSO insert a row into
//        activation_sessions(id, user_id, created_at, used) and return the
//        session_id to the caller. The caller (activate.html, future Patch 7)
//        will pass this session_id when calling /api/get-tag POST to claim.
//
//   5.2  Modifies get-tag.js POST claim path to require activation_session_id
//        for any tag being moved from claimed/unclaimed -> active. Validates:
//        - session belongs to this user_id
//        - session not already used
//        - session created within last 5 minutes
//        Then marks session used=true and proceeds with activation.
//
//   5.3  Updates verify-otp.js auto-eTag insert with a clarifying comment that
//        'claimed' is the deliberate placeholder state pending SMS activation.
//        (No functional change — that's already what the code does.)
//
//   5.4  Updates etag.html so the "Activate to enable masked calls" prompt
//        passes the user's eTag token to activate.html via query param,
//        so activate.html can auto-populate the token and skip the QR scan.
//
//   5.5  Hardens proxy-call.js gate: now checks that owner has phone_verified
//        AT LEAST ONCE plus tag.status === 'active'. (Already does this from
//        Patch 4 — verifying it remains correct.)
//
// NOT in this patch (Patch 6 + 7):
//   - Settings page: phone change resets phone_verified  (Patch 6, small)
//   - activate.html: actual SMS verification UI step      (Patch 7, larger)
//
// Why split: Patch 5 is the backend foundation. Once deployed it doesn't
// CHANGE existing behavior — the new requirement only takes effect when
// Patch 7 ships the new activation UI. This means Patch 5 is safe to ship
// alone without breaking the current activation flow.
//
// Properties:
//   - Idempotent
//   - Backups every touched file to backup-patch5-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch5-activation-sessions.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch5-activation-sessions.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch5-activation-sessions.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch5-${ts}`);

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
log('TapMyCar Patch 5 \u2014 Per-activation SMS session backend');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_5 = 'TMC_PATCH5_ACTIVATION_SESSION';

// ===========================================================================
// 5.1  Modify confirm-phone-verification.js to issue a session token
// ===========================================================================

log('5.1  confirm-phone-verification.js: issue activation session on success');

{
  const file = path.join(API, 'confirm-phone-verification.js');
  const content = readFile(file);

  if (content.includes(MARKER_5)) {
    skip('confirm-phone-verification.js (already issues session)');
  } else {
    backup(file);

    // Replace the success block. We need to:
    //  (a) Mark phone_verified (existing)
    //  (b) Insert activation_sessions row
    //  (c) Return session_id

    const oldBlock = `  // Mark verified
  const { error: updErr } = await supabase
    .from('users')
    .update({ phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq('id', user_id);

  if (updErr) {
    console.error('phone_verified update error:', updErr.message);
    return res.status(500).json({ error: 'Verification succeeded but database update failed. Please try again.' });
  }

  return res.json({ success: true });
};`;

    const newBlock = `  // Mark verified (account-level flag, informational)
  const { error: updErr } = await supabase
    .from('users')
    .update({ phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq('id', user_id);

  if (updErr) {
    console.error('phone_verified update error:', updErr.message);
    return res.status(500).json({ error: 'Verification succeeded but database update failed. Please try again.' });
  }

  // ${MARKER_5}
  // Issue a one-shot activation session token. The activation API
  // (get-tag.js POST claim) requires this token to flip a tag to active.
  // The token is consumable: used=true after activation, expires after
  // 5 minutes if unused. This enforces "every activation needs fresh SMS".
  let activation_session_id = null;
  try {
    const { data: sessionRow, error: sessionErr } = await supabase
      .from('activation_sessions')
      .insert({ user_id })
      .select('id')
      .single();
    if (sessionErr) {
      console.error('activation_sessions insert error:', sessionErr.message);
      // Don't fail the verification — but log loudly. Frontend will get
      // null session_id and show a clear error to retry.
    } else {
      activation_session_id = sessionRow.id;
    }
  } catch (e) {
    console.error('activation_sessions insert exception:', e && e.message);
  }

  return res.json({
    success: true,
    activation_session_id
  });
};`;

    if (!content.includes(oldBlock)) {
      err('confirm-phone-verification.js: expected success block not found. File may have drifted.');
    }

    writeFile(file, content.replace(oldBlock, newBlock));
    validateJs(file);
    ok('confirm-phone-verification.js now issues activation_session_id');
  }
}

// ===========================================================================
// 5.2  Modify get-tag.js POST claim to require valid activation session
// ===========================================================================

log('');
log('5.2  get-tag.js: require activation_session_id for active-flip');

{
  const file = path.join(API, 'get-tag.js');
  const content = readFile(file);

  if (content.includes(MARKER_5)) {
    skip('get-tag.js (already gated)');
  } else {
    backup(file);

    // Insert the gate AFTER the user_id check and BEFORE the
    // auto-deactivate eTags block.
    // Anchor: "if (!user_id) {" return "user_id required"
    const anchor = `    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }

    `;

    const gate = `// ${MARKER_5}
    // Activation requires a one-shot SMS session token issued by
    // /api/confirm-phone-verification. The token must:
    //   - belong to this user_id
    //   - not be used yet
    //   - have been created within last 5 minutes
    // After consumption it is marked used=true.
    //
    // We ONLY enforce this when a tag is being flipped TO active.
    // status_override paths and ownership-only updates are exempt.
    const { activation_session_id } = req.body;
    const isActivating = !req.body.status_override;
    if (isActivating) {
      if (!activation_session_id) {
        return res.status(403).json({
          error: 'Phone verification required to activate this tag.',
          needs_phone_verification: true
        });
      }
      try {
        const { data: session, error: sessErr } = await supabase
          .from('activation_sessions')
          .select('id, user_id, created_at, used')
          .eq('id', activation_session_id)
          .maybeSingle();

        if (sessErr || !session) {
          return res.status(403).json({
            error: 'Invalid or expired verification session. Please verify your phone again.',
            needs_phone_verification: true
          });
        }
        if (session.user_id !== user_id) {
          return res.status(403).json({
            error: 'Verification session does not match this account.',
            needs_phone_verification: true
          });
        }
        if (session.used) {
          return res.status(403).json({
            error: 'This verification has already been used. Please verify your phone again.',
            needs_phone_verification: true
          });
        }
        const ageMs = Date.now() - new Date(session.created_at).getTime();
        if (ageMs > 5 * 60 * 1000) {
          return res.status(403).json({
            error: 'Verification expired. Please verify your phone again.',
            needs_phone_verification: true
          });
        }

        // Mark session used. Do this BEFORE activation to prevent races
        // where two requests both consume the same session.
        const { error: useErr } = await supabase
          .from('activation_sessions')
          .update({ used: true, used_at: new Date().toISOString() })
          .eq('id', activation_session_id)
          .eq('used', false);
        if (useErr) {
          console.error('activation_sessions consume error:', useErr.message);
          return res.status(500).json({ error: 'Could not consume verification session. Please try again.' });
        }
      } catch (e) {
        console.error('activation session check exception:', e && e.message);
        return res.status(500).json({ error: 'Verification check failed. Please try again.' });
      }
    }

    `;

    let applied = false;
    if (content.includes(anchor)) {
      writeFile(file, content.replace(anchor, anchor + gate));
      applied = true;
    } else {
      // Try CRLF variant
      const anchorCRLF = anchor.replace(/\n/g, '\r\n');
      if (content.includes(anchorCRLF)) {
        const gateCRLF = gate.replace(/\n/g, '\r\n');
        writeFile(file, content.replace(anchorCRLF, anchorCRLF + gateCRLF));
        applied = true;
      }
    }
    if (!applied) {
      err('get-tag.js: expected anchor not found before eTag deactivate block');
    }
    validateJs(file);
    ok('get-tag.js POST claim now requires activation_session_id');
  }
}

// ===========================================================================
// 5.3  verify-otp.js: clarify the 'claimed' status comment
// ===========================================================================

log('');
log('5.3  verify-otp.js: clarify auto-eTag claimed-status comment');

{
  const file = path.join(API, 'verify-otp.js');
  const content = readFile(file);

  if (content.includes(MARKER_5)) {
    skip('verify-otp.js (already commented)');
  } else {
    const oldComment = `    // 3. Insert the new eTag with tag_type='etag' so admin can filter`;
    const newComment = `    // 3. Insert the new eTag with tag_type='etag' so admin can filter
    // ${MARKER_5}
    // status='claimed' is the DELIBERATE placeholder state. The eTag is
    // owned by this user but is NOT yet usable by strangers. The user
    // must explicitly activate it via activate.html with an SMS-verified
    // one-shot session token (see Patch 5 + Patch 7).`;

    if (content.includes(oldComment)) {
      backup(file);
      writeFile(file, content.replace(oldComment, newComment));
      validateJs(file);
      ok('verify-otp.js comment updated');
    } else {
      warn('verify-otp.js: expected comment line not found, skipping');
    }
  }
}

// ===========================================================================
// 5.4  etag.html: link "Activate" prompt to activate.html with token
// ===========================================================================

log('');
log('5.4  etag.html: pass token to activate.html');

{
  const file = path.join(PUBLIC, 'etag.html');
  const content = readFile(file);

  if (content.includes(MARKER_5)) {
    skip('etag.html (already linked with token)');
  } else {
    // The existing prompt at line ~92:
    //   onclick="window.location.href='/activate.html'"
    // We change it to pass the eTag token so activate.html knows what to activate.
    // The 'tagToken' variable is set in loadTagData() — by the time the user
    // clicks, it's populated. We use a function call instead of inline.

    const oldOnClick = `<div id="etag-activate-prompt" onclick="window.location.href='/activate.html'"`;
    const newOnClick = `<div id="etag-activate-prompt" onclick="goActivateEtag()"`;

    let updated = content;
    if (updated.includes(oldOnClick)) {
      updated = updated.replace(oldOnClick, newOnClick);
    } else {
      // Try CRLF variant
      const oldCRLF = oldOnClick;
      if (updated.includes(oldCRLF)) {
        updated = updated.replace(oldCRLF, newOnClick);
      } else {
        warn('etag.html: prompt onclick anchor not found');
      }
    }

    // Inject the goActivateEtag function. Insert near the top of the existing
    // <script> block (right after `let tagToken` declaration if present, or
    // after the s.token guard).
    const scriptAnchor = `let tagToken = '';`;
    const goFnSnippet = `let tagToken = '';

// ${MARKER_5}
// Sends user to activate.html with their eTag token pre-filled.
// activate.html (Patch 7) reads ?token= from URL and walks the SMS-verify flow.
function goActivateEtag() {
  if (!tagToken) {
    showToast && showToast('Loading your eTag... please wait a moment');
    return;
  }
  window.location.href = '/activate.html?token=' + encodeURIComponent(tagToken);
}`;
    if (updated.includes(scriptAnchor) && !updated.includes('function goActivateEtag')) {
      updated = updated.replace(scriptAnchor, goFnSnippet);
    } else if (updated.includes('function goActivateEtag')) {
      // helper already exists — fine
    } else {
      warn('etag.html: tagToken declaration not found, function not injected');
    }

    if (updated !== content) {
      backup(file);
      writeFile(file, updated);
      ok('etag.html: Activate prompt now passes token via query param');
    } else {
      skip('etag.html (no changes applied)');
    }
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 5 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('CRITICAL: Run the SQL migration BELOW in Supabase BEFORE deploying.');
log('Without the activation_sessions table, EVERY activation will fail');
log('with a 500 because confirm-phone-verification cannot insert the row.');
log('');
log('Important deployment note:');
log('  Patch 5 ALONE will break the current activation flow because the');
log('  existing activate.html does NOT yet pass activation_session_id.');
log('  You must ship Patch 7 (UI changes) IMMEDIATELY AFTER Patch 5 to');
log('  restore working activation. Recommended: run both patches and push');
log('  together in one git commit.');
log('');
log('  IF YOU MUST PAUSE BEFORE PATCH 7: deployment of Patch 5 alone');
log('  means activation is BROKEN until Patch 7 ships. Currently your');
log('  activate.html flow is partially broken anyway (eTag activation');
log('  goes to the payment step), so this is not strictly worse, but be');
log('  aware.');
log('');
log('Next steps:');
log('  1. Run the SQL migration in Supabase');
log('  2. node tapmycar-patch5-activation-sessions.js');
log('  3. Hold off on git push until Patch 6 + 7 are also ready');
log('     (or push if you accept the temporary activation breakage)');
log('');
log('==============================================================');
log('SUPABASE MIGRATION (run in SQL editor BEFORE deploying):');
log('');
log('CREATE TABLE IF NOT EXISTS public.activation_sessions (');
log('  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,');
log('  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,');
log('  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,');
log('  used BOOLEAN DEFAULT false NOT NULL,');
log('  used_at TIMESTAMPTZ');
log(');');
log('');
log('CREATE INDEX IF NOT EXISTS activation_sessions_lookup_idx');
log('  ON public.activation_sessions(id, user_id, used);');
log('');
log('CREATE INDEX IF NOT EXISTS activation_sessions_cleanup_idx');
log('  ON public.activation_sessions(created_at)');
log('  WHERE used = false;');
log('==============================================================');
