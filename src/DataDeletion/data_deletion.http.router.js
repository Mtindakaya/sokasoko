const express = require('express');
const DeletionRequest = require('./deletion_request.model');

const router = express.Router();

// Publicly accessible so Play Console's data-deletion URL requirement
// is satisfied. Both routes are unauthenticated on purpose — the form
// is meant to be reachable by any user, including one who has already
// lost access to their account.

const PAGE_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #f5f0eb;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #212121;
    padding: 24px;
    line-height: 1.4;
  }
  .card {
    max-width: 640px;
    margin: 0 auto;
    background: #fff;
    border-radius: 12px;
    padding: 32px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.06);
  }
  h1 { color: #5D4037; font-size: 24px; margin-bottom: 8px; }
  h2 { color: #6D4C41; font-size: 16px; margin-top: 24px; margin-bottom: 12px; }
  p.lead { color: #555; font-size: 14px; margin-bottom: 20px; }
  p.sw { color: #6D4C41; font-style: italic; font-size: 13px; margin-bottom: 8px; }
  label { display: block; font-weight: 600; color: #5D4037; margin-bottom: 6px; font-size: 13px; }
  input, textarea, select {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    background: #fafafa;
  }
  input:focus, textarea:focus, select:focus {
    outline: none;
    border-color: #5D4037;
    background: #fff;
  }
  textarea { min-height: 100px; resize: vertical; }
  .field { margin-bottom: 16px; }
  button {
    width: 100%;
    padding: 14px;
    background: #5D4037;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    letter-spacing: 0.4px;
    margin-top: 12px;
  }
  button:hover { background: #4E342E; }
  .success {
    background: #E8F5E9;
    border-left: 4px solid #43A047;
    padding: 16px;
    border-radius: 6px;
    color: #1B5E20;
  }
  .error {
    background: #FFEBEE;
    border-left: 4px solid #C62828;
    padding: 16px;
    border-radius: 6px;
    color: #B71C1C;
  }
  .brand { text-align: center; margin-bottom: 8px; font-size: 22px; font-weight: 800; color: #5D4037; letter-spacing: 0.5px; }
`;

const renderForm = (opts = {}) => {
  const errorHtml = opts.error
    ? `<div class="error" style="margin-bottom:16px">${opts.error}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="sw">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SokaSoko · Ombi la Kufuta Data · Data Deletion Request</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="card">
  <div class="brand">SokaSoko</div>
  <h1>Ombi la Kufuta Data</h1>
  <p class="lead" style="color:#5D4037; font-weight:600">Data Deletion Request</p>
  ${errorHtml}
  <p class="sw">Tuma ombi la kufuta akaunti au sehemu ya data yako. Tunajibu ndani ya siku 7.</p>
  <p class="lead">Use this form to request deletion of your account or specific data. We respond within 7 days.</p>

  <form method="POST" action="/delete-account/submit">
    <div class="field">
      <label>Barua pepe · Email <span style="color:#C62828">*</span></label>
      <input type="email" name="email" required placeholder="you@example.com">
    </div>
    <div class="field">
      <label>Namba ya Akaunti · Account Number (TFH-…)</label>
      <input type="text" name="accountNumber" placeholder="TFH-P-A000000" autocomplete="off">
    </div>
    <div class="field">
      <label>Unataka kufuta nini? · What do you want deleted?</label>
      <select name="scope">
        <option value="ACCOUNT">Akaunti nzima · My entire account</option>
        <option value="POSTS_MEDIA">Machapisho na video pekee · Just posts &amp; media</option>
        <option value="CHAT_HISTORY">Historia ya mazungumzo · Just chat history</option>
        <option value="OTHER">Nyingine · Other (describe below)</option>
      </select>
    </div>
    <div class="field">
      <label>Maelezo ya ziada · Additional details (optional)</label>
      <textarea name="details" placeholder="Kama ni 'Nyingine', eleza. · If 'Other', describe here."></textarea>
    </div>
    <button type="submit">Tuma Ombi · Submit Request</button>
  </form>
</div>
</body>
</html>`;
};

const renderSuccess = () => `<!DOCTYPE html>
<html lang="sw">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Asante · Thank you · SokaSoko</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="card">
  <div class="brand">SokaSoko</div>
  <div class="success">
    <h2 style="margin-top:0;color:#1B5E20">Asante · Thank you</h2>
    <p class="sw" style="color:#1B5E20;font-style:normal">Ombi lako limepokelewa. Tutakushughulikia ndani ya siku 7 na kukujulisha kupitia barua pepe.</p>
    <p style="margin-top:8px">Your request has been received. We'll process it within 7 days and confirm via email.</p>
  </div>
  <p style="margin-top:24px;font-size:13px;color:#666">
    Iwapo unahitaji msaada wa haraka, wasiliana nasi kupitia SokaSoko Msaada.<br>
    For urgent help, contact SokaSoko Support via the app.
  </p>
</div>
</body>
</html>`;

// Public form. NOTE: this router is mounted at the app root (no /v1),
// so the URL is a clean sokasoko.onrender.com/delete-account — that's
// what goes into Play Console's data-deletion field.
router.get('/delete-account', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderForm());
});

router.post(
  '/delete-account/submit',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email) {
        return res
          .status(400)
          .set('Content-Type', 'text/html; charset=utf-8')
          .send(renderForm({ error: 'Barua pepe inahitajika · Email is required.' }));
      }
      const scopeRaw = String(req.body.scope || 'ACCOUNT');
      const scope = ['ACCOUNT', 'POSTS_MEDIA', 'CHAT_HISTORY', 'OTHER'].includes(scopeRaw)
        ? scopeRaw
        : 'ACCOUNT';
      await DeletionRequest.create({
        email,
        accountNumber: String(req.body.accountNumber || '').trim(),
        scope,
        details: String(req.body.details || '').trim(),
        source: 'WEB',
        ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(),
        userAgent: (req.headers['user-agent'] || '').toString().slice(0, 500),
      });
      return res
        .status(200)
        .set('Content-Type', 'text/html; charset=utf-8')
        .send(renderSuccess());
    } catch (err) {
      console.error('deletion-request submit failed:', err.message);
      return res
        .status(500)
        .set('Content-Type', 'text/html; charset=utf-8')
        .send(
          renderForm({
            error:
              'Kuna hitilafu upande wetu. Jaribu tena baadaye. · Server error. Please try again shortly.',
          }),
        );
    }
  },
);

module.exports = router;
