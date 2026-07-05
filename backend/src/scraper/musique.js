// ---------------------------------------------------------------------------
// MODULE 1 — Parseur de "musique" hippique.
//
// La musique encode les dernières performances, du plus récent au plus ancien.
// Chaque perf = un rang (1..9, 0 = non placé) OU un incident (D disqualifié,
// A arrêté, T tombé, R rétrogradé/retiré) SUIVI d'une lettre de discipline :
//   a = attelé, m = monté, p = plat, h = haies, s = steeple, o = obstacle, c = cross
// Un marqueur d'année entre parenthèses "(25)" indique une rupture de saison.
//
//   "2a1a(25)3m4s"  ->  { derniere_performance: 2, taux_top3_recent: 0.75,
//                         specialite_predominante: 'attele', changement_annee: true, ... }
// ---------------------------------------------------------------------------

const DISCIPLINE = {
  a: 'attele',
  m: 'monte',
  p: 'plat',
  h: 'obstacle', // haies
  s: 'obstacle', // steeple
  o: 'obstacle',
  c: 'obstacle', // cross
};

// Un token = (rang | incident)(discipline). Insensible à la casse.
const TOKEN_RE = /([0-9]|[datr])\s*([ampshoc])/gi;

// Parse une musique en objet structuré. Robuste aux chaînes vides / bruitées.
function parseMusique(raw) {
  const s = String(raw || '').trim();
  const out = {
    raw: s,
    performances: [],
    derniere_performance: null,
    taux_top3_recent: null,
    specialite_predominante: null,
    changement_annee: false,
  };
  if (!s || !/[0-9datr]\s*[ampshoc]/i.test(s)) return out;

  out.changement_annee = /\(\s*\d{2}\s*\)/.test(s);
  const clean = s.replace(/\(\s*\d{2}\s*\)/g, ' '); // retire les marqueurs d'année

  const perfs = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(clean)) !== null) {
    const rankChar = m[1].toLowerCase();
    const discChar = m[2].toLowerCase();
    let placing = null;
    let incident = false;
    if (/[0-9]/.test(rankChar)) {
      const v = parseInt(rankChar, 10);
      if (v === 0) incident = true; // 0 = non placé
      else placing = v;
    } else {
      incident = true; // D / A / T / R
    }
    perfs.push({
      placing, // 1..9 ou null
      incident, // true si non placé / disqualifié / etc.
      discipline: DISCIPLINE[discChar] || null,
      code: discChar,
    });
  }
  if (!perfs.length) return out;

  out.performances = perfs;
  out.derniere_performance = perfs[0].placing; // plus récent en tête

  // Taux de podium sur les 5 dernières courses.
  const last5 = perfs.slice(0, 5);
  const top3 = last5.filter((p) => p.placing != null && p.placing >= 1 && p.placing <= 3).length;
  out.taux_top3_recent = Math.round((top3 / last5.length) * 100) / 100;

  // Discipline dominante (mode des disciplines observées).
  const counts = {};
  perfs.forEach((p) => {
    if (p.discipline) counts[p.discipline] = (counts[p.discipline] || 0) + 1;
  });
  out.specialite_predominante =
    Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;

  return out;
}

// Score de forme 0-100 pondéré par la récence (rétro-compatibilité avec l'ancien
// champ `formScore`). Dérivé de la musique parsée.
function formScoreFromParsed(parsed) {
  const perfs = (parsed && parsed.performances) || [];
  if (!perfs.length) return null;
  const valueOf = (p) => {
    if (p.incident || p.placing == null) return 12;
    const v = p.placing;
    if (v === 1) return 100;
    if (v === 2) return 86;
    if (v === 3) return 72;
    if (v === 4) return 58;
    if (v === 5) return 48;
    return 32;
  };
  const weights = [1, 0.85, 0.7, 0.55, 0.42, 0.3];
  let s = 0;
  let sw = 0;
  perfs.slice(0, 6).forEach((p, i) => {
    const w = weights[i] || 0.2;
    s += valueOf(p) * w;
    sw += w;
  });
  return Math.round(s / sw);
}

module.exports = { parseMusique, formScoreFromParsed, DISCIPLINE };
