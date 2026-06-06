/* ============================================================================
 * TapMyCar — Patch 70: hardening
 * ----------------------------------------------------------------------------
 *   1. api/notify-owner.js
 *      - HTML-escape the stranger's message before it goes into the alert
 *        email (no more HTML/link injection into your inbox).
 *      - Whitelist the photo MIME type so it can't break out of the
 *        <img src="..."> attribute.
 *      - Reject oversized photo/voice payloads (basic DoS guard).
 *
 *   2. api/chat.js
 *      - Add a per-IP rate limit to the AI chatbot so bots can't burn the
 *        Gemini quota.
 *
 *   3. api/admin-login.js
 *      - Rate-limit admin login attempts.
 *
 *   4. Remove the stray source backup api/get-referral.js.before-hotfix.
 *
 * Idempotent, backs up before editing, validates with `node --check`, and
 * restores from backup if validation fails.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_DIR = path.join(ROOT, 'backup-patch70-' + ts, 'api');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function anchorRe(literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n');
  return new RegExp(escaped);
}
function edit(content, marker, anchor, replacement) {
  if (content.indexOf(marker) !== -1) return { content, status: 'already-applied' };
  const re = anchorRe(anchor);
  if (!re.test(content)) return { content, status: 'anchor-not-found' };
  return { content: content.replace(re, () => replacement), status: 'applied' };
}

const NOTIFY_HELPERS =
  "const { rateLimit, getClientIp } = require('./_rate-limit');\n" +
  "/* TMC_PATCH70_SANITIZE: escape stranger text for the HTML email and\n" +
  "   whitelist the photo MIME type so it can't break out of src=\"...\". */\n" +
  "function _esc(s) {\n" +
  "  return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n" +
  "    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c];\n" +
  "  });\n" +
  "}\n" +
  "function _imgMime(t) {\n" +
  "  t = String(t || '').toLowerCase();\n" +
  "  return /^image\\/(jpeg|jpg|png|gif|webp|heic|heif)$/.test(t) ? t : 'image/jpeg';\n" +
  "}\n" +
  "const _MAX_B64 = 8 * 1024 * 1024; /* ~6MB binary; rejects oversized payloads */";

const edits = {
  'api/notify-owner.js': [
    {
      marker: 'TMC_PATCH70_SANITIZE',
      anchor: "const { rateLimit, getClientIp } = require('./_rate-limit');",
      replacement: NOTIFY_HELPERS
    },
    {
      marker: 'TMC_PATCH70_SIZE_GUARD',
      anchor:
        "  const { tag_id, action, message, scan_id } = req.body;\n" +
        "  if (!tag_id) return res.status(400).json({ error: 'tag_id required' });",
      replacement:
        "  const { tag_id, action, message, scan_id } = req.body;\n" +
        "  if (!tag_id) return res.status(400).json({ error: 'tag_id required' });\n" +
        "\n" +
        "  /* TMC_PATCH70_SIZE_GUARD: reject oversized media payloads. */\n" +
        "  if ((req.body.photo_base64 && String(req.body.photo_base64).length > _MAX_B64) ||\n" +
        "      (req.body.audio_base64 && String(req.body.audio_base64).length > _MAX_B64)) {\n" +
        "    return res.status(413).json({ error: 'Attachment too large' });\n" +
        "  }"
    },
    {
      marker: 'TMC_PATCH70_ESC_MSG',
      anchor: '          <div style="font-size:20px;font-weight:800;color:#FF6B00;margin-bottom:8px">"${message}"</div>',
      replacement: '          <div style="font-size:20px;font-weight:800;color:#FF6B00;margin-bottom:8px">"${_esc(message)}"</div>${"" /* TMC_PATCH70_ESC_MSG */}'
    },
    {
      marker: 'TMC_PATCH70_IMG_MIME_EMAIL',
      anchor: '      ? `<img src="data:${req.body.photo_type || "image/jpeg"};base64,${req.body.photo_base64}" style="width:100%;max-width:360px;border-radius:12px;margin-bottom:16px">`',
      replacement: '      ? `<img src="data:${_imgMime(req.body.photo_type)};base64,${req.body.photo_base64}" style="width:100%;max-width:360px;border-radius:12px;margin-bottom:16px">`/* TMC_PATCH70_IMG_MIME_EMAIL */'
    },
    {
      marker: 'TMC_PATCH70_IMG_MIME_STORE',
      anchor: '      if (action === "photo" && req.body.photo_base64) scanUpdate.photo_url = "data:" + (req.body.photo_type || "image/jpeg") + ";base64," + req.body.photo_base64;',
      replacement: '      if (action === "photo" && req.body.photo_base64) scanUpdate.photo_url = "data:" + _imgMime(req.body.photo_type) + ";base64," + req.body.photo_base64; /* TMC_PATCH70_IMG_MIME_STORE */'
    }
  ],

  'api/chat.js': [
    {
      marker: 'TMC_PATCH70_CHAT_RL_REQUIRE',
      anchor: '// TMC_PATCH39 - refund policy updated\nmodule.exports = async function handler(req, res) {',
      replacement:
        "// TMC_PATCH39 - refund policy updated\n" +
        "/* TMC_PATCH70_CHAT_RL_REQUIRE */\n" +
        "const { rateLimit, getClientIp } = require('./_rate-limit');\n" +
        "module.exports = async function handler(req, res) {"
    },
    {
      marker: 'TMC_PATCH70_CHAT_RL_GATE',
      anchor:
        "    return res.status(405).json({ error: 'Method not allowed' });\n" +
        "  }\n" +
        "\n" +
        "  // --- Parse + sanitise the incoming conversation ---------------------------",
      replacement:
        "    return res.status(405).json({ error: 'Method not allowed' });\n" +
        "  }\n" +
        "\n" +
        "  /* TMC_PATCH70_CHAT_RL_GATE: throttle the AI endpoint per IP. */\n" +
        "  const _chatIp = getClientIp(req);\n" +
        "  if (!await rateLimit(req, res, [\n" +
        "    { key: 'chat:ip:' + _chatIp, max: 20, windowSeconds: 60 },\n" +
        "    { key: 'chat:ip-hr:' + _chatIp, max: 200, windowSeconds: 3600 }\n" +
        "  ])) return;\n" +
        "\n" +
        "  // --- Parse + sanitise the incoming conversation ---------------------------"
    }
  ],

  'api/admin-login.js': [
    {
      marker: 'TMC_PATCH70_ADMIN_RL_REQUIRE',
      anchor: "const { signAdminSession, adminCookie } = require('./_admin-auth');",
      replacement:
        "const { signAdminSession, adminCookie } = require('./_admin-auth');\n" +
        "/* TMC_PATCH70_ADMIN_RL_REQUIRE */\n" +
        "const { rateLimit, getClientIp } = require('./_rate-limit');"
    },
    {
      marker: 'TMC_PATCH70_ADMIN_RL_GATE',
      anchor:
        "  if (req.method !== 'POST') {\n" +
        "    return res.status(405).json({ error: 'Method not allowed' });\n" +
        "  }\n" +
        "\n" +
        "  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '';",
      replacement:
        "  if (req.method !== 'POST') {\n" +
        "    return res.status(405).json({ error: 'Method not allowed' });\n" +
        "  }\n" +
        "\n" +
        "  /* TMC_PATCH70_ADMIN_RL_GATE: throttle admin login attempts. */\n" +
        "  const _admIp = getClientIp(req);\n" +
        "  if (!await rateLimit(req, res, [\n" +
        "    { key: 'admin-login:ip:' + _admIp, max: 10, windowSeconds: 900 }\n" +
        "  ])) return;\n" +
        "\n" +
        "  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '';"
    }
  ]
};

let touched = 0, skipped = 0, problems = 0;
for (const rel of Object.keys(edits)) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log('  ✗ MISSING: ' + rel); problems++; continue; }

  const original = fs.readFileSync(file, 'utf8');
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let content = original;
  const notes = [];

  for (const e of edits[rel]) {
    const r = edit(content, e.marker, e.anchor, e.replacement);
    content = r.content;
    notes.push(e.marker + ': ' + r.status);
    if (r.status === 'anchor-not-found') problems++;
  }

  content = content.replace(/^\uFEFF/, '');
  content = wasCRLF ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');

  if (content === original) { console.log('  • ' + rel + ' — no change (' + notes.join(', ') + ')'); skipped++; continue; }

  fs.copyFileSync(file, path.join(BACKUP_DIR, path.basename(file)));
  fs.writeFileSync(file, content, 'utf8');

  try {
    execSync('node --check "' + file + '"', { stdio: 'pipe' });
    console.log('  ✓ ' + rel + ' — ' + notes.join(', '));
    touched++;
  } catch (err) {
    fs.copyFileSync(path.join(BACKUP_DIR, path.basename(file)), file);
    console.log('  ✗ ' + rel + ' — node --check FAILED, restored original');
    console.log('    ' + String(err.stderr || err.message).split('\n')[0]);
    problems++;
  }
}

/* 4. Remove the stray source backup file, if present. */
const stray = path.join(ROOT, 'api', 'get-referral.js.before-hotfix');
if (fs.existsSync(stray)) {
  fs.copyFileSync(stray, path.join(BACKUP_DIR, 'get-referral.js.before-hotfix'));
  fs.unlinkSync(stray);
  console.log('  ✓ removed stray file api/get-referral.js.before-hotfix (backed up)');
  touched++;
} else {
  console.log('  • api/get-referral.js.before-hotfix — not present, nothing to remove');
}

console.log('\nPatch 70 done. Changes: ' + touched + ', unchanged: ' + skipped + ', problems: ' + problems);
console.log('Backups: ' + path.relative(ROOT, BACKUP_DIR));
if (problems > 0) { console.log('\n⚠ One or more edits did not apply cleanly. Do NOT push — re-run after checking the file state.'); process.exit(1); }
