// TMC_PATCH67_BULK - fast bulk insert with guaranteed-unique tokens.
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
