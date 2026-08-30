#!/usr/bin/env python3
"""Generate SUBSCRIPTION_PLANS.pdf — a client-ready deck showing every
SokaSoko subscription tier, price, feature cap, and payment channel.

Source of truth: src/Subscription/subscription.model.js. When prices or
caps move, re-run this script to regenerate the deck.

Run from the backend repo root:
  python3 scripts/generate_subscription_pdf.py

Output: SUBSCRIPTION_PLANS.pdf
"""

from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether,
)

OUT = Path('SUBSCRIPTION_PLANS.pdf')

# ---- Brand palette -----------------------------------------------------
BRAND      = colors.HexColor('#0D3C7A')  # SokaSoko blue
BRAND_DARK = colors.HexColor('#062454')
GOLD       = colors.HexColor('#C9A227')
PLATINUM   = colors.HexColor('#4B4F58')
STANDARD   = colors.HexColor('#6B7280')
ENT_PURPLE = colors.HexColor('#5B21B6')
LIGHT_BG   = colors.HexColor('#F3F4F6')
CHECK_GREEN = colors.HexColor('#059669')
CROSS_RED   = colors.HexColor('#9CA3AF')

# ---- Data — mirrors subscription.model.js ------------------------------

PRICES = {
    'PLAYER': {
        'STANDARD':  {'MONTHLY': 0,     'QUARTERLY': 0,     'BIANNUAL': 0},
        'GOLD':      {'MONTHLY': 5000,  'QUARTERLY': 10000, 'BIANNUAL': 20000},
        'PLATINUM':  {'MONTHLY': 10000, 'QUARTERLY': 25000, 'BIANNUAL': 40000},
    },
    'COACH': {
        'STANDARD':  {'MONTHLY': 0,     'QUARTERLY': 0,     'BIANNUAL': 0},
        'GOLD':      {'MONTHLY': 5000,  'QUARTERLY': 10000, 'BIANNUAL': 20000},
        'PLATINUM':  {'MONTHLY': 10000, 'QUARTERLY': 25000, 'BIANNUAL': 40000},
    },
    'ACADEMY': {
        'STANDARD':  {'MONTHLY': 0,      'QUARTERLY': 0,      'BIANNUAL': 0},
        'GOLD':      {'MONTHLY': 20000,  'QUARTERLY': 50000,  'BIANNUAL': 100000},
        'PLATINUM':  {'MONTHLY': 50000,  'QUARTERLY': 120000, 'BIANNUAL': 200000},
    },
    'CLUB': {
        'STANDARD':  {'MONTHLY': 20000,  'QUARTERLY': 50000,  'BIANNUAL': 100000},
        'GOLD':      {'MONTHLY': 50000,  'QUARTERLY': 120000, 'BIANNUAL': 200000},
        'PLATINUM':  {'MONTHLY': 100000, 'QUARTERLY': 250000, 'BIANNUAL': 500000},
    },
    'AGENT': {
        'STANDARD':   {'MONTHLY': 0,       'QUARTERLY': 0,       'BIANNUAL': 0},
        'GOLD':       {'MONTHLY': 100000,  'QUARTERLY': 250000,  'BIANNUAL': 500000},
        'ENTERPRISE': {'MONTHLY': None,    'QUARTERLY': None,    'BIANNUAL': None},
    },
    'SCOUT': {
        'PRO':       {'MONTHLY': 10000, 'QUARTERLY': 25000, 'BIANNUAL': 40000},
    },
    'VENDOR': {
        'STANDARD':   {'MONTHLY': 30000,   'QUARTERLY': 75000,   'BIANNUAL': 150000},
        'GOLD':       {'MONTHLY': 100000,  'QUARTERLY': 250000,  'BIANNUAL': 500000},
        'PLATINUM':   {'MONTHLY': 300000,  'QUARTERLY': 750000,  'BIANNUAL': 1500000},
        'ENTERPRISE': {'MONTHLY': None,    'QUARTERLY': None,    'BIANNUAL': None},
    },
    'REFEREE': {
        'MINOR':  {'MONTHLY': 5000,  'QUARTERLY': 10000, 'BIANNUAL': None},
        'ADULT':  {'MONTHLY': 10000, 'QUARTERLY': 25000, 'BIANNUAL': 40000},
    },
}

# Human-readable feature lists per (userType, tier). Curated for the
# reader — engineering-only caps like fair-use hourly limits are omitted.
FEATURES = {
    'PLAYER': {
        'STANDARD': [
            'Home feed, chat, discover',
            'Guardian linking',
            '1 report / month',
            '3 evaluations received / month (beta)',
            'Cannot request evaluations, no AI',
        ],
        'GOLD': [
            '5 reports / month',
            '10 evaluations received / month',
            '2 evaluation requests initiated / month',
            'Share evaluations with your team',
            'AI queries — 100 / month',
            'Join challenges',
        ],
        'PLATINUM': [
            'Unlimited reports (fair-use)',
            'Unlimited evaluations received + shared',
            'Unlimited evaluation requests',
            'AI queries — unlimited (fair-use)',
            'Priority placement, challenges, badges',
        ],
    },
    'COACH': {
        'STANDARD': [
            'Manage 1 team',
            'AI — 30 queries / month',
            'Cannot post trials, tournaments, or scout',
            '30-day auto-Gold trial from signup',
        ],
        'GOLD': [
            'Post trials, tournaments, clinics',
            'Add scouts to your matches',
            'Player reports — 10 generated + 20 queries / month',
            'AI — 200 / month',
            'Official scouting eligibility',
        ],
        'PLATINUM': [
            'Manage unlimited teams',
            'Unlimited reports + tournaments',
            'Team + Market shortlist reports',
            'AI — unlimited (fair-use)',
            'National reach, featured placement, analytics',
        ],
    },
    'ACADEMY': {
        'STANDARD': [
            '1 age level, single-gender roster',
            'AI — 30 / month',
            '5 home-feed posts / month',
            'No trials, tournaments, or scouting requests',
            '30-day auto-Gold trial from signup',
        ],
        'GOLD': [
            '3 age levels, mixed gender rosters',
            'Post trials + tournaments (up to 8 teams)',
            'Request scouting for your matches',
            'Post clinics; 3 staff seats',
            'AI — 200 / month; 10 reports + 20 queries / month',
        ],
        'PLATINUM': [
            'Unlimited age levels + roster size',
            'Unlimited trials + tournaments',
            'Doc-vetting service included',
            'Monthly academy report + advanced analytics',
            'National reach + featured placement',
            '5 staff seats; AI unlimited (fair-use)',
        ],
    },
    'CLUB': {
        'STANDARD': [
            'CLUB Standard is paid — no free floor',
            '1 age level, single-gender roster',
            'AI — 30 / month · 5 posts / month',
            'No trials, tournaments, or scouting',
            '30-day auto-Gold trial from signup',
        ],
        'GOLD': [
            '3 age levels, mixed gender rosters',
            'Trials + tournaments (up to 8 teams)',
            'Request scouting for matches',
            'Post clinics; 3 staff seats',
            'AI — 200 / month',
        ],
        'PLATINUM': [
            'Unlimited age levels + rosters',
            'Unlimited trials + tournaments',
            'Doc-vetting included; monthly club report',
            'Advanced analytics + national reach',
            '5 staff seats; AI unlimited (fair-use)',
        ],
    },
    'AGENT': {
        'STANDARD': [
            'Locked-out state — nothing enabled',
            '30-day auto-Gold trial from signup then Standard',
        ],
        'GOLD': [
            'Post trials + request scouting',
            'View player evaluations',
            'Generate player reports — 10 / month',
            'AI — 200 / month, 20 queries / month',
        ],
        'ENTERPRISE': [
            'Team + Market + Custom Analysis reports',
            'Unlimited reports, evaluations, queries',
            'AI unlimited (fair-use)',
            'Monthly agent report, featured placement',
            'National reach; pricing negotiated per account',
        ],
    },
    'SCOUT': {
        'PRO': [
            'Only tier — no free plan for scouts',
            'Match-assignment eligibility',
            'Perform player evaluations',
            'File official scout reports',
            'Appears in SokaSoko Pendekeza (weighted by evals + training)',
        ],
    },
    'VENDOR': {
        'STANDARD': [
            '5 product listings',
            '2 promo slots / month · 5 home-feed posts / month',
            'No ads in home feed, no concurrent adverts',
            'Local reach only; basic analytics',
            '30-day auto-Gold trial from signup',
        ],
        'GOLD': [
            '25 product listings',
            '5 promo slots + 1 flash sale / month',
            '2 concurrent adverts in home feed',
            'Regional reach; basic analytics',
        ],
        'PLATINUM': [
            '100 product listings',
            '15 promo slots + 4 flash sales / month',
            '6 concurrent adverts',
            'Featured in vendor directory',
            'Priority SokaSoko house-account slot',
            'National reach; advanced analytics',
        ],
        'ENTERPRISE': [
            'Unlimited listings + promo slots + adverts',
            'Broadcast-to-all-accounts privilege',
            'Guaranteed SokaSoko house-account slot',
            'Advanced analytics with export',
            'National reach; pricing negotiated per account',
        ],
    },
    'REFEREE': {
        'MINOR': [
            'Under-18 referees',
            'Match-assignment eligibility',
            'Server auto-picks MINOR based on DOB — user does not choose',
            'Free-game trial via game-count threshold',
        ],
        'ADULT': [
            '18+ referees',
            'Match-assignment eligibility',
            'Server auto-picks ADULT based on DOB — user does not choose',
            'Free-game trial via game-count threshold',
        ],
    },
}

# Free-plan / trial context per userType.
CONTEXT = {
    'PLAYER':  'Standard is free · Gold and Platinum unlock evaluations, reports, and AI.',
    'COACH':   '30-day auto-Gold trial from signup · Standard is free floor · Gold + Platinum unlock scouting and reports.',
    'ACADEMY': '30-day auto-Gold trial from signup · Standard is free floor · Gold enables trials/tournaments, Platinum adds doc-vetting + national reach.',
    'CLUB':    '30-day auto-Gold trial from signup · Standard is PAID (no free floor for clubs).',
    'AGENT':   '30-day auto-Gold trial from signup · Standard = locked-out state after trial · Gold + Enterprise for real access.',
    'SCOUT':   'No free tier — unsubscribed scouts cannot be booked, evaluate, or file reports.',
    'VENDOR':  '30-day auto-Gold trial from signup · four tiers based on ad reach + product volume.',
    'REFEREE': 'Age-gated — server picks MINOR (<18) or ADULT (18+) from DOB. Free game-count trial before subscription is required.',
}

USER_TYPE_ORDER = ['PLAYER', 'COACH', 'ACADEMY', 'CLUB', 'AGENT', 'SCOUT', 'VENDOR', 'REFEREE']

TIER_COLORS = {
    'STANDARD':   STANDARD,
    'GOLD':       GOLD,
    'PLATINUM':   PLATINUM,
    'ENTERPRISE': ENT_PURPLE,
    'PRO':        BRAND,
    'MINOR':      colors.HexColor('#0891B2'),
    'ADULT':      colors.HexColor('#0E7490'),
}

PLAN_ORDER = ['MONTHLY', 'QUARTERLY', 'BIANNUAL']
PLAN_LABEL = {'MONTHLY': 'Monthly', 'QUARTERLY': 'Quarterly', 'BIANNUAL': 'Bi-annual (6 mo)'}

# ---- Payment channels --------------------------------------------------
PAYMENTS = [
    ('M-Pesa',    'Vodacom mobile money — auto-verified via reference number.',      'Instant'),
    ('Selcom',    'Aggregator — cards, banks, Halopesa, Airtel Money, Tigo Pesa.',    'Instant'),
    ('AzamPay',   'Aggregator — cards + mobile money across all networks.',            'Instant'),
    ('Manual',    'Bank transfer, cash deposit, admin activation.',                    'Reviewed by SokaSoko admin, 24–48h'),
    ('Card',      'Visa / Mastercard direct — for international users.',               'Instant (via Selcom / AzamPay)'),
    ('PayPal',    'International PayPal — currency conversion to TZS.',                'Instant, when enabled'),
    ('Google Pay','Google Pay wallet (Android) — pending Play Console classification.', 'Deferred'),
]


# ---- Style helpers -----------------------------------------------------

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    'title', parent=styles['Title'], fontName='Helvetica-Bold',
    fontSize=26, leading=32, textColor=BRAND_DARK, alignment=TA_CENTER,
    spaceAfter=8,
)
subtitle_style = ParagraphStyle(
    'subtitle', parent=styles['Normal'], fontSize=12, leading=16,
    textColor=colors.HexColor('#4B5563'), alignment=TA_CENTER,
    spaceAfter=24,
)
section_style = ParagraphStyle(
    'section', parent=styles['Heading1'], fontName='Helvetica-Bold',
    fontSize=18, leading=22, textColor=BRAND_DARK, spaceBefore=6,
    spaceAfter=6,
)
subsection_style = ParagraphStyle(
    'subsection', parent=styles['Heading2'], fontName='Helvetica-Bold',
    fontSize=13, leading=16, textColor=BRAND, spaceBefore=8, spaceAfter=4,
)
body_style = ParagraphStyle(
    'body', parent=styles['Normal'], fontSize=10, leading=13,
    textColor=colors.HexColor('#1F2937'),
)
context_style = ParagraphStyle(
    'context', parent=body_style, fontSize=10, leading=14,
    textColor=colors.HexColor('#374151'), spaceAfter=8,
    fontName='Helvetica-Oblique',
)
feature_style = ParagraphStyle(
    'feature', parent=body_style, fontSize=9, leading=12,
    textColor=colors.HexColor('#111827'), leftIndent=6,
)
footer_style = ParagraphStyle(
    'footer', parent=body_style, fontSize=8, leading=10,
    textColor=colors.HexColor('#6B7280'), alignment=TA_CENTER,
)


def fmt_tzs(n):
    if n is None:
        return 'Contact us'
    if n == 0:
        return 'FREE'
    return f'TSh {n:,}'


def tier_badge(tier):
    color = TIER_COLORS.get(tier, BRAND)
    return Paragraph(
        f'<font color="white"><b>&nbsp;{tier}&nbsp;</b></font>',
        ParagraphStyle(
            f'badge_{tier}', parent=body_style, fontSize=11,
            leading=14, backColor=color, borderPadding=(2, 6, 2, 6),
            alignment=TA_CENTER, textColor=colors.white,
        ),
    )


# ---- Page builders -----------------------------------------------------

def cover(story):
    story.append(Spacer(1, 40 * mm))
    story.append(Paragraph('SokaSoko', title_style))
    story.append(Paragraph('Subscription Plans & Payment Guide',
                           ParagraphStyle('cover_sub', parent=subtitle_style,
                                          fontSize=16, leading=20,
                                          textColor=BRAND)))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(
        'Full tier catalog for every account type, priced in Tanzanian '
        'Shillings, plus payment channels and onboarding trials. Source '
        'of truth: platform subscription model as of the generation date.',
        subtitle_style,
    ))
    story.append(Spacer(1, 8 * mm))
    # Summary tile row.
    summary = [
        ['8 account types', '3 pricing tiers', '3 billing cycles', '7 payment channels'],
        ['Player · Coach · Academy · Club · Agent · Scout · Vendor · Referee',
         'Standard · Gold · Platinum (+Enterprise for Agent & Vendor)',
         'Monthly · Quarterly · Bi-annual (6-month)',
         'M-Pesa · Selcom · AzamPay · Manual · Card · PayPal · Google Pay'],
    ]
    t = Table(summary, colWidths=[45 * mm] * 4)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BRAND),
        ('TEXTCOLOR',  (0, 0), (-1, 0), colors.white),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE',   (0, 0), (-1, 0), 11),
        ('ALIGN',      (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTSIZE',   (0, 1), (-1, 1), 8),
        ('TEXTCOLOR',  (0, 1), (-1, 1), colors.HexColor('#374151')),
        ('BACKGROUND', (0, 1), (-1, 1), LIGHT_BG),
        ('BOX',        (0, 0), (-1, -1), 0.6, BRAND),
        ('INNERGRID',  (0, 0), (-1, -1), 0.4, colors.white),
        ('TOPPADDING',    (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(t)
    story.append(PageBreak())


def user_type_page(story, user_type):
    story.append(Paragraph(user_type, section_style))
    story.append(Paragraph(CONTEXT[user_type], context_style))

    tiers = list(PRICES[user_type].keys())

    # Price grid.
    header = [Paragraph('<b>Tier</b>', body_style)] + [
        Paragraph(f'<b>{PLAN_LABEL[p]}</b>', body_style) for p in PLAN_ORDER
    ]
    rows = [header]
    for tier in tiers:
        row = [tier_badge(tier)]
        for plan in PLAN_ORDER:
            price = PRICES[user_type][tier].get(plan)
            row.append(Paragraph(f'<b>{fmt_tzs(price)}</b>', body_style))
        rows.append(row)

    price_table = Table(rows, colWidths=[42 * mm, 44 * mm, 44 * mm, 44 * mm])
    price_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BRAND_DARK),
        ('TEXTCOLOR',  (0, 0), (-1, 0), colors.white),
        ('ALIGN',      (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX',        (0, 0), (-1, -1), 0.6, BRAND_DARK),
        ('INNERGRID',  (0, 0), (-1, -1), 0.3, colors.HexColor('#D1D5DB')),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BACKGROUND',    (0, 1), (-1, -1), LIGHT_BG),
    ]))
    story.append(price_table)
    story.append(Spacer(1, 10 * mm))

    # Feature blocks per tier.
    for tier in tiers:
        feats = FEATURES[user_type].get(tier, [])
        if not feats:
            continue
        block_rows = [[tier_badge(tier)]]
        for line in feats:
            block_rows.append([Paragraph(f'• {line}', feature_style)])
        t = Table(block_rows, colWidths=[172 * mm])
        style_cmds = [
            ('BACKGROUND', (0, 0), (0, 0), TIER_COLORS.get(tier, BRAND)),
            ('ALIGN',      (0, 0), (0, 0), 'LEFT'),
            ('LEFTPADDING',   (0, 0), (0, 0), 8),
            ('TOPPADDING',    (0, 0), (0, 0), 3),
            ('BOTTOMPADDING', (0, 0), (0, 0), 3),
            ('LEFTPADDING',   (0, 1), (0, -1), 12),
            ('BACKGROUND', (0, 1), (0, -1), colors.white),
            ('BOX',        (0, 0), (-1, -1), 0.4, colors.HexColor('#D1D5DB')),
        ]
        t.setStyle(TableStyle(style_cmds))
        story.append(KeepTogether([t, Spacer(1, 4 * mm)]))

    story.append(PageBreak())


def payments_page(story):
    story.append(Paragraph('Payment Channels', section_style))
    story.append(Paragraph(
        'SokaSoko accepts payment via mobile money, banks, cards, and '
        'admin-verified manual transfers. Confirmation time varies by '
        'channel — see the table below.',
        context_style,
    ))
    header = [
        Paragraph('<b>Channel</b>', body_style),
        Paragraph('<b>How it works</b>', body_style),
        Paragraph('<b>Confirmation</b>', body_style),
    ]
    rows = [header]
    for name, how, when in PAYMENTS:
        rows.append([
            Paragraph(f'<b>{name}</b>', body_style),
            Paragraph(how, body_style),
            Paragraph(when, body_style),
        ])
    t = Table(rows, colWidths=[35 * mm, 100 * mm, 40 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BRAND_DARK),
        ('TEXTCOLOR',  (0, 0), (-1, 0), colors.white),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX',        (0, 0), (-1, -1), 0.6, BRAND_DARK),
        ('INNERGRID',  (0, 0), (-1, -1), 0.3, colors.HexColor('#D1D5DB')),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('BACKGROUND',    (0, 1), (-1, -1), LIGHT_BG),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1),
            [LIGHT_BG, colors.white]),
    ]))
    story.append(t)
    story.append(Spacer(1, 10 * mm))

    # Auto-approve flag callout
    story.append(Paragraph('Test-mode note', subsection_style))
    story.append(Paragraph(
        'During closed beta, the backend flag <b>AUTO_APPROVE_PAYMENTS</b> '
        'is on — every submitted payment activates the subscription '
        'immediately without waiting for admin verification. This flag '
        'is turned off before public launch so Manual / Card payments '
        'flow through the normal review queue.',
        context_style,
    ))
    story.append(PageBreak())


def onboarding_page(story):
    story.append(Paragraph('Onboarding Trials & Discounts', section_style))
    trials = [
        ('COACH',   '30 days auto-Gold', 'From account creation. Reverts to Standard on day 31.'),
        ('ACADEMY', '30 days auto-Gold', 'From account creation. Reverts to Standard on day 31.'),
        ('CLUB',    '30 days auto-Gold', 'From account creation. Reverts to Standard (paid).'),
        ('AGENT',   '30 days auto-Gold', 'From account creation. Reverts to Standard (locked).'),
        ('VENDOR',  '30 days auto-Gold', 'From account creation. Reverts to Standard.'),
        ('REFEREE', 'Free game-count trial',
         'First N officiated games free; server enforces threshold before paywall.'),
    ]
    header = [
        Paragraph('<b>Account</b>', body_style),
        Paragraph('<b>Trial</b>', body_style),
        Paragraph('<b>How it works</b>', body_style),
    ]
    rows = [header]
    for a, b, c in trials:
        rows.append([Paragraph(a, body_style), Paragraph(b, body_style), Paragraph(c, body_style)])
    t = Table(rows, colWidths=[30 * mm, 45 * mm, 100 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BRAND_DARK),
        ('TEXTCOLOR',  (0, 0), (-1, 0), colors.white),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX',        (0, 0), (-1, -1), 0.6, BRAND_DARK),
        ('INNERGRID',  (0, 0), (-1, -1), 0.3, colors.HexColor('#D1D5DB')),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('BACKGROUND',    (0, 1), (-1, -1), LIGHT_BG),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [LIGHT_BG, colors.white]),
    ]))
    story.append(t)

    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph('Bundled account types', subsection_style))
    story.append(Paragraph(
        '<b>SCHOOL</b> is not subscription-eligible. Every school comes '
        'with a fixed budget of delegated sports-teacher seats, each '
        'running at COACH GOLD tier by default.<br/>'
        '<b>GUARDIAN</b> is not subscription-eligible either — a free '
        'tier with fixed caps (15 minors, 5 referee minors, no trials, '
        'no scheduling, own-minor player reports only).',
        body_style,
    ))
    story.append(PageBreak())


def summary_matrix(story):
    story.append(Paragraph('Price Matrix — All Types at a Glance', section_style))
    story.append(Paragraph(
        'Monthly price shown per tier per account type. Refer to individual '
        'pages for quarterly / bi-annual pricing and feature breakdowns.',
        context_style,
    ))
    header_row = ['Account', 'Standard', 'Gold', 'Platinum', 'Enterprise/Pro']
    rows = [header_row]
    for ut in USER_TYPE_ORDER:
        prices = PRICES[ut]
        row = [ut]
        # Try each canonical column against real tiers
        for tier in ['STANDARD', 'GOLD', 'PLATINUM']:
            if tier in prices:
                row.append(fmt_tzs(prices[tier]['MONTHLY']))
            else:
                row.append('—')
        # Enterprise / Pro / MINOR-ADULT bucket
        extras = []
        if 'ENTERPRISE' in prices:
            extras.append('Enterprise: ' + fmt_tzs(prices['ENTERPRISE']['MONTHLY']))
        if 'PRO' in prices:
            extras.append('Pro: ' + fmt_tzs(prices['PRO']['MONTHLY']))
        if 'MINOR' in prices:
            extras.append('Minor: ' + fmt_tzs(prices['MINOR']['MONTHLY']))
            extras.append('Adult: ' + fmt_tzs(prices['ADULT']['MONTHLY']))
        row.append('\n'.join(extras) if extras else '—')
        rows.append(row)
    t = Table(rows, colWidths=[26 * mm, 32 * mm, 32 * mm, 32 * mm, 50 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BRAND_DARK),
        ('TEXTCOLOR',  (0, 0), (-1, 0), colors.white),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE',   (0, 0), (-1, -1), 9),
        ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN',      (1, 1), (-1, -1), 'CENTER'),
        ('BOX',        (0, 0), (-1, -1), 0.6, BRAND_DARK),
        ('INNERGRID',  (0, 0), (-1, -1), 0.3, colors.HexColor('#D1D5DB')),
        ('TOPPADDING',    (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('BACKGROUND',    (0, 1), (0, -1), colors.HexColor('#E5E7EB')),
        ('FONTNAME',      (0, 1), (0, -1), 'Helvetica-Bold'),
        ('ROWBACKGROUNDS',(1, 1), (-1, -1), [colors.white, LIGHT_BG]),
    ]))
    story.append(t)
    story.append(PageBreak())


# ---- Assemble ----------------------------------------------------------

def build():
    doc = SimpleDocTemplate(
        str(OUT), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title='SokaSoko Subscription Plans',
        author='SokaSoko',
    )
    story = []
    cover(story)
    summary_matrix(story)
    for ut in USER_TYPE_ORDER:
        user_type_page(story, ut)
    payments_page(story)
    onboarding_page(story)
    # Footer note
    story.append(Paragraph(
        'Prices reflect the current platform configuration. For latest '
        'live numbers, see the subscription model in the backend '
        '(src/Subscription/subscription.model.js).',
        footer_style,
    ))

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#9CA3AF'))
        canvas.drawString(18 * mm, 10 * mm, 'SokaSoko — Subscription Plans')
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f'Page {doc.page}')
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    print(f'Wrote {OUT}')


if __name__ == '__main__':
    build()
