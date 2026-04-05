module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const callerNumber = req.body.From || '';
  const baseUrl = `https://${req.headers.host}`;

  // TwiML response — owner hears this when they pick up
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" timeout="10" numDigits="1" action="${baseUrl}/api/voice-action" method="POST">
    <Say voice="alice">
      Hello, someone scanned your TapMyCar tag and needs your attention.
      Press 1 to send them an automated message saying you are on your way.
      Press 2 to speak with them directly.
    </Say>
  </Gather>
  <Say voice="alice">No input received. Goodbye.</Say>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};