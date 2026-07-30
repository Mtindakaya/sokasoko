const express = require('express');
const router = express.Router();

// Publicly-accessible legal documents. Served as plain HTML from the same
// origin as the API so Play Console + iOS App Store have a stable URL.
// Not versioned under /v1 — legal endpoints should have permanent paths.

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SokaSoko — Privacy Policy</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 780px; margin: 40px auto; padding: 0 20px; line-height: 1.6;
      color: #222; }
    h1 { color: #6D4C41; }
    h2 { color: #5D4037; margin-top: 32px; }
    .updated { color: #888; font-size: 13px; margin-bottom: 24px; }
    ul { padding-left: 22px; }
    a { color: #6D4C41; }
    code { background: #f4f4f4; padding: 1px 5px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>SokaSoko — Privacy Policy</h1>
  <p class="updated">Last updated: 2026-07-30</p>

  <p>SokaSoko ("we", "us", "the app") is a football community platform serving
  players, coaches, scouts, academies, referees, and agents in Tanzania. This
  policy explains what personal information we collect, why we collect it,
  how it is used, and what rights you have over your information.</p>

  <p>By creating a SokaSoko account or using the app you agree to this policy.
  If you do not agree, please do not create an account.</p>

  <h2>1. Information we collect</h2>
  <p>To provide the SokaSoko service we collect the following categories of
  personal information:</p>
  <ul>
    <li><b>Identity information</b>: first name, middle name, last name, gender,
      date of birth, nationality.</li>
    <li><b>Contact information</b>: phone number, email address (optional),
      social handles (optional).</li>
    <li><b>Location information</b>: region, district, ward, and street of
      residence. We do <b>not</b> collect precise GPS or continuous location.</li>
    <li><b>Football profile information</b>: playing position, preferred foot,
      height, weight, team or academy affiliation, jersey number, licence
      information (for referees, coaches, agents).</li>
    <li><b>Media and content</b>: profile image, uploaded photos and videos,
      posts and comments you create.</li>
    <li><b>Communications</b>: direct messages, group chat messages,
      messages to the Ismaili AI assistant.</li>
    <li><b>Activity data</b>: match schedules, results, player statistics,
      scout evaluations, endorsements, advisory knowledge you contribute.</li>
    <li><b>Technical information</b>: device model, app version, IP address
      at the time of a request, error logs.</li>
  </ul>

  <p>We do <b>not</b> collect: precise GPS location, contact lists, browsing
  history outside SokaSoko, financial account numbers, biometric data,
  political opinions, religious beliefs, or health information.</p>

  <h2>2. How we use your information</h2>
  <ul>
    <li>To provide account access and personalise your experience.</li>
    <li>To connect you with other users (teammates, coaches, scouts,
      opposing teams) for matches, evaluations, and messaging.</li>
    <li>To display your football profile, statistics, and evaluations to
      users who are permitted to view them (e.g. scouts you have approved).</li>
    <li>To deliver AI assistance through Ismaili, our football knowledge
      assistant, which processes your messages to generate replies.</li>
    <li>To send you in-app notifications about matches, evaluations,
      invitations, and messages.</li>
    <li>To improve the app, detect abuse, and diagnose technical issues.</li>
    <li>To comply with legal obligations under Tanzania law.</li>
  </ul>

  <h2>3. Who we share information with</h2>
  <p>SokaSoko shares your information only with the following categories of
  recipients, and only for the purposes described:</p>
  <ul>
    <li><b>Other SokaSoko users</b>. Your public profile (name, position,
      photo, team, statistics) is visible to other users based on your role
      and privacy settings. Direct messages are visible only to the sender
      and the recipient.</li>
    <li><b>Service providers</b>. We use Render (hosting), Amazon Web
      Services (media storage via CloudFront), MongoDB Atlas (database), and
      Anthropic (LLM inference for the Ismaili AI assistant). These
      providers process data on our behalf under contractual data-protection
      obligations.</li>
    <li><b>Law enforcement or regulators</b>. We may disclose information
      where legally required, such as pursuant to a valid court order under
      Tanzania law.</li>
  </ul>
  <p>We do <b>not</b> sell your personal information to advertisers or data
  brokers.</p>

  <h2>4. AI assistant (Ismaili)</h2>
  <p>Messages you send to the Ismaili AI assistant are transmitted to
  Anthropic (our LLM provider) for the sole purpose of generating a reply.
  We store the conversation history locally in our database so Ismaili can
  reference past turns. If you consent, individual exchanges may be included
  (anonymised) in our football knowledge base to improve future replies.
  Consent is opt-in per message.</p>

  <h2>5. Children and guardians</h2>
  <p>SokaSoko is designed for football participants of all ages. Users
  under 13 may only use the app under a registered guardian account. The
  guardian is responsible for the child's participation and for reviewing
  what the child shares in the app.</p>

  <h2>6. Data retention</h2>
  <p>We retain your personal information for as long as your account is
  active. If you delete your account, we retain limited records
  (e.g. match records you took part in, evaluations written about you) for
  operational and record-keeping purposes for up to 24 months, after which
  they are deleted or anonymised.</p>

  <h2>7. Your rights</h2>
  <p>Under Tanzania's Personal Data Protection Act, 2022, you have the
  right to:</p>
  <ul>
    <li>Access the personal information we hold about you.</li>
    <li>Request correction of inaccurate information.</li>
    <li>Request deletion of your account and associated data.</li>
    <li>Object to processing in certain circumstances.</li>
    <li>Lodge a complaint with the Personal Data Protection Commission of
      Tanzania.</li>
  </ul>
  <p>To exercise any of these rights, contact us using the details in
  Section 10.</p>

  <h2>8. Security</h2>
  <p>All communication between the SokaSoko app and our servers is
  encrypted in transit using HTTPS/TLS. Passwords are stored as hashed
  values, not in plain text. Media stored in cloud storage is served via
  signed URLs. We restrict internal access to personal information to
  authorised personnel only.</p>
  <p>No system is completely secure. If you become aware of unauthorised
  access to your account, please contact us immediately.</p>

  <h2>9. Changes to this policy</h2>
  <p>We may update this Privacy Policy from time to time. When we do, we
  will update the "Last updated" date at the top of this page. If changes
  are material, we will also notify you in the app.</p>

  <h2>10. Contact us</h2>
  <p>If you have questions about this policy or how your information is
  handled, contact SokaSoko at:</p>
  <ul>
    <li>Email: <a href="mailto:privacy@sokasoko.com">privacy@sokasoko.com</a></li>
    <li>Country of operation: United Republic of Tanzania</li>
  </ul>

  <p style="color:#888;font-size:12px;margin-top:40px">
    Governing law: laws of the United Republic of Tanzania.
    Regulator: Personal Data Protection Commission of Tanzania.
  </p>
</body>
</html>`;

const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SokaSoko — Terms of Service</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 780px; margin: 40px auto; padding: 0 20px; line-height: 1.6;
      color: #222; }
    h1 { color: #6D4C41; }
    h2 { color: #5D4037; margin-top: 32px; }
    .updated { color: #888; font-size: 13px; margin-bottom: 24px; }
    a { color: #6D4C41; }
  </style>
</head>
<body>
  <h1>SokaSoko — Terms of Service</h1>
  <p class="updated">Last updated: 2026-07-30</p>
  <p>These Terms govern your use of the SokaSoko app. By using SokaSoko
  you agree to these Terms.</p>

  <h2>1. Eligibility</h2>
  <p>You must be at least 13 years old, or use SokaSoko under a registered
  guardian account.</p>

  <h2>2. Your account</h2>
  <p>You are responsible for keeping your login credentials secure and for
  activity that occurs under your account. Do not share your password.</p>

  <h2>3. Acceptable use</h2>
  <p>Do not use SokaSoko to harass, defame, or endanger other users; do not
  post illegal, obscene, or harmful content; do not attempt to disrupt the
  service; do not create fake accounts or impersonate others.</p>

  <h2>4. User content</h2>
  <p>You retain ownership of content you create. You grant SokaSoko a
  limited licence to store and display that content as needed to operate
  the service.</p>

  <h2>5. Service changes and termination</h2>
  <p>We may modify or discontinue features at any time. We may suspend or
  terminate accounts that violate these Terms.</p>

  <h2>6. Disclaimer</h2>
  <p>SokaSoko is provided "as is". We do not guarantee uninterrupted
  operation. To the maximum extent permitted by law, we disclaim all
  warranties.</p>

  <h2>7. Governing law</h2>
  <p>These Terms are governed by the laws of the United Republic of
  Tanzania.</p>

  <h2>8. Contact</h2>
  <p><a href="mailto:support@sokasoko.com">support@sokasoko.com</a></p>
</body>
</html>`;

router.get('/privacy', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(PRIVACY_HTML);
});

router.get('/terms', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(TERMS_HTML);
});

module.exports = router;
