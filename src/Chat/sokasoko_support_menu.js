// SokaSoko Support — menu-driven help system.
//
// User DMs SokaSoko with "HELP" / "MSAADA" / "MENU" / "0" → this
// module returns the root menu. User picks a numbered area →
// submenu of questions. User picks a numbered question → canned
// answer. Any other text or "MHUDUMU" / "HUMAN" / "ADMIN"
// escalates to a live support agent.
//
// Content structure:
//   MENU.areas[<code>] = {
//     label: 'Kiswahili (English)',
//     questions: [
//       { id: 1, q: 'Kiswahili question (English)?', a: 'Answer' },
//       …
//     ],
//   }
//
// EVERYTHING BELOW IS PLACEHOLDER — meant to be edited by whoever
// runs support. Keep answers under 8-10 short lines each; if it's
// longer, the topic probably needs its own onboarding doc + a link.

const AREAS = [
  { code: 'PLAYER',       label: '1. Mchezaji (Player)' },
  { code: 'COACH',        label: '2. Kocha (Coach)' },
  { code: 'REFEREE',      label: '3. Mwamuzi (Referee)' },
  { code: 'SCOUT',        label: '4. Scout' },
  { code: 'ACADEMY',      label: '5. Akademi (Academy)' },
  { code: 'CLUB',         label: '6. Klabu (Club)' },
  { code: 'SCHOOL',       label: '7. Shule (School)' },
  { code: 'AGENT',        label: '8. Wakala (Agent)' },
  { code: 'SPONSOR',      label: '9. Mfadhili (Sponsor)' },
  { code: 'VENDOR',       label: '10. Mfanyabiashara (Vendor)' },
  { code: 'GUARDIAN',     label: '11. Mlezi (Guardian)' },
  { code: 'SUBSCRIPTION', label: '12. Uandikishaji (Subscription)' },
];

// Trigger words that reset to the root menu.
const TRIGGER_WORDS = new Set([
  'help', 'msaada', 'menyu', 'menu', '0', 'home', 'nyumbani',
]);

// Escalation words that clear the auto-flow and pass through to the
// human admin. "MHUDUMU" is the Kiswahili primary per user pick
// 2026-08-24. Kept English / Admin variants for tester convenience.
const ESCALATION_WORDS = new Set([
  'mhudumu', 'human', 'admin', 'msimamizi', 'agent',
]);

// Menu state auto-resets after this many minutes of inactivity so a
// stale menu context doesn't intercept a fresh question days later.
const STATE_TTL_MIN = 30;

const AREA_MENUS = {
  PLAYER: {
    label: 'MCHEZAJI (PLAYER)',
    questions: [
      {
        id: 1,
        q: 'Nikamilishe wasifu wangu vipi? / How do I complete my profile?',
        a: 'Nenda kwa Akaunti → Hariri Wasifu. Jaza sehemu zote za lazima: '
          + 'jina kamili, tarehe ya kuzaliwa, mkoa, nafasi ya mchezo, urefu, '
          + 'na uzito. Skauti hutafuta wachezaji walio na wasifu kamili.\n\n'
          + 'Go to Account → Edit Profile. Fill in all required fields: '
          + 'full name, date of birth, region, playing position, height, '
          + 'and weight. Scouts search for players with complete profiles.',
      },
      {
        id: 2,
        q: 'Ninawezaje kuweka video zangu? / How do I upload my videos?',
        a: 'Kwa sasa, tumia YouTube: pakia video yako kwenye YouTube, kisha '
          + 'nakili kiungo (link) na kiwek kwenye Akaunti → Machapisho '
          + 'Yangu. Uwezo wa kupakia moja kwa moja utaongezwa hivi karibuni.',
      },
      {
        id: 3,
        q: 'Skauti wanavipataje wachezaji? / How do scouts find players?',
        a: 'Skauti hutafuta kwa mkoa, umri, na nafasi ya mchezo. Wasifu '
          + 'wako kamili, video za ubora, na tathmini zilizothibitishwa '
          + 'huongeza uwezekano wa kuchaguliwa.',
      },
      {
        id: 4,
        q: 'Ninajiunga vipi na akademi? / How do I join an academy?',
        a: 'Akademi zenyewe ndizo huanzisha mchakato. Wakati akademi '
          + 'inakuomba, utapokea arifa kwenye Ujumbe wako — thibitisha '
          + 'au kataa kwenye Uhakiki.',
      },
      {
        id: 5,
        q: 'Nini maana ya kuthibitisha tathmini ya scout? / What does '
          + 'verifying a scout evaluation mean?',
        a: 'Scout anaweza kukuongeza kwenye CV yao ya uchakuzi. '
          + 'Utapokea arifa, kisha thibitisha kwenye Uhakiki. Tathmini '
          + 'zilizothibitishwa huonekana kwenye ripoti za PLATINUM.',
      },
    ],
  },
  COACH: {
    label: 'KOCHA (COACH)',
    questions: [
      {
        id: 1,
        q: 'Ninaongoza vipi timu yangu? / How do I manage my team?',
        a: 'Nenda Akaunti → Simamia Timu. Ongeza wachezaji, weka jezi '
          + 'nambari, ondoa wachezaji ambao wameondoka. Wachezaji wote '
          + 'lazima wakubali ombi kwanza.',
      },
      {
        id: 2,
        q: 'Ninaomba scout kwa mchezaji vipi? / How do I request a scout '
          + 'for a player?',
        a: 'Kwenye wasifu wa mchezaji, bofya Info Zaidi → Omba Scout. '
          + 'Chagua scout kutoka orodha. Kifurushi cha Gold/Platinum '
          + 'kinaruhusu maombi zaidi.',
      },
      {
        id: 3,
        q: 'Ninapanga mechi vipi? / How do I schedule a match?',
        a: 'Nenda Mechi Zangu → Omba Mechi. Chagua mpinzani, tarehe, na '
          + 'uwanja. Mpinzani lazima athibitishe. Kifurushi cha Gold '
          + 'kinaruhusu kuongeza skauti rasmi.',
      },
      {
        id: 4,
        q: 'Ninaongeza leseni yangu vipi? / How do I add my coaching license?',
        a: 'Akaunti → Hariri Wasifu → Kiwango cha Leseni. Chagua CAF A, '
          + 'CAF B, CAF C, D-License au TAFOCA. Wasifu wenye leseni '
          + 'huonekana kwa uwazi zaidi.',
      },
    ],
  },
  REFEREE: {
    label: 'MWAMUZI (REFEREE)',
    questions: [
      {
        id: 1,
        q: 'Ninakubalije ombi la kuwaamua mechi? / How do I accept a '
          + 'referee assignment?',
        a: 'Utapokea arifa kwenye Ujumbe. Bofya arifa, utapata Uhakiki. '
          + 'Bofya Kubali au Kataa. Baada ya kukubali, mechi inaonekana '
          + 'kwenye rekodi yako.',
      },
      {
        id: 2,
        q: 'Ninaona wapi mechi zangu za awali? / Where do I see my past '
          + 'matches?',
        a: 'Nenda Akaunti → Wasifu Wangu (CV). Utaona idadi ya mechi '
          + 'ulizoongoza + ukadiriaji wa kila mechi kutoka kwa makocha.',
      },
      {
        id: 3,
        q: 'Kwa nini nahitaji uandikishaji? / Why do I need a subscription?',
        a: 'Baada ya kuongoza mechi 10 za bure, unahitaji kifurushi cha '
          + 'MINOR (chini ya miaka 18) au ADULT ili kuendelea kupewa '
          + 'mechi. Kifurushi kinawezesha kupokea maombi.',
      },
    ],
  },
  SCOUT: {
    label: 'SCOUT',
    questions: [
      {
        id: 1,
        q: 'Ninaandika tathmini vipi? / How do I write an evaluation?',
        a: 'Baada ya mechi au trial, nenda Scout Hub → Tathmini. Jaza '
          + 'alama kwa kila sifa (Kimwili, Kiufundi, Kifikra) na maoni '
          + 'yako. Tathmini itaonekana kwenye CV ya scout wako.',
      },
      {
        id: 2,
        q: 'Ninaomba tathmini ya mchezaji vipi? / How do I request a '
          + 'player evaluation?',
        a: 'Bofya wasifu wa mchezaji → Info Zaidi → Ongeza CV ya '
          + 'Uchakuzi. Utapokea arifa akikubali.',
      },
      {
        id: 3,
        q: 'Ninastahili kupokea kazi rasmi? / Am I eligible for official '
          + 'scouting?',
        a: 'Unahitaji kifurushi cha PRO SCOUT. Bila hicho, huwezi '
          + 'kuongezwa kwenye mechi kama scout rasmi. Nenda Akaunti → '
          + 'Uandikishaji kujisajili.',
      },
    ],
  },
  ACADEMY: {
    label: 'AKADEMI (ACADEMY)',
    questions: [
      {
        id: 1,
        q: 'Ninajisajili vipi kama akademi? / How do I register as an '
          + 'academy?',
        a: 'Kwenye ukurasa wa kwanza wa usajili, chagua Akademi. Jaza '
          + 'jina la akademi, NSC Registration (hiari), na taarifa za '
          + 'kimsingi. Baada ya kusajili, ongeza wachezaji kutoka Akaunti.',
      },
      {
        id: 2,
        q: 'Ninaongeza wachezaji vipi? / How do I add players?',
        a: 'Akaunti → Wachezaji → +Ongeza. Tafuta mchezaji, tuma ombi. '
          + 'Mchezaji lazima athibitishe kabla ya kuonekana kwenye timu.',
      },
      {
        id: 3,
        q: 'Ninachapisha trial vipi? / How do I post a trial?',
        a: 'Talent ID → Trials → +Chapisha. Weka tarehe, umri, mahali, '
          + 'na maelekezo. Trial itaonekana kwa wachezaji wote wa umri '
          + 'unaostahili.',
      },
      {
        id: 4,
        q: 'Ninasimamia wafanyakazi wangu vipi? / How do I manage my staff?',
        a: 'Akaunti → ⋮ → Wafanyakazi. Alika kocha, meneja, au msimamizi '
          + 'mwingine. Idadi ya wafanyakazi inategemea kifurushi chako.',
      },
    ],
  },
  CLUB: {
    label: 'KLABU (CLUB)',
    questions: [
      {
        id: 1,
        q: 'Ninajisajili vipi kama klabu? / How do I register as a club?',
        a: 'Chagua Klabu wakati wa usajili. Jaza jina la klabu, mwaka wa '
          + 'kuanzishwa (Founded Year), daraja (Premier League, '
          + 'Championship, n.k.), na kama ni klabu ya wanachama.',
      },
      {
        id: 2,
        q: 'Nini tofauti kati ya Klabu na Akademi? / What is the difference '
          + 'between Club and Academy?',
        a: 'Akademi inalenga mafunzo ya vijana. Klabu inashiriki katika '
          + 'mashindano rasmi. Zote zinaweza kuwa na wachezaji, kupanga '
          + 'mechi, na kuchapisha trials.',
      },
      {
        id: 3,
        q: 'Klabu ya wanachama ni nini? / What is a members club?',
        a: 'Klabu ambayo ina wanachama waliochangia (kama Simba, Yanga). '
          + 'Weka ndio kwenye Klabu ya Wanachama wakati wa usajili.',
      },
    ],
  },
  SCHOOL: {
    label: 'SHULE (SCHOOL)',
    questions: [
      {
        id: 1,
        q: 'Ninajisajili shule vipi? / How do I register a school?',
        a: 'Chagua Shule wakati wa usajili. Chagua aina (Primary, '
          + 'Secondary), jinsia (Wavulana, Wasichana, Mchanganyiko), '
          + 'na weka usajili wa NSC (kama unao).',
      },
      {
        id: 2,
        q: 'Ninawaongeza wachezaji vipi? / How do I add school players?',
        a: 'Akaunti → Wachezaji wa Shule. Bofya + kuongeza. Jaza jina la '
          + 'darasa (Class 5, Form 3, n.k.) na nambari ya jezi.',
      },
      {
        id: 3,
        q: 'Nini maana ya sports teacher? / What does sports teacher mean?',
        a: 'Kocha wa michezo katika shule. Ongeza sports teacher 1 na 2 '
          + 'kwenye wasifu wa shule ili wakubaliwe kama skauti rasmi '
          + 'kwenye mechi zako.',
      },
    ],
  },
  AGENT: {
    label: 'WAKALA (AGENT)',
    questions: [
      {
        id: 1,
        q: 'Ninajisajili kama wakala vipi? / How do I register as an agent?',
        a: 'Chagua Wakala wakati wa usajili. Chagua aina: FIFA Agent au '
          + 'Local Agent. Wakala wa FIFA anahitaji nambari ya usajili '
          + 'wa FIFA.',
      },
      {
        id: 2,
        q: 'Ninaunganisha na mchezaji vipi? / How do I link with a player?',
        a: 'Tafuta mchezaji, bofya Info Zaidi → Ongeza Wakala. Mchezaji '
          + 'lazima akubali. Baada ya kukubaliwa, unaweza kuomba scout '
          + 'kwa niaba yao.',
      },
      {
        id: 3,
        q: 'Kwa nini nahitaji Gold au Enterprise? / Why do I need Gold '
          + 'or Enterprise?',
        a: 'Wakala Standard hawezi kufanya chochote kwenye jukwaa. Gold '
          + 'inaruhusu kuunganisha na wachezaji + kuomba scout. Enterprise '
          + 'ni kwa mashirika makubwa ya wakala.',
      },
    ],
  },
  SPONSOR: {
    label: 'MFADHILI (SPONSOR)',
    questions: [
      {
        id: 1,
        q: 'Ninachapisha matangazo vipi? / How do I post ads?',
        a: 'Wafadhili hawachapishi matangazo moja kwa moja — hiyo ni '
          + 'kwa Wafanyabiashara (Vendors). Wafadhili wanaunga mkono '
          + 'wachezaji au klabu kwa njia ya moja kwa moja.',
      },
      {
        id: 2,
        q: 'Ninaweza kuwa Anonymous? / Can I be anonymous?',
        a: 'Ndio. Akaunti → Hariri Wasifu → Wezesha Anonymous. Wafadhili '
          + 'wako watajulikana kama "Anonymous" hadharani, lakini uko '
          + 'salama katika akaunti yako binafsi.',
      },
      {
        id: 3,
        q: 'Mifadhili ya Entity na Individual — nini tofauti? / Entity '
          + 'vs Individual sponsor?',
        a: 'Individual = mtu binafsi anayefadhili. Entity = shirika au '
          + 'kampuni (mfano: benki, kampuni ya bima). Chagua unaposajili.',
      },
    ],
  },
  VENDOR: {
    label: 'MFANYABIASHARA (VENDOR)',
    questions: [
      {
        id: 1,
        q: 'Ninachapisha tangazo vipi? / How do I post an ad?',
        a: 'Akaunti → Matangazo (Adverts) → +Ongeza. Weka picha au video, '
          + 'kichwa cha habari, maelezo, na kiungo. Idadi ya matangazo '
          + 'unayoweza kuwa nayo inategemea kifurushi.',
      },
      {
        id: 2,
        q: 'Vikomo vya kila kifurushi ni vipi? / Tier caps?',
        a: 'Standard: 0 matangazo. Gold: 2. Platinum: 6. Enterprise: '
          + 'bila kikomo. Boresha kifurushi ili kuongeza.',
      },
      {
        id: 3,
        q: 'Boost ya post ni nini? / What is boost a post?',
        a: 'Chapisho lako la kawaida (Media) linaweza kupewa Boost — '
          + 'linatokea juu ya feed kwa siku 7/14/30. Kifurushi cha Gold+ '
          + 'kina Boost Slots kila mwezi.',
      },
      {
        id: 4,
        q: 'Nini nafasi kwenye SokaSoko Account? / What is the SokaSoko '
          + 'account slot?',
        a: 'Platinum vendors wanapata nafasi ya PRIORITY kwenye feed ya '
          + 'akaunti rasmi ya SokaSoko. Enterprise wanapata nafasi ya '
          + 'GUARANTEED — daima ipo. (Kipengele hiki kinajengwa.)',
      },
    ],
  },
  GUARDIAN: {
    label: 'MLEZI (GUARDIAN)',
    questions: [
      {
        id: 1,
        q: 'Ninaongeza mtoto vipi? / How do I add a minor?',
        a: 'Akaunti → Wachezaji Wangu → +Ongeza. Sajili mtoto kwa kutumia '
          + 'taarifa zake. Utawajibika kwa maombi na malipo yao.',
      },
      {
        id: 2,
        q: 'Ninaondoa mtoto vipi? / How do I remove a minor?',
        a: 'Wachezaji Wangu → chagua mtoto → ⋮ → Ondoa. Mtoto atakuwa '
          + 'orphan hadi mlezi mpya amchukue. Watapoteza uwezo wa kutuma '
          + 'ujumbe au maombi ya scout kwa muda huo.',
      },
      {
        id: 3,
        q: 'Mtoto anaweza kuomba mlezi mwingine? / Can a minor request '
          + 'another guardian?',
        a: 'Ndio. Mtoto anaweza kutafuta mlezi mpya kwenye Mlezi Wangu → '
          + '+Omba. Mlezi mpya anaweza kukubali au kukataa.',
      },
    ],
  },
  SUBSCRIPTION: {
    label: 'UANDIKISHAJI (SUBSCRIPTION)',
    questions: [
      {
        id: 1,
        q: 'Ninajisajili vipi kwenye kifurushi cha Gold? / How do I '
          + 'upgrade to Gold?',
        a: 'Akaunti → ⋮ → Uandikishaji. Chagua kifurushi (Gold, Platinum, '
          + 'n.k.). Chagua muda (Monthly/Annual). Weka M-Pesa/Tigo/AzamPay '
          + 'reference. Msimamizi atathibitisha ndani ya masaa 24.',
      },
      {
        id: 2,
        q: 'Bei za vifurushi ni zipi? / What are the tier prices?',
        a: 'Bei zinaonekana kwenye ukurasa wa uandikishaji kabla ya kulipa. '
          + 'Zinatofautiana kwa kila aina ya akaunti (Player, Coach, n.k.). '
          + 'Nenda Akaunti → Uandikishaji kuona bei za sasa.',
      },
      {
        id: 3,
        q: 'Njia za malipo? / Payment methods?',
        a: 'M-Pesa, Tigo Pesa, AzamPay, na malipo ya moja kwa moja (Manual). '
          + 'Kwa Manual, tuma pesa kwa nambari uliyopewa, kisha weka '
          + 'reference nambari.',
      },
      {
        id: 4,
        q: 'Kwa nini malipo yangu hayajathibitika? / Why hasn\'t my payment '
          + 'been confirmed?',
        a: 'Malipo huthibitishwa manually na msimamizi. Wastani: masaa 24. '
          + 'Ikiwa imezidi masaa 48, wasiliana nasi kupitia HELP → Mhudumu '
          + '(reference nambari yako tayari).',
      },
      {
        id: 5,
        q: 'Ninarudije Standard? / How do I go back to Standard?',
        a: 'Kifurushi kinapofika mwisho, kinaenda kwenye GRACE (siku 5), '
          + 'kisha kinakuwa EXPIRED — akaunti inarudi Standard moja kwa moja. '
          + 'Huhitaji kufanya chochote.',
      },
    ],
  },
};

// Renders the root menu as a chat message body.
function renderRootMenu() {
  return 'Karibu SokaSoko Support 👋\n\n'
    + 'Chagua eneo lako:\n'
    + AREAS.map((a) => a.label).join('\n')
    + '\n\nAndika nambari (1-12), au andika "MHUDUMU" kuzungumza '
    + 'na msimamizi.';
}

// Renders a submenu for a given area as a chat message body.
function renderAreaMenu(areaCode) {
  const area = AREA_MENUS[areaCode];
  if (!area) return null;
  const lines = area.questions.map((q) => `${q.id}. ${q.q}`).join('\n');
  return `${area.label} — chagua swali:\n\n${lines}\n\n`
    + '0. Rudi kwa menyu kuu\n'
    + 'MHUDUMU. Zungumza na msimamizi';
}

// Renders the canned answer for a question, with a small navigation
// footer so the user can continue exploring without needing to guess
// keywords.
function renderAnswer(areaCode, questionId) {
  const area = AREA_MENUS[areaCode];
  if (!area) return null;
  const q = area.questions.find((x) => x.id === questionId);
  if (!q) return null;
  return `${q.a}\n\n---\n0. Rudi kwa menyu kuu\n`
    + `${area.code || areaCode}. Rudi kwa maswali ya ${area.label}\n`
    + 'MHUDUMU. Zungumza na msimamizi';
}

// Classify an incoming message. Returns one of:
//   { kind: 'trigger' }                     // show root menu
//   { kind: 'root_pick', areaCode }         // user picked an area
//   { kind: 'area_pick', questionId }       // user picked a question
//   { kind: 'back_to_root' }                // "0" from a submenu
//   { kind: 'escalate' }                    // MHUDUMU/HUMAN or free-form
//   { kind: 'freeform' }                    // no menu context; passthrough
function classifyMessage(text, currentState) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return { kind: 'freeform' };
  if (ESCALATION_WORDS.has(t)) return { kind: 'escalate' };
  if (TRIGGER_WORDS.has(t)) return { kind: 'trigger' };

  const asNum = Number.parseInt(t, 10);
  if (!Number.isNaN(asNum) && String(asNum) === t) {
    if (currentState === 'ROOT') {
      if (asNum >= 1 && asNum <= AREAS.length) {
        return { kind: 'root_pick', areaCode: AREAS[asNum - 1].code };
      }
      // Number outside 1..12 while at root — escalate.
      return { kind: 'escalate' };
    }
    if (currentState && AREA_MENUS[currentState]) {
      if (asNum === 0) return { kind: 'back_to_root' };
      const q = AREA_MENUS[currentState].questions.find((x) => x.id === asNum);
      if (q) return { kind: 'area_pick', questionId: asNum };
      return { kind: 'escalate' };
    }
    // No menu context but user typed a number — treat as freeform to
    // hand to the admin.
    return { kind: 'freeform' };
  }

  // Any prose text — escalate to human. If we're in a menu state the
  // user gave up on picking; if we're not, they're just asking freely.
  return currentState ? { kind: 'escalate' } : { kind: 'freeform' };
}

module.exports = {
  AREAS,
  AREA_MENUS,
  TRIGGER_WORDS,
  ESCALATION_WORDS,
  STATE_TTL_MIN,
  renderRootMenu,
  renderAreaMenu,
  renderAnswer,
  classifyMessage,
};
