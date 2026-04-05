const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tag_id } = req.body;
  if (!tag_id) return res.status(400).json({ error: 'tag_id required' });

  const { data: tag } = await supabase
    .from('tags')
    .select('*, users(phone, name)')
    .eq('id', tag_id)
    .single();

  if (!tag) return res.status(404).json({ error: 'Tag not found' });

  const ownerPhone = tag.users.phone;
  const ownerName = tag.users.name || 'there';

  try {
    await client.messages.create({
      body: `Hi ${ownerName}! Someone just scanned your TapMyCar tag for your ${tag.vehicle_label}. Check activity at tapmycar.vercel.app/dashboard.html`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: ownerPhone
    });
    res.json({ success: true });
  } catch (err) {
    console.error('SMS error:', err.message);
    res.status(500).json({ error: err.message });
  }
};