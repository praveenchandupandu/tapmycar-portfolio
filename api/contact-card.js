// TMC_PATCH27_SAVE_CONTACT: serves a vCard so owners can save TapMyCar as a contact.
//
// The number comes from TWILIO_PHONE_NUMBER - the SAME variable used as the
// callerId on every owner-facing call (inbound-call, stranger-wait,
// proxy-call) and as the SMS sender (notify-owner, send-broadcast). Reading
// it here means the saved contact can never drift out of sync with the
// number owners actually see ringing.
//
// Public by necessity - a contact card cannot sit behind a login. It exposes
// only the business number, which is already printed on every tag page. No
// user data, no DB access, no request input is read, so there is no
// injection surface.

module.exports = async (req, res) => {
  // Read-only endpoint: GET/HEAD only.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = process.env.TWILIO_PHONE_NUMBER || '';
  const number = String(raw).trim();

  // Strict E.164. Guarantees no CRLF or stray characters can break out of
  // the vCard structure or inject a response header.
  if (!/^\+[1-9][0-9]{7,14}$/.test(number)) {
    console.error('contact-card: TWILIO_PHONE_NUMBER missing or malformed');
    return res.status(503).json({ error: 'Contact card unavailable' });
  }

  // vCard 3.0: the most broadly supported version across iOS and Android.
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:;TapMyCar;;;',
    'FN:TapMyCar',
    'ORG:TapMyCar',
    'TEL;TYPE=MAIN,VOICE:' + number,
    'URL:https://www.tapmycar.io',
    'NOTE:Calls and scan alerts from TapMyCar come from this number.',
    'END:VCARD'
  ].join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="TapMyCar.vcf"');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(vcard);
};
