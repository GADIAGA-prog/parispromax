// ---------------------------------------------------------------------------
// MODULE 1 — Résilience du scraping : mapping HYBRIDE des colonnes.
//
// geny désaligne fréquemment l'en-tête (<th>) et les cellules de données (colspan,
// cellules vides, colonnes fusionnées "Cotes références"/"Dernières cotes"…).
// Se fier aux seuls libellés d'en-tête casse (le "jockey" tombe sur la colonne
// Sexe/Âge). On combine donc :
//   1) les LIBELLÉS d'en-tête (indice via Regex, insensible casse/accents), et
//   2) le CONTENU réel des colonnes (un jockey = "M. Barzalona", une musique =
//      "2p5p4p(25)", un Sexe/Âge = "H6"…) — vote majoritaire sur toutes les lignes.
// Le contenu prime quand il contredit l'en-tête. Ultra-robuste FR/étranger,
// trot/plat.
// ---------------------------------------------------------------------------

function normalizeHeader(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Indices via en-tête (hints).
const FIELD_PATTERNS = [
  ['number', [/n\s*°/, /\bnum(ero)?\b/, /^no\.?$/, /^n$/]],
  ['name', [/cheval/, /\bnom\b/]],
  ['jockey', [/jockey/, /driver/, /mont[eé]?\s*par/, /\bmonte\b/]],
  ['trainer', [/entra[iî]?n/, /\bentr\.?\b/]],
  ['musique', [/musiq/, /\bforme\b/, /\bperf/]],
  ['cote', [/derni.*cote/, /\bcote/, /rapport/]],
  ['chrono', [/reduc/, /record/, /chrono/, /\btps\b/, /\btemps\b/]],
  ['deferrage', [/defer/, /\bfers?\b/, /ferrure/]],
  ['gains', [/\bgains?\b/, /alloc/]],
];

function mapColumns(headerCells) {
  const map = {};
  const norm = (headerCells || []).map(normalizeHeader);
  for (const [field, patterns] of FIELD_PATTERNS) {
    for (let i = 0; i < norm.length; i++) {
      if (map[field] != null) break;
      if (patterns.some((re) => re.test(norm[i]))) map[field] = i;
    }
  }
  return map;
}

// --- Détecteurs de CONTENU -------------------------------------------------
const DET = {
  int: (v) => /^\d{1,2}$/.test(v),
  // musique: (rang|incident)(discipline) — ex "2p5p4p(25)", "1a0aDa".
  musique: (v) => /^[0-9datr]\s*[apmshoc]/i.test(v) && /\d\s*[apmshoc]/i.test(v),
  // personne (jockey/entraîneur): initiale(s) + point — "M. Barzalona", "F.-H. Graffard".
  person: (v) => /[a-zà-ÿ]{1,3}\.[-\s]*[a-zà-ÿ]/i.test(v),
  sa: (v) => /^[hfm]\s?\d{1,2}$/i.test(v.replace(/\s/g, '')), // Sexe/Âge "H6"
  decimal: (v) => /^\d{1,3}[.,]\d+$/.test(v), // poids 57,5 ou cote 5.3
  text: (v) => /[a-zà-ÿ]{3,}/i.test(v),
};

function fraction(rows, idx, test) {
  let seen = 0;
  let hit = 0;
  for (const r of rows) {
    const v = (r[idx] || '').trim();
    if (!v) continue;
    seen++;
    if (test(v)) hit++;
  }
  return seen ? hit / seen : 0;
}

// Résout les colonnes en combinant en-tête (H) et contenu (rows de <td>).
function resolveColumns(headerCells, rows) {
  const H = mapColumns(headerCells);
  const ncol = Math.max(headerCells.length, ...rows.map((r) => r.length), 0);
  const frac = (i, t) => fraction(rows, i, t);
  const map = {};

  // Musique = colonne au plus fort taux de motif musique (>= 40%).
  let musIdx = -1;
  let musBest = 0.4;
  for (let i = 0; i < ncol; i++) {
    const f = frac(i, DET.musique);
    if (f > musBest) {
      musBest = f;
      musIdx = i;
    }
  }
  if (musIdx >= 0) map.musique = musIdx;

  // Personnes = colonnes majoritairement "Initiale. Nom" -> 1re=jockey, 2e=entraîneur.
  const persons = [];
  for (let i = 0; i < ncol; i++) {
    if (i === musIdx) continue;
    if (frac(i, DET.person) >= 0.5) persons.push(i);
  }
  if (persons[0] != null) map.jockey = persons[0];
  if (persons[1] != null) map.trainer = persons[1];

  // Numéro = en-tête N° si colonne d'entiers, sinon 1re colonne d'entiers.
  if (H.number != null && frac(H.number, DET.int) >= 0.6) map.number = H.number;
  else
    for (let i = 0; i < ncol; i++)
      if (frac(i, DET.int) >= 0.8) {
        map.number = i;
        break;
      }

  // Nom du cheval = en-tête "Cheval", sinon 1re colonne texte (hors personnes/musique).
  if (H.name != null) map.name = H.name;
  else
    for (let i = (map.number ?? 0) + 1; i < ncol; i++) {
      if (i === map.jockey || i === map.trainer || i === musIdx) continue;
      if (frac(i, DET.text) >= 0.6 && frac(i, DET.person) < 0.3) {
        map.name = i;
        break;
      }
    }

  // Cote: privilégier la page /cotes/ (plus fiable). En-tête seulement si décimal.
  if (H.cote != null && frac(H.cote, DET.decimal) >= 0.3) map.cote = H.cote;
  // Gains / chrono / déferrage: indices d'en-tête (peu ambigus).
  if (H.gains != null) map.gains = H.gains;
  if (H.chrono != null) map.chrono = H.chrono;
  if (H.deferrage != null) map.deferrage = H.deferrage;

  return map;
}

function getHeaderCells($, table) {
  const grab = (sel) => $(table).find(sel).map((_, el) => $(el).text()).get();
  let cells = grab('thead th');
  if (!cells.length) cells = $(table).find('tr').first().find('th').map((_, el) => $(el).text()).get();
  if (!cells.length) cells = $(table).find('tr').first().find('td').map((_, el) => $(el).text()).get();
  return cells;
}

function tableDataRows($, table) {
  const rows = [];
  $(table)
    .find('tr')
    .each((_, tr) => {
      const tds = $(tr).find('td').map((_, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();
      if (tds.length) rows.push(tds);
    });
  return rows;
}

// Choisit LA table des partants (score max). Ignore les tables d'arrivée ("Rg.").
function findRunnersTable($) {
  let best = null;
  $('table').each((_, table) => {
    const header = getHeaderCells($, table);
    if (/^(rg|rang|class)/.test(normalizeHeader(header[0] || ''))) return; // arrivée/résultats
    const rows = tableDataRows($, table);
    if (rows.length < 2) return;
    const map = resolveColumns(header, rows);
    if (map.number == null || map.name == null) return;
    const score =
      4 +
      (map.jockey != null ? 1 : 0) +
      (map.trainer != null ? 1 : 0) +
      (map.musique != null ? 2 : 0) +
      Math.min(rows.length, 24) * 0.1;
    if (!best || score > best.score) best = { table, map, score };
  });
  return best;
}

function cell(cells, map, field) {
  const idx = map[field];
  return idx != null && idx < cells.length ? cells[idx] : '';
}

module.exports = {
  normalizeHeader,
  mapColumns,
  resolveColumns,
  getHeaderCells,
  tableDataRows,
  findRunnersTable,
  cell,
  DET,
  FIELD_PATTERNS,
};
