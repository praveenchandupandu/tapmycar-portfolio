// TMC_PATCH20_AUDIT_AND_OPS
// Audit log helper. Inserts a row into admin_audit_log.
// Fail-soft: never throws; logs to console on error.

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getClient() {
  if (_supabase) return _supabase;
  _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _supabase;
}

async function audit({ actor, action, target_type, target_id, meta }) {
  try {
    await getClient().from('admin_audit_log').insert({
      actor: actor || 'admin',
      action: String(action || ''),
      target_type: target_type ? String(target_type) : null,
      target_id: target_id ? String(target_id) : null,
      meta: meta || null
    });
  } catch (e) {
    console.error('audit log error:', e && e.message);
  }
}

module.exports = { audit };
