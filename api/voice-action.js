module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const digit = req.body.Digits;
  const callerNumber = req.body.From || '';

  let twiml = '';

  if (digit === '1') {
    // Owner pressed 1 — send auto message to stranger
    // First tell owner
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">
    Thank you. The caller will be notified that you are on your way.
  </Say>
  <Hangup/>
</Response>`;

    // Now call the stranger back with automated message
    // We do this async — fire and forget
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const baseUrl = `https://${req.headers.host}`;

    twilio.calls.create({
      to: callerNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      twiml: `<Response><Say voice="alice">The vehicle owner has been notified and is on their way to the car. Thank you for using TapMyCar.</Say></Response>`
    }).catch(err => console.error('Callback call error:', err.message));

  } else if (digit === '2') {
    // Owner pressed 2 — connect directly to stranger
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting you now.</Say>
  <Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">
    <Number>${callerNumber}</Number>
  </Dial>
</Response>`;

  } else {
    // Invalid input
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid input. Goodbye.</Say>
  <Hangup/>
</Response>`;
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};