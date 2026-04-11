const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tag_id, action, message, scan_id } = req.body;
  if (!tag_id) return res.status(400).json({ error: 'tag_id required' });

  // Get tag and owner
  const { data: tag } = await supabase
    .from('tags')
    .select('*, users(phone, name, email)')
    .eq('id', tag_id)
    .single();

  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  if (!tag.users) return res.status(404).json({ error: 'Tag owner not found' });

  const ownerName = tag.users.name || 'there';
  const ownerEmail = tag.users.email;
  const vehicleLabel = tag.vehicle_label || 'your vehicle';

  // Build notification content based on action type
  let subject = '';
  let body = '';

  if (action === 'quick_message' && message) {
    // Quick message from stranger
    subject = `Alert: "${message}" â€” someone scanned your TapMyCar tag`;
    body = `
      <div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
        <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
        <div style="font-size:14px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
        <div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:16px;margin-bottom:20px">
          <div style="font-size:12px;color:#9A3800;font-weight:600;margin-bottom:6px">Quick Message Alert</div>
          <div style="font-size:20px;font-weight:800;color:#FF6B00;margin-bottom:8px">"${message}"</div>
          <div style="font-size:12px;color:#78350F">Someone scanned your tag for <strong>${vehicleLabel}</strong> and sent this alert.</div>
        </div>
        <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none;margin-bottom:16px">Check Dashboard</a>
        <div style="font-size:11px;color:#9CA3AF;text-align:center">You received this because your TapMyCar tag was scanned.</div>
      </div>
    `;
  } else if (action === 'call') {
    subject = `Someone is trying to call you via TapMyCar`;
    body = `
      <div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
        <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
        <div style="font-size:14px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
        <div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:20px">
          <div style="font-size:12px;color:#15803D;font-weight:600;margin-bottom:4px">Incoming Call</div>
          <div style="font-size:14px;color:#166534">Someone scanned your tag for <strong>${vehicleLabel}</strong> and tapped Call.</div>
        </div>
        <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#16A34A;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none;margin-bottom:16px">View Activity</a>
        <div style="font-size:11px;color:#9CA3AF;text-align:center">Your real number was never shared with the caller.</div>
      </div>
    `;
  } else if (action === "photo") {
    subject = `Someone sent you a photo of your vehicle via TapMyCar`;
    const photoHTML = req.body.photo_base64
      ? `<img src="data:${req.body.photo_type || "image/jpeg"};base64,${req.body.photo_base64}" style="width:100%;max-width:360px;border-radius:12px;margin-bottom:16px">`
      : "<p>Photo attached</p>";
    body = `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
        <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
        <div style="font-size:14px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:20px">
          <div style="font-size:12px;color:#6B7280;font-weight:600;margin-bottom:12px">Someone scanned your tag for <strong>${vehicleLabel}</strong> and sent a photo.</div>
          ${photoHTML}
        </div>
        <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Check Dashboard</a>
      </div>`;
  } else {
    // Generic scan notification
    subject = `Your TapMyCar tag was just scanned`;
    body = `
      <div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
        <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
        <div style="font-size:14px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:20px">
          <div style="font-size:12px;color:#6B7280;font-weight:600;margin-bottom:4px">Tag Scanned</div>
          <div style="font-size:14px;color:#111">Someone scanned your tag for <strong>${vehicleLabel}</strong>.</div>
        </div>
        <a href="https://tapmycar.io/activity.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none;margin-bottom:16px">View Scan Details</a>
        <div style="font-size:11px;color:#9CA3AF;text-align:center">You received this because your TapMyCar tag was scanned.</div>
      </div>
    `;
  }

  // Send email notification
  if (ownerEmail) {
    try {
      await resend.emails.send({
        from: 'TapMyCar Alerts <noreply@tapmycar.io>',
        to: ownerEmail,
        subject,
        html: body
      });
    } catch (e) {
      console.error('Email notification error:', e);
    }
  }

  // Try SMS too (will work when A2P is approved)
  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const smsBody = action === 'quick_message'
      ? `TapMyCar Alert: "${message}" â€” someone scanned your tag for ${vehicleLabel}. Check: tapmycar.io/dashboard.html`
      : `Hi ${ownerName}! Someone just scanned your TapMyCar tag for ${vehicleLabel}. Check activity at tapmycar.io/dashboard.html`;

    await client.messages.create({
      body: smsBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: tag.users.phone
    });
  } catch (err) {
    // SMS may fail if A2P not approved â€” that's OK, email was sent
    console.log('SMS failed (A2P pending):', err.message);
  }

  res.json({ success: true });
};

