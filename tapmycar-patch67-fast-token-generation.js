// ============================================================================
// TapMyCar - Patch 67: Fast & unique bulk token generation
//
// PROBLEM
//   Generating 500 tokens fails with "Network error". The old endpoint loops
//   500 times, doing TWO database round-trips per token (a SELECT to check
//   uniqueness, then an INSERT). At ~100-150ms each that's 50-75 seconds -
//   well past Vercel's 10s function cap.
//
// FIX (Option A - bulk insert with guaranteed uniqueness)
//   1. Generate the requested number of tokens in MEMORY, de-duplicating
//      within the batch (so two identical strings are never sent together).
//   2. Do a SINGLE bulk insert  supabase.from('tags').insert([...])  with
//      the whole array.
//   3. Rely on the database's UNIQUE constraint on tags.token. If any
//      generated token already exists in the database, the bulk insert
//      fails with error code 23505 (unique_violation). The code then
//      regenerates the failing token(s) and retries - up to a few attempts.
//
//   Result: 500 tokens in well under a second, with three layers of
//   uniqueness guarantee:
//     (a) random tokens (~1B combinations for current 6-char format),
//     (b) in-batch de-duplication before sending,
//     (c) the database refuses any duplicate against existing tags.
//
//   No SQL change. No vercel.json change. No public/admin.html change.
//
// Properties: idempotent (safe to re-run), validates JS, backs up the file.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch67-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function checkJs(absPath, label) {
  try {
    execSync('node --check "' + absPath + '"', { stdio: 'pipe' });
    ok(label + ' passes node --check');
  } catch (e) {
    errExit(label + ' FAILED node --check:\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

log('');
log('TapMyCar Patch 67 - Fast & unique bulk token generation');
log('=======================================================');

const epPath = path.join(API, 'generate-tokens.js');
if (!fs.existsSync(epPath)) errExit('api/generate-tokens.js not found.');
let src = fs.readFileSync(epPath, 'utf8');

if (src.indexOf('TMC_PATCH67_BULK') !== -1) {
  skip('api/generate-tokens.js');
} else {
  backup(epPath, 'api/generate-tokens.js');

  const NEW_FILE = String.raw`// TMC_PATCH67_BULK - fast bulk insert with guaranteed-unique tokens.
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { audit } = require('./_audit'); /* TMC_PATCH20_AUDIT_AND_OPS */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Generate token - format: TMC-XXXXXX (6 chars from a 32-char alphabet).
function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let random = '';
  for (let i = 0; i < 6; i++) {
    random += chars[crypto.randomInt(chars.length)];
  }
  return 'TMC-' + random;
}

// Build "count" distinct tokens, avoiding any token in the optional avoidSet
// AND avoiding duplicates within the batch itself.
function makeUniqueBatch(count, avoidSet) {
  const out = new Set();
  let safety = 0;
  while (out.size < count) {
    const t = generateToken();
    if (!out.has(t) && !(avoidSet && avoidSet.has(t))) out.add(t);
    if (++safety > count * 100) break;
  }
  return Array.from(out);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const count = parseInt(req.body && req.body.count, 10) || 1;
  const batch_number = req.body && req.body.batch_number;

  if (count < 1) return res.status(400).json({ error: 'count must be >= 1' });
  if (count > 500) return res.status(400).json({ error: 'Max 500 tokens per request' });

  // --- generate "count" distinct tokens in memory ---
  let tokensToInsert = makeUniqueBatch(count, null);

  // --- bulk insert; if the database rejects any duplicates (unique-constraint
  //     violation against EXISTING tags), regenerate the colliding ones and
  //     retry. The unique constraint is the real safety guarantee.
  const inserted = [];
  const seen = new Set();
  let attempts = 0;
  const MAX_ATTEMPTS = 5;

  while (tokensToInsert.length && attempts < MAX_ATTEMPTS) {
    attempts++;
    tokensToInsert.forEach(function (t) { seen.add(t); });

    const rows = tokensToInsert.map(function (token) {
      return {
        token: token,
        status: 'unclaimed',
        batch_number: batch_number || null,
        tag_type: 'physical',
        verified: false /* TMC_PATCH15_VERIFY_GATE */
      };
    });

    const { data, error } = await supabase
      .from('tags')
      .insert(rows)
      .select('token, status, created_at');

    if (!error) {
      (data || []).forEach(function (r) { inserted.push(r); });
      tokensToInsert = [];
      break;
    }

    if (error.code !== '23505') {
      console.error('generate-tokens insert error:', error);
      return res.status(500).json({ error: error.message || 'Insert failed' });
    }

    // Unique-constraint collision against existing tags. Find which already
    // exist, drop them, generate replacements, retry.
    const { data: existing } = await supabase
      .from('tags')
      .select('token')
      .in('token', tokensToInsert);
    const existingSet = new Set((existing || []).map(function (r) { return r.token; }));
    const avoid = new Set();
    seen.forEach(function (t) { avoid.add(t); });
    existingSet.forEach(function (t) { avoid.add(t); });
    const kept = tokensToInsert.filter(function (t) { return !existingSet.has(t); });
    const replacements = makeUniqueBatch(existingSet.size, avoid);
    tokensToInsert = kept.concat(replacements);
  }

  if (tokensToInsert.length) {
    return res.status(500).json({
      error: 'Could not generate enough unique tokens after ' + MAX_ATTEMPTS +
             ' attempts. Try a smaller batch.'
    });
  }

  const tokens = inserted.map(function (r) {
    return {
      token: r.token,
      url: 'https://tapmycar.io/tag/' + r.token,
      status: r.status,
      created_at: r.created_at
    };
  });

  audit({
    actor: 'admin', action: 'generate_tokens',
    target_type: 'batch', target_id: String(batch_number || ''),
    meta: { count: tokens.length, attempts: attempts }
  });

  return res.json({
    success: true,
    generated: tokens.length,
    tokens: tokens,
    errors: []
  });
};
`;

  fs.writeFileSync(epPath, NEW_FILE, { encoding: 'utf8' });
  checkJs(epPath, 'api/generate-tokens.js');
  ok('generate-tokens.js rewritten: bulk insert + DB-enforced uniqueness');
}

log('');
log('=======================================================');
log('Patch 67 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s. Then in /admin.html -> Generate:');
log('   1. Generate 10 tokens with a test batch number -> still works,');
log('      CSV downloads.');
log('   2. Generate 500 tokens -> succeeds in about a second, CSV downloads.');
log('   3. Try generating 500 a few times in a row - every batch is fully');
log('      unique, no overlap with existing tags.');
log('');
log('  How uniqueness is guaranteed now:');
log('   - random tokens (~1B combinations for the 6-char format),');
log('   - de-duplicated in-memory before sending,');
log('   - DB UNIQUE constraint refuses any duplicate; code retries up to 5x.');
log('');
log('  Note: if you ever want even safer long-term odds, lengthening the');
log('  token to 8 chars pushes combinations from ~1B to ~1T. Easy follow-up.');
log('');
