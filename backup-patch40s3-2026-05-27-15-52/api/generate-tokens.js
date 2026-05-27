const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { audit } = require('./_audit'); /* TMC_PATCH20_AUDIT_AND_OPS */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Generate token — format: TMC-XXXXXX (dash included)
function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let random = '';
  for (let i = 0; i < 6; i++) {
    random += chars[crypto.randomInt(chars.length)];
  }
  return 'TMC-' + random;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin check
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { count = 1, batch_number } = req.body;

  if (count > 500) {
    return res.status(400).json({ error: 'Max 500 tokens per request' });
  }

  const tokens = [];
  const errors = [];

  for (let i = 0; i < count; i++) {
    let token;
    let attempts = 0;

    // Keep trying until we get a unique token
    while (attempts < 10) {
      token = generateToken();
      const { data: existing } = await supabase
        .from('tags')
        .select('token')
        .eq('token', token)
        .single();

      if (!existing) break;
      attempts++;
    }

    const { data, error } = await supabase
      .from('tags')
      .insert({
        token,
        status: 'unclaimed',
        batch_number: batch_number || null,
        tag_type: 'physical',
        verified: false /* TMC_PATCH15_VERIFY_GATE: must be verified by admin before activation */
      })
      .select()
      .single();

    if (error) {
      errors.push({ token, error: error.message });
    } else {
      tokens.push({
        token: data.token,
        url: `https://tapmycar.io/tag/${data.token}`,
        status: data.status,
        created_at: data.created_at
      });
    }
  }

  /* TMC_PATCH20_AUDIT_AND_OPS: audit */
  audit({ actor: 'admin', action: 'generate_tokens', target_type: 'batch', target_id: String(batch_number || ''), meta: { count: tokens.length, errors: errors.length } });

  res.json({
    success: true,
    generated: tokens.length,
    tokens,
    errors
  });
};