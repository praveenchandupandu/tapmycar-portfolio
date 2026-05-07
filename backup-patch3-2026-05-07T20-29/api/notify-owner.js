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
    } else if (action === 'voice') {
    // TMC_NOTIFY_VOICE_HANDLER
    // Voice memo from stranger. Upload audio to Supabase Storage,
    // build a public URL, send owner an SMS with the link.
    const audioB64 = req.body.audio_base64;
    const audioType = req.body.audio_type || 'audio/webm';
    const duration = req.body.duration || 0;
    let audioUrl = '';

    if (audioB64) {
      try {
        const audioBuffer = Buffer.from(audioB64, 'base64');
        const ext = audioType.includes('webm') ? 'webm' : (audioType.includes('mp4') ? 'm4a' : 'audio');
        const fileName = 'voice-' + tag_id + '-' + Date.now() + '.' + ext;
        const { data: uploadData, error: uploadErr } = await supabase
          .storage
          .from('tapmycar-voice-memos')
          .upload(fileName, audioBuffer, { contentType: audioType, upsert: false });
        if (uploadErr) {
          console.error('Voice upload error:', uploadErr);
        } else {
          const { data: urlData } = supabase
            .storage
            .from('tapmycar-voice-memos')
            .getPublicUrl(fileName);
          audioUrl = urlData?.publicUrl || '';
        }
      } catch (e) {
        console.error('Voice handling error:', e);
      }
    }

    subject = 'Someone sent you a voice memo via TapMyCar';
    const audioHtml = audioUrl
      ? '<a href="' + audioUrl + '" style="display:inline-block;background:#6D28D9;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;margin-bottom:12px">Listen to voice memo (' + duration + 's)</a>'
      : '<p style="font-size:12px;color:#6B7280">Voice memo could not be processed. Please check your dashboard.</p>';
    body =
      '<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">' +
        '<div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>' +
        '<div style="font-size:14px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>' +
        '<div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:14px;padding:16px;margin-bottom:20px">' +
          '<div style="font-size:12px;color:#6D28D9;font-weight:600;margin-bottom:6px">Voice memo received</div>' +
          '<div style="font-size:13px;color:#5B21B6;margin-bottom:12px">Someone scanned your tag for <strong>' + vehicleLabel + '</strong> and recorded a ' + duration + '-second voice memo.</div>' +
          audioHtml +
        '</div>' +
        '<a href="https://tapmycar.io/activity.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">View Activity</a>' +
      '</div>';

    // Stash audio_url on scan_logs so it shows on activity page
    if (scan_id && audioUrl) {
      try {
        await supabase.from('scan_logs').update({
          contact_action: 'voice',
          audio_url: audioUrl
        }).eq('id', scan_id);
      } catch (e) { console.error('scan log voice update err:', e); }
    }

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
      ? `TapMyCar Alert: "${message}" — someone scanned your tag for ${vehicleLabel}. Check: tapmycar.io/dashboard.html`
      : action === 'voice'
        ? `TapMyCar: someone left you a ${req.body.duration||0}s voice memo. Listen: tapmycar.io/activity.html`
        : `Hi ${ownerName}! Someone just scanned your TapMyCar tag for ${vehicleLabel}. Check: tapmycar.io/dashboard.html`;

    await client.messages.create({
      body: smsBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: tag.users.phone
    });
  } catch (err) {
    // SMS may fail if A2P not approved â€” that's OK, email was sent
    console.log('SMS failed (A2P pending):', err.message);
  }

  if (scan_id) {
    try {
      const scanUpdate = { contact_action: action };
      if (action === "quick_message" && message) scanUpdate.message_text = message;
      if (action === "photo" && req.body.photo_base64) scanUpdate.photo_url = "data:" + (req.body.photo_type || "image/jpeg") + ";base64," + req.body.photo_base64;
      await supabase.from("scan_logs").update(scanUpdate).eq("id", scan_id);
    } catch(e) { console.error("scan log update error:", e); }
  }
  // Send push notification to owner
  try {
    const { data: tag } = await supabase.from("tags").select("owner_id").eq("id", tag_id).single();
    if (tag && tag.owner_id) {
      const actionLabels = { quick_message: "sent you a message", photo: "sent you a photo", call: "called you", voice: "sent you a voice memo" };
      const label = actionLabels[action] || "scanned your tag";
      const baseUrl = process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "https://tapmycar.io";
      await fetch(baseUrl + "/api/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: tag.owner_id, title: "TapMyCar Alert", body: "Someone " + label + "!", url: "/activity.html" })
      });
    }
  } catch(e) { console.error("Push error:", e.message); }

  res.json({ success: true });
};



