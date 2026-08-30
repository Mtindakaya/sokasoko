// Versioned guardian consent text. STARTER DRAFT — legal review pending.
//
// Each time wording changes, add a new version (V2, V3, …). Never edit
// V1 in place after it has been signed by real users, because the DB
// stores the version tag next to each signature and the auditor must
// be able to reconstruct exactly what a given guardian saw.
//
// When adding a new version:
//   1. Bump CURRENT_VERSION.
//   2. Add the new version block with sw + en text.
//   3. Existing signed rows keep their old version tag. Client-side
//      guard treats "signed a prior version" as still-valid unless
//      you flip requiresResignOnUpgrade to true for a specific bump.

const CURRENT_VERSION = 'V1';

const VERSIONS = {
  V1: {
    releasedAt: '2026-08-29',
    requiresResignOnUpgrade: false,
    sw: `
IDHINI YA MLEZI (GUARDIAN CONSENT)

Mimi, mlezi wa mtoto/kijana ninayemsajili katika SokaSoko, nakubali yafuatayo kuhusu {MINOR_NAME}:

1. WAJIBU WANGU
Mimi ni mlezi wa kisheria wa {MINOR_NAME}, au nina ridhaa ya mzazi/mlezi wake wa kisheria kumsajili katika jukwaa hili.

2. MATUMIZI YA TAARIFA
SokaSoko itakusanya na kutumia taarifa za {MINOR_NAME} (jina, tarehe ya kuzaliwa, eneo, picha, video za mchezo, na tathmini za wachunguzi) kwa lengo la kuboresha soka la kijana huyu — ikiwa ni pamoja na kumuunganisha na akademi, klabu, wachunguzi, mawakala, na fursa nyingine za mpira.

3. USALAMA WA MTOTO
- Sitampakia picha au video za {MINOR_NAME} zisizohusu soka.
- Sitatoa maelezo binafsi (namba ya simu, anwani sahihi ya nyumbani, taarifa za shule kwa undani zaidi ya kile SokaSoko kinaomba) hadharani.
- Nitafuatilia mawasiliano yote kati ya {MINOR_NAME} na watumiaji wengine kupitia akaunti yangu ya mlezi.
- Nitaripoti kwa SokaSoko haraka iwezekanavyo iwapo naona mwenendo wowote wa kutiliwa shaka.

4. HAKI ZANGU
- Ninaweza kumuondoa {MINOR_NAME} kwenye jukwaa wakati wowote (Manage Dependents → Remove).
- Ninaweza kuomba SokaSoko ifute taarifa zote za {MINOR_NAME} kwa kuwasiliana na msaada.
- Ninaweza kuhamisha ulezi wa {MINOR_NAME} kwa mlezi mwingine anayekubali masharti haya.

5. WATU WA TATU
Wachunguzi na taasisi wanaopewa ufikiaji wa {MINOR_NAME} watapewa taarifa ninayoona muhimu tu (jina la mchezaji, umri, eneo la ligi, tathmini). Hakuna sehemu ya tatu itakayopewa namba yangu ya simu bila idhini yangu.

6. SHERIA INAYOTUMIKA
Idhini hii inaongozwa na Sheria ya Ulinzi wa Taarifa Binafsi ya Tanzania (Personal Data Protection Act, 2022) na sera ya faragha ya SokaSoko.

7. UTHIBITISHO
Kwa kubonyeza "Kubali" hapa chini na kuandika jina langu, nathibitisha kwamba nimesoma na kuelewa idhini hii, na ninatoa idhini yangu kwa uhuru na bila kulazimishwa.

Toleo: V1 · Tarehe iliyotolewa: 2026-08-29
    `.trim(),
    en: `
GUARDIAN CONSENT

I, as the guardian of the minor I am registering on SokaSoko, agree to the following in respect of {MINOR_NAME}:

1. MY RESPONSIBILITY
I am {MINOR_NAME}'s legal guardian, or I have the consent of their legal parent/guardian to register them on this platform.

2. USE OF INFORMATION
SokaSoko will collect and process {MINOR_NAME}'s information (name, date of birth, location, photos, match videos, and scout evaluations) for the purpose of advancing this minor's football development — including connecting them with academies, clubs, scouts, agents, and other football opportunities.

3. CHILD SAFETY
- I will not upload photos or videos of {MINOR_NAME} unrelated to football.
- I will not share personal contact information (phone number, precise home address, detailed school information beyond what SokaSoko requests) publicly.
- I will supervise all communication between {MINOR_NAME} and other users through my guardian account.
- I will report any suspicious behaviour to SokaSoko as soon as possible.

4. MY RIGHTS
- I can remove {MINOR_NAME} from the platform at any time (Manage Dependents → Remove).
- I can request SokaSoko delete all of {MINOR_NAME}'s data by contacting support.
- I can transfer guardianship of {MINOR_NAME} to another guardian who accepts these terms.

5. THIRD PARTIES
Scouts and organisations granted access to {MINOR_NAME} will only receive information I deem necessary (player name, age, league location, evaluations). No third party will receive my personal phone number without my consent.

6. GOVERNING LAW
This consent is governed by Tanzania's Personal Data Protection Act 2022 and the SokaSoko privacy policy.

7. CONFIRMATION
By tapping "Agree" below and typing my name, I confirm that I have read and understood this consent, and I grant my consent freely and without coercion.

Version: V1 · Released: 2026-08-29
    `.trim(),
  },
};

function getText(version, locale) {
  const v = VERSIONS[version] || VERSIONS[CURRENT_VERSION];
  const code = (locale || '').toLowerCase().startsWith('en') ? 'en' : 'sw';
  return { version: version || CURRENT_VERSION, locale: code, text: v[code] };
}

module.exports = {
  CURRENT_VERSION,
  VERSIONS,
  getText,
};
