// TMC_PATCH36B_KNOWMORE_ADMIN
// GET /api/qr-knowmore
//
// Returns a high-resolution PNG of the QR code for tapmycar.io/knowmore,
// suitable for printing on the back of physical TapMyCar stickers.
//
// Admin-only: requires ?key=<ADMIN_SECRET_KEY> query parameter so the
// endpoint can be used as a direct download link with the "download"
// attribute on an anchor tag.
//
// Image: 1230x1230 px, 30% error correction (highest), pure black/white.

const QRCode = require('qrcode');

const TARGET_URL = 'https://tapmycar.io/knowmore';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth via query param (so it works as a download link).
  const key = req.query && req.query.key;
  if (!key || key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const buf = await QRCode.toBuffer(TARGET_URL, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 4,
      scale: 30,           /* 30 px per module = ~1230 px output */
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="tapmycar-knowmore-qr.png"');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(buf);
  } catch (e) {
    console.error('qr-knowmore error:', e && e.message);
    return res.status(500).json({ error: 'QR generation failed' });
  }
};
