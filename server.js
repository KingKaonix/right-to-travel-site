const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const PAYPAL_EMAIL = process.env.PAYPAL_EMAIL || 'joemulik@gmail.com';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── Telegram notification setup ──
// Bot token and chat ID are set via env vars (created via Telegram's BotFather)
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

function sendTelegram(msg) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  const text = encodeURIComponent(msg);
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage?chat_id=${TG_CHAT_ID}&text=${text}&parse_mode=HTML`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode !== 200) console.error('Telegram send failed:', data);
    });
  }).on('error', e => console.error('Telegram error:', e.message));
}

// ── Payment tokens ──
const paymentTokens = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of paymentTokens) {
    if (now - data.created > 30 * 60 * 1000) paymentTokens.delete(token);
  }
}, 10 * 60 * 1000);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Visitor tracking middleware ──
app.use((req, res, next) => {
  // Only track page views (not API calls, static files)
  if (req.path === '/' || req.path.startsWith('/dl/')) {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const ua = (req.headers['user-agent'] || '').substring(0, 80);
    let visitorMsg = '';
    if (req.path === '/') {
      visitorMsg = `👁️ <b>Visitor</b>\nSite: Right-to-Travel\nIP: ${ip}\nUA: ${ua}`;
    }
    if (visitorMsg) sendTelegram(visitorMsg);
  }
  next();
});

// ── Blog / static pages ──
app.get('/blog/:path(*)', (req, res) => {
  const page = req.params.path || 'index.html';
  const filePath = path.join(__dirname, 'public', 'blog', page);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).send('Blog post not found');
});

// ── Landing page ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── PayPal redirect after payment ──
app.get('/success', (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;">
        <h2>Payment not confirmed</h2>
        <p>No payment token found. <a href="/">Go back</a></p>
      </body></html>
    `);
  }

  const payment = paymentTokens.get(token);
  if (!payment) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;">
        <h2>Payment expired or invalid</h2>
        <p>This payment link has expired. <a href="/">Go back</a></p>
      </body></html>
    `);
  }

  const productNames = {
    bundle: 'Complete Bundle (Vol I + II)',
    vol1: 'Vol I — Constitutional Case',
    vol2: 'Vol II — Legal Challenge'
  };
  const productPrices = { bundle: '$14.99', vol1: '$9.99', vol2: '$9.99' };

  sendTelegram(
    `💰 <b>NEW SALE!</b>\n` +
    `Product: ${productNames[payment.product] || payment.product}\n` +
    `Amount: ${productPrices[payment.product] || '???'}\n` +
    `Time: ${new Date().toLocaleString()}\n` +
    `URL: ${BASE_URL}/success?token=${token}`
  );

  const downloadToken = crypto.randomBytes(32).toString('hex');
  const downloads = payment.product === 'bundle'
    ? { vol1: true, vol2: true }
    : payment.product === 'vol2'
      ? { vol2: true }
      : { vol1: true };

  paymentTokens.set(`dl_${downloadToken}`, {
    downloads,
    created: Date.now(),
    ttl: 60 * 60 * 1000
  });

  paymentTokens.delete(token);

  res.redirect(`/download/${downloadToken}`);
});

// ── Download page ──
app.get('/download/:token', (req, res) => {
  const downloadInfo = paymentTokens.get(`dl_${req.params.token}`);
  if (!downloadInfo || (Date.now() - downloadInfo.created > downloadInfo.ttl)) {
    paymentTokens.delete(`dl_${req.params.token}`);
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;">
        <h2>Download link expired</h2>
        <p>Download links expire after 1 hour. Please check your email for a new link, or <a href="/">contact support</a>.</p>
      </body></html>
    `);
  }

  sendTelegram(`⬇️ <b>Download started</b>\nTime: ${new Date().toLocaleString()}`);

  const dlToken = req.params.token;
  const links = [];
  if (downloadInfo.downloads.vol1) {
    links.push(`<a href="/dl/${dlToken}/vol1" style="display:block;padding:16px 24px;background:#0a1628;color:#c9a84c;text-decoration:none;border-radius:8px;font-weight:700;margin:10px 0;font-size:1.1rem;">⬇ Download Volume I — The Constitutional Case (PDF)</a>`);
  }
  if (downloadInfo.downloads.vol2) {
    links.push(`<a href="/dl/${dlToken}/vol2" style="display:block;padding:16px 24px;background:#0a1628;color:#c9a84c;text-decoration:none;border-radius:8px;font-weight:700;margin:10px 0;font-size:1.1rem;">⬇ Download Volume II — The Legal Challenge (PDF)</a>`);
  }

  res.send(`
    <!DOCTYPE html>
    <html><head>
      <title>Your Downloads — Right to Travel</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800&family=Playfair+Display:wght@700;800&display=swap');
        body{font-family:'Inter',sans-serif;background:#f8f6f1;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
        .card{background:#fff;border-radius:16px;padding:48px;max-width:500px;width:90%;box-shadow:0 4px 30px rgba(0,0,0,.08);text-align:center;}
        .check{font-size:3rem;margin-bottom:16px;}
        h1{font-family:'Playfair Display',serif;font-size:1.6rem;color:#0a1628;margin-bottom:8px;}
        p{color:#6b7280;margin-bottom:24px;}
        .note{font-size:.75rem;color:#999;margin-top:20px;}
      </style>
    </head><body>
      <div class="card">
        <div class="check">✅</div>
        <h1>Payment Confirmed</h1>
        <p>Thank you for your purchase. Your downloads are ready — click below to save them to your device.</p>
        ${links.join('')}
        <p class="note">Downloads expire in 1 hour. Save your files promptly.<br>Questions? Email joemulik@gmail.com</p>
      </div>
    </body></html>
  `);
});

// ── Actual PDF download ──
app.get('/dl/:token/:vol', (req, res) => {
  const downloadInfo = paymentTokens.get(`dl_${req.params.token}`);
  if (!downloadInfo || (Date.now() - downloadInfo.created > downloadInfo.ttl)) {
    return res.status(400).send('Download link expired');
  }

  const vol = req.params.vol;
  if (vol === 'vol1' && downloadInfo.downloads.vol1) {
    const filePath = path.join(__dirname, 'pdfs', 'right-to-travel-full.pdf');
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Disposition', 'attachment; filename="Right-to-Travel-Vol1-Constitutional-Case.pdf"');
      return res.sendFile(filePath);
    }
  }
  if (vol === 'vol2' && downloadInfo.downloads.vol2) {
    const filePath = path.join(__dirname, 'pdfs', 'right-to-travel-pro.pdf');
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Disposition', 'attachment; filename="Right-to-Travel-Vol2-Legal-Challenge.pdf"');
      return res.sendFile(filePath);
    }
  }

  res.status(404).send('File not found');
});

// ── Cancel page ──
app.get('/cancel', (req, res) => {
  sendTelegram(`❌ <b>Payment cancelled</b>\nTime: ${new Date().toLocaleString()}`);
  res.send(`
    <!DOCTYPE html>
    <html><head>
      <title>Payment Cancelled</title>
      <style>
        body{font-family:sans-serif;text-align:center;padding:80px 20px;background:#f8f6f1;}
        h2{color:#0a1628;margin-bottom:12px;}
        a{color:#c9a84c;font-weight:600;}
      </style>
    </head><body>
      <h2>Payment cancelled</h2>
      <p>No charges were made.</p>
      <p><a href="/">← Back to the guide</a></p>
    </body></html>
  `);
});

// ── Create PayPal payment ──
app.post('/api/create-payment', (req, res) => {
  const { product } = req.body;

  const prices = { bundle: '14.99', vol1: '9.99', vol2: '9.99' };
  const names = {
    bundle: 'Right to Travel — Complete Bundle (Vol I + II)',
    vol1: 'Right to Travel Vol I — The Constitutional Case',
    vol2: 'Right to Travel Vol II — The Legal Challenge'
  };

  if (!prices[product]) return res.status(400).json({ error: 'Invalid product' });

  const token = crypto.randomBytes(16).toString('hex');
  paymentTokens.set(token, { product, created: Date.now() });

  sendTelegram(
    `🛒 <b>Checkout started</b>\nProduct: ${names[product]}\nPrice: $${prices[product]}\nTime: ${new Date().toLocaleString()}`
  );

  const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?` +
    `cmd=_xclick` +
    `&business=${encodeURIComponent(PAYPAL_EMAIL)}` +
    `&item_name=${encodeURIComponent(names[product])}` +
    `&item_number=${encodeURIComponent(product.toUpperCase())}` +
    `&amount=${prices[product]}` +
    `&currency_code=USD` +
    `&no_note=1` +
    `&no_shipping=1` +
    `&return=${encodeURIComponent(BASE_URL + '/success?token=' + token)}` +
    `&cancel_return=${encodeURIComponent(BASE_URL + '/cancel')}` +
    `&custom=${token}`;

  res.json({ url: paypalUrl });
});

// ── Email subscribe ──
app.post('/api/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.json({ ok: false, error: 'Invalid email' });

  sendTelegram(`📧 <b>New subscriber</b>\nEmail: ${email}\nTime: ${new Date().toLocaleString()}`);

  // In a real setup you'd store this in a DB or Mailchimp
  // For now it just notifies you on Telegram
  console.log(`New subscriber: ${email}`);
  res.json({ ok: true });
});

// ── Health check ──
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PayPal: ${PAYPAL_EMAIL}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Telegram alerts: ${TG_BOT_TOKEN ? 'enabled' : 'DISABLED — set TG_BOT_TOKEN and TG_CHAT_ID'}`);
});
