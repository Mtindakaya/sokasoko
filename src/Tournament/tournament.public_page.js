// Public spectator page for SokaSoko 360 tournaments — no auth
// required. Renders as plain HTML so any browser (parents,
// journalists, sponsors) can read the standings + bracket without
// installing the app or signing in.
//
// Mounted at GET /tournaments/:id/public.

const Tournament = require('./tournament.model');
const Match = require('../Match/match.model');
const User = require('../User/user.model');
const { computeStandingsFor } = require('./tournament.fixtures');

function _escape(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function _teamName(u) {
  if (!u) return '—';
  const name = (u.academyName || u.academy_name ||
    `${u.firstName || ''} ${u.lastName || ''}`.trim()) || '—';
  return _escape(name);
}

async function renderPublicPage(tournamentId) {
  const t = await Tournament.findById(tournamentId)
    .populate('organizer', 'academyName firstName lastName')
    .lean();
  if (!t) return { status: 404, html: '<h1>Tournament not found</h1>' };
  if (!t.isPublished && !(t.premiumBundle === 'FULL_360' && t.premiumActivated)) {
    return { status: 404, html: '<h1>Tournament not published</h1>' };
  }
  const [fixtures, standings] = await Promise.all([
    Match.find({ tournament: t._id })
      .populate('homeTeam', 'academyName firstName lastName')
      .populate('awayTeam', 'academyName firstName lastName')
      .sort({ stage: 1, scheduledDate: 1, bracketPosition: 1 })
      .lean(),
    computeStandingsFor(t._id),
  ]);

  // Team-name lookup for standings rows (they only hold IDs).
  const teamIds = [...new Set(standings.map((r) => r.team))];
  const teamDocs = await User.find({ _id: { $in: teamIds } })
    .select('academyName academy_name firstName lastName')
    .lean();
  const teamName = new Map(teamDocs.map((u) => [u._id.toString(),
    _teamName(u)]));

  // Group fixtures by (category, stage, groupName).
  const fxGroups = new Map();
  for (const m of fixtures) {
    const cat = m.category || {};
    const k = `${cat.gender || ''}|${cat.ageGroup || ''}|${m.stage || ''}|${m.groupName || ''}`;
    if (!fxGroups.has(k)) fxGroups.set(k, []);
    fxGroups.get(k).push(m);
  }

  // Group standings by (category, group).
  const stGroups = new Map();
  for (const r of standings) {
    const cat = r.category || {};
    const k = `${cat.gender}|${cat.ageGroup}|${r.group}`;
    if (!stGroups.has(k)) stGroups.set(k, []);
    stGroups.get(k).push(r);
  }

  const logo = t.logoUrl
    ? `<img src="${_escape(t.logoUrl)}" alt="Logo" class="logo">` : '';
  const host = t.hostLogoUrl
    ? `<img src="${_escape(t.hostLogoUrl)}" alt="Host" class="host">` : '';

  let standingsHtml = '';
  for (const [k, rows] of stGroups.entries()) {
    const [g, a, gr] = k.split('|');
    standingsHtml += `
      <h3>${_escape(g)} ${_escape(a)} — Group ${_escape(gr)}</h3>
      <table class="table">
        <thead><tr>
          <th>#</th><th>Team</th>
          <th>P</th><th>W</th><th>D</th><th>L</th>
          <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
        </tr></thead>
        <tbody>
    `;
    rows.forEach((r, i) => {
      const rank = i + 1;
      const cls = rank <= 2 ? 'qualifier' : '';
      standingsHtml += `<tr class="${cls}">
        <td>${rank}</td>
        <td>${teamName.get(r.team) || _escape(r.team)}</td>
        <td>${r.played}</td>
        <td>${r.won}</td>
        <td>${r.drawn}</td>
        <td>${r.lost}</td>
        <td>${r.gf}</td>
        <td>${r.ga}</td>
        <td>${r.gd}</td>
        <td><b>${r.points}</b></td>
      </tr>`;
    });
    standingsHtml += '</tbody></table>';
  }

  let fixturesHtml = '';
  for (const [k, rows] of fxGroups.entries()) {
    const [g, a, st, gr] = k.split('|');
    const label = st === 'GROUP'
      ? `${_escape(g)} ${_escape(a)} — Group ${_escape(gr)}`
      : `${_escape(g)} ${_escape(a)} — ${_escape(st.replace('_', ' '))}`;
    fixturesHtml += `<h3>${label}</h3><div class="fixtures">`;
    for (const m of rows) {
      const done = m.status === 'COMPLETED';
      const score = done
        ? `<span class="score">${m.homeScore} - ${m.awayScore}</span>`
        : `<span class="v">v</span>`;
      fixturesHtml += `<div class="fx">
        <span class="home">${_teamName(m.homeTeam)}</span>
        ${score}
        <span class="away">${_teamName(m.awayTeam)}</span>
      </div>`;
    }
    fixturesHtml += '</div>';
  }

  const premiumBadge = t.premiumBundle === 'FULL_360' && t.premiumActivated
    ? '<span class="badge premium">SokaSoko 360 · Live</span>' : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${_escape(t.name)} — SokaSoko</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 820px; margin: 0 auto; padding: 20px;
      color: #222; background: #fafafa; line-height: 1.5;
    }
    header { display: flex; align-items: center; gap: 16px;
      padding-bottom: 16px; border-bottom: 2px solid #eee; }
    .logo { width: 72px; height: 72px; border-radius: 8px;
      object-fit: cover; border: 1px solid #ddd; }
    .host { width: 48px; height: 48px; border-radius: 6px;
      object-fit: cover; border: 1px solid #ddd; margin-left: auto; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    .meta { color: #888; font-size: 13px; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 10px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.3px; }
    .badge.premium { background: #FFC107; color: white; margin-top: 6px; }
    h2 { margin-top: 32px; font-size: 18px; color: #6D4C41; }
    h3 { margin-top: 24px; font-size: 14px; color: #555; font-weight: 700; }
    .table { width: 100%; border-collapse: collapse; margin-top: 8px;
      background: white; border-radius: 6px; overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .table th, .table td { padding: 6px 8px; text-align: center;
      font-size: 12px; }
    .table th { background: #f5f5f5; font-weight: 700; }
    .table td:nth-child(2) { text-align: left; }
    .table tr.qualifier { background: rgba(76, 175, 80, 0.08); }
    .fixtures { display: grid; gap: 6px; margin-top: 8px; }
    .fx { display: grid; grid-template-columns: 1fr auto 1fr;
      align-items: center; gap: 12px; background: white; padding: 8px 12px;
      border-radius: 6px; font-size: 13px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .fx .home { text-align: right; }
    .fx .away { text-align: left; }
    .fx .score { font-weight: 700; padding: 2px 8px;
      background: rgba(109, 76, 65, 0.1); border-radius: 4px; }
    .fx .v { color: #aaa; font-size: 11px; }
    footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee;
      color: #888; font-size: 11px; text-align: center; }
  </style>
</head>
<body>
  <header>
    ${logo}
    <div>
      <h1>${_escape(t.name)}</h1>
      <div class="meta">${_escape(t.region || '')}${t.district ? ' · ' + _escape(t.district) : ''}</div>
      ${premiumBadge}
    </div>
    ${host}
  </header>

  ${standingsHtml ? '<h2>Majedwali · Standings</h2>' + standingsHtml : ''}
  ${fixturesHtml ? '<h2>Ratiba · Fixtures</h2>' + fixturesHtml : ''}
  ${!standingsHtml && !fixturesHtml ? '<p style="color:#888;text-align:center;padding:40px 0">Fixtures + standings will appear once matches begin.</p>' : ''}

  <footer>
    Powered by <b>SokaSoko</b> · Real-time tournament management for East African football.
  </footer>
</body>
</html>`;

  return { status: 200, html };
}

module.exports = { renderPublicPage };
