// TMC_PATCH52 admin: CSV export of active newsletter subscribers.
// Columns: email, name, signup_source, signup_exit_reason, created_at, unsubscribe_url
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SITE = 'https://tapmycar.io';

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { data: rows, error } = await supabase
    .from('newsletter_subscribers')
    .select('id, email, name, signup_source, signup_exit_reason, unsubscribe_token, created_at')
    .is('unsubscribed_at', null)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const header = ['email','name','signup_source','signup_exit_reason','created_at','unsubscribe_url'];
  const lines = [header.join(',')];
  (rows || []).forEach(r => {
    const unsubUrl = SITE + '/unsubscribe.html?u=' + encodeURIComponent(r.id) +
                     '&t=' + encodeURIComponent(r.unsubscribe_token || '') +
                     '&list=newsletter';
    lines.push([
      csvEscape(r.email),
      csvEscape(r.name),
      csvEscape(r.signup_source),
      csvEscape(r.signup_exit_reason),
      csvEscape(r.created_at),
      csvEscape(unsubUrl)
    ].join(','));
  });
  const csv = lines.join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tapmycar-newsletter.csv"');
  return res.send(csv);
};
