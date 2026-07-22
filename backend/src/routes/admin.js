const express = require('express');
const prisma = require('../db');
const { requireAdmin } = require('../auth');
const { ingestFromFile, ingestData } = require('../jobs/ingest');
const { scrapeProgramme } = require('../jobs/scrape');
const { buildPredictionSnapshot } = require('../services/predictionSelection');
const { availableProviders } = require('../services/paymentProvider');
const { countriesForProviderIds } = require('../services/paymentCountries');

const router = express.Router();

router.use(requireAdmin);

// POST /admin/api/ingest — load races from the bundled live_races.json into the
// DB and compute predictions. One-click population from the back-office (no
// shell needed). Live scraping stays a separate scheduled job.
router.post('/api/ingest', async (_req, res) => {
  try {
    const count = await ingestFromFile();
    res.json({ ok: true, count });
  } catch (e) {
    console.error('ingest endpoint error', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/api/scrape?date=YYYY-MM-DD — scrape geny LIVE then ingest.
router.post('/api/scrape', async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
    const payload = await scrapeProgramme(date, { maxReunions: 8, maxCourses: 4 });
    if (!payload.racetracks.length) {
      return res.status(502).json({ error: 'Aucune donnée récupérée (geny indisponible ou rate-limit).' });
    }
    // ingestData upserts races. Never delete the date first: a partial upstream
    // response or a failed ingest must not erase results and historical picks.
    const count = await ingestData(payload);
    // Auto-désignation de la course du jour par pays (sans écraser le manuel).
    const { autoAssignNationalPicks } = require('../jobs/ingest');
    const picks = await autoAssignNationalPicks(payload);
    res.json({ ok: true, date, hippodromes: payload.racetracks.length, count, autoPicks: picks.assigned });
  } catch (e) {
    console.error('scrape endpoint error', e.message);
    if (e.code === 'UPSTREAM_RATE_LIMIT') {
      const retryAfter = e.retryAfterSeconds || 60;
      res.set('Retry-After', String(retryAfter));
      return res.status(503).json({
        error: 'Geny limite temporairement les requêtes. Les courses existantes ont été conservées. Réessayez dans quelques minutes.',
        code: e.code,
        retryAfter,
      });
    }
    res.status(500).json({ error: e.message });
  }
});

// JSON API: all payments (most recent first), with user phone joined.
router.get('/api/payments', async (req, res) => {
  const status = req.query.status;
  const where = status ? { status } : {};
  const payments = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { user: { select: { phone: true } } },
  });
  res.json({ payments });
});

router.get('/api/stats', async (req, res) => {
  try {
    const [total, success, pending, failed] = await Promise.all([
      prisma.payment.count(),
      prisma.payment.count({ where: { status: 'success' } }),
      prisma.payment.count({ where: { status: 'pending' } }),
      prisma.payment.count({ where: { status: 'failed' } }),
    ]);
    const revenueAgg = await prisma.payment.aggregate({
      where: { status: 'success' },
      _sum: { amount: true },
    });
    const users = await prisma.user.count();
    const activeSubs = await prisma.subscription.count({
      where: { status: 'active', currentPeriodEnd: { gt: new Date() } },
    });
    res.json({
      total,
      success,
      pending,
      failed,
      revenue: revenueAgg._sum.amount || 0,
      users,
      activeSubs,
    });
  } catch (e) {
    console.error('admin stats error', e);
    res.status(500).json({ error: 'Erreur lors du calcul des statistiques' });
  }
});

// Pending identity checks submitted from the mobile recovery form.
router.get('/api/recovery-requests', async (_req, res) => {
  const requests = await prisma.recoveryRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          birthDate: true,
          birthPlace: true,
          phone: true,
        },
      },
    },
  });
  res.json({ requests });
});

// POST /admin/api/results  { externalId, winners: [4,7,1,...] }
// Records the official arrival and computes whether our #1 AI pick placed.
router.post('/api/results', express.json(), async (req, res) => {
  const { externalId } = req.body || {};
  let { winners } = req.body || {};
  if (!externalId || !Array.isArray(winners) || !winners.length) {
    return res.status(400).json({ error: 'externalId et winners[] requis' });
  }
  // Sanitise the arrival: valid runner numbers (1-30), no duplicates, capped.
  winners = winners.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 30);
  winners = [...new Set(winners)].slice(0, 30);
  if (winners.length < 3) {
    return res.status(400).json({ error: 'winners[] doit contenir au moins 3 numéros valides (1-30)' });
  }
  const race = await prisma.race.findUnique({
    where: { externalId },
    include: { predictions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!race) return res.status(404).json({ error: 'Course introuvable' });

  let predicted = false;
  let predictionSnapshot = null;
  if (race.predictions.length) {
    let picks = [];
    try {
      picks = JSON.parse(race.predictions[0].topPicks);
    } catch {
      picks = [];
    }
    const topPick = picks[0];
    // Hit = our #1 pick finished in the top 3 (placé).
    predicted = topPick ? winners.slice(0, 3).includes(topPick.number) : false;
    predictionSnapshot = JSON.stringify(
      buildPredictionSnapshot(picks, race, Math.min(winners.length, 5))
    );
  }

  const result = await prisma.result.upsert({
    where: { raceId: race.id },
    update: { winners: JSON.stringify(winners), predictionSnapshot, predicted },
    create: { raceId: race.id, winners: JSON.stringify(winners), predictionSnapshot, predicted },
  });
  // Stamp the LTR training labels on the Runner rows too.
  const { stampFinishPositions } = require('../jobs/results');
  await stampFinishPositions(race.id, winners);
  res.json({ ok: true, predicted, resultId: result.id });
});

// POST /admin/api/non-partants  { externalId, nonPartants: [3,7] }
// Declare the scratched runners for a race so the ML daemon drops + renormalises
// them on its next 10-min cycle. Pass an empty array to clear.
router.post('/api/non-partants', express.json(), async (req, res) => {
  const { externalId, nonPartants } = req.body || {};
  if (!externalId || !Array.isArray(nonPartants)) {
    return res.status(400).json({ error: 'externalId et nonPartants[] requis' });
  }
  const nums = [
    ...new Set(
      nonPartants
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 30)
    ),
  ].slice(0, 30);
  try {
    await prisma.race.update({
      where: { externalId },
      data: { nonPartants: JSON.stringify(nums) },
    });
  } catch {
    return res.status(404).json({ error: 'Course introuvable' });
  }
  res.json({ ok: true, externalId, nonPartants: nums });
});

// --- Course PMU du jour par pays (Quarté LONAB, LONACI…) ---------------------
function pickCountryCatalog() {
  return countriesForProviderIds(availableProviders().map((provider) => provider.id));
}

// POST /admin/api/national-pick { country, externalId, date?, betType?, journalUrl? }
router.post('/api/national-pick', express.json(), async (req, res) => {
  const country = String(req.body.country || '').trim().toLowerCase();
  const externalId = String(req.body.externalId || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '')
    ? req.body.date
    : new Date().toISOString().slice(0, 10);
  const allowedCountries = pickCountryCatalog().map((item) => item.code);
  if (!allowedCountries.includes(country)) {
    return res.status(400).json({ error: `country invalide (${allowedCountries.join(', ')})` });
  }
  if (!externalId) return res.status(400).json({ error: 'externalId requis' });
  const race = await prisma.race.findUnique({ where: { externalId } });
  if (!race) return res.status(404).json({ error: 'Course introuvable' });

  const journalUrl = String(req.body.journalUrl || '').trim();
  if (journalUrl && !/^https?:\/\//.test(journalUrl)) {
    return res.status(400).json({ error: 'journalUrl doit être une URL http(s)' });
  }
  const data = {
    betType: String(req.body.betType || '').trim() || null,
    journalUrl: journalUrl || null,
    externalId,
  };
  const pick = await prisma.nationalPick.upsert({
    where: { date_country: { date, country } },
    update: data,
    create: { date, country, ...data },
  });
  res.json({ ok: true, pick });
});

// GET /admin/api/national-picks?date=YYYY-MM-DD
router.get('/api/national-picks', async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const picks = await prisma.nationalPick.findMany({ where: { date } });
  res.json({ date, picks });
});

// POST /admin/api/reset-password  { phone, newPassword, requestId? }
// Support client après demande envoyée à ftevolut@gmail.com. Vérifiez toujours
// l'identité (ex. référence d'un paiement) avant de réinitialiser. L'ancien
// code de récupération est également remplacé afin de fermer toute session de
// récupération potentiellement compromise.
router.post('/api/reset-password', express.json(), async (req, res) => {
  const { genRecoveryCode, hashPassword, hashRecoveryCode } = require('../security');
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
  const newPassword = req.body.newPassword;
  const requestId = String(req.body.requestId || '').trim();
  if (!phone || typeof newPassword !== 'string' || newPassword.length < 12) {
    return res.status(400).json({ error: 'phone et newPassword (12 car. min) requis' });
  }
  const recoveryCode = genRecoveryCode();
  try {
    await prisma.user.update({
      where: { phone },
      data: {
        passwordHash: hashPassword(newPassword),
        recoveryCodeHash: hashRecoveryCode(recoveryCode),
      },
    });
  } catch {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
  if (requestId) {
    await prisma.recoveryRequest.updateMany({
      where: { id: requestId, phone, status: 'pending' },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }
  res.json({ ok: true, phone, recoveryCode });
});

// POST /admin/api/backfill-runners — reconstruit les Runner des courses passées
// terminées (données historiques) pour alimenter le jeu d'entraînement LTR.
router.post('/api/backfill-runners', async (_req, res) => {
  try {
    const { backfillRunners } = require('../jobs/ingest');
    const r = await backfillRunners();
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('backfill error', e);
    res.status(500).json({ error: e.message });
  }
});

// HTML dashboard.
router.get('/', async (_req, res) => {
  res.type('html').send(DASHBOARD_HTML);
});

const PICK_COUNTRY_OPTIONS = pickCountryCatalog()
  .map((country) => `<option value="${country.code}">${country.flag} ${country.name}</option>`)
  .join('');
const PICK_FLAGS = Object.fromEntries(
  pickCountryCatalog().map((country) => [country.code, country.flag])
);

const DASHBOARD_HTML = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ParisPromax — Back-office</title>
<style>
  :root{--bg:#0f172a;--surface:#111c33;--border:#1e293b;--text:#f8fafc;--muted:#94a3b8;--accent:#10b981;--gold:#fbbf24;--danger:#ef4444}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,Segoe UI,Arial,sans-serif}
  header{background:#064e3b;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
  header h1{font-size:18px;margin:0}
  .wrap{padding:24px;max-width:1100px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px}
  .card .label{color:var(--muted);font-size:12px;text-transform:uppercase}
  .card .value{font-size:24px;font-weight:800;margin-top:6px}
  .accent{color:var(--accent)} .gold{color:var(--gold)} .danger{color:var(--danger)}
  table{width:100%;border-collapse:collapse;background:var(--surface);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px}
  th{color:var(--muted);text-transform:uppercase;font-size:11px}
  .badge{padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700}
  .s-success{background:rgba(16,185,129,.15);color:var(--accent)}
  .s-pending{background:rgba(251,191,36,.15);color:var(--gold)}
  .s-failed{background:rgba(239,68,68,.15);color:var(--danger)}
  .filters{margin-bottom:12px}
  .muted{color:var(--muted);font-size:13px;margin-left:8px}
  button,select,input{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 12px}
  button{cursor:pointer}
</style></head>
<body>
<header><h1>🏇 ParisPromax — Back-office paiements</h1><span id="now" style="color:#9fe3c8"></span></header>
<div class="wrap">
  <div class="cards" id="stats"></div>
  <div class="filters">
    <label>Filtrer : </label>
    <select id="statusFilter" onchange="load()">
      <option value="">Tous</option>
      <option value="success">Réussis</option>
      <option value="pending">En attente</option>
      <option value="failed">Échoués</option>
    </select>
    <button onclick="load()">↻ Rafraîchir</button>
    <button id="scrapeBtn" onclick="scrape()" style="background:#10b981;color:#06251c;font-weight:800">🏇 Scraper les courses du jour</button>
    <button onclick="ingest()">⬇ Charger la démo</button>
    <span id="ingestMsg" class="muted"></span>
  </div>
  <div class="card" style="margin-bottom:24px">
    <div class="label">🔐 Réinitialisation assistée</div>
    <p class="muted" style="margin-left:0">
      Vérifiez une référence de paiement avant toute action. Ne demandez jamais le PIN Mobile Money.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="supportPhone" autocomplete="off" placeholder="Téléphone, ex. +22670000000" style="width:230px"/>
      <input id="supportPassword" type="password" autocomplete="new-password" placeholder="Mot de passe temporaire (12 car. min.)" style="width:280px"/>
      <input id="supportRequestId" type="hidden"/>
      <button onclick="resetSupportPassword()" style="background:#10b981;color:#06251c;font-weight:800">Réinitialiser</button>
    </div>
    <div id="supportMsg" class="muted" style="margin:10px 0 0"></div>
    <div id="recoveryRequests" style="margin-top:14px"></div>
  </div>
  <div class="card" style="margin-bottom:24px">
    <div class="label">🏇 Course PMU du jour par pays (Quarté LONAB, LONACI…)</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
      <select id="npCountry">
        ${PICK_COUNTRY_OPTIONS}
      </select>
      <select id="npRace" style="max-width:340px"><option>Chargement des courses…</option></select>
      <input id="npBet" placeholder="Pari (ex. Quarté)" style="background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 12px;width:130px"/>
      <input id="npJournal" placeholder="URL du journal (PDF)" style="background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 12px;width:260px"/>
      <button onclick="savePick()" style="background:#10b981;color:#06251c;font-weight:800">💾 Enregistrer</button>
    </div>
    <div id="npList" class="muted" style="margin-top:10px"></div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Téléphone</th><th>Transaction</th><th>Montant</th><th>Méthode</th><th>Statut</th></tr></thead>
    <tbody id="rows"><tr><td colspan="6">Chargement…</td></tr></tbody>
  </table>
</div>
<script>
  document.getElementById('now').textContent = new Date().toLocaleString('fr-FR');
  function fmt(n){return Number(n).toLocaleString('fr-FR')}
  function esc(v){return String(v == null ? '' : v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  let recoveryRequestById = {};
  async function load(){
    const s = document.getElementById('statusFilter').value;
    const [stats, pay] = await Promise.all([
      fetch('/admin/api/stats').then(r=>r.json()),
      fetch('/admin/api/payments'+(s?('?status='+s):'')).then(r=>r.json())
    ]);
    document.getElementById('stats').innerHTML = [
      ['Revenu (XOF)', fmt(stats.revenue), 'accent'],
      ['Paiements réussis', stats.success, 'accent'],
      ['En attente', stats.pending, 'gold'],
      ['Échoués', stats.failed, 'danger'],
      ['Abonnés actifs', stats.activeSubs, ''],
      ['Utilisateurs', stats.users, ''],
    ].map(([l,v,c])=>'<div class="card"><div class="label">'+l+'</div><div class="value '+c+'">'+v+'</div></div>').join('');
    document.getElementById('rows').innerHTML = (pay.payments||[]).map(p=>
      '<tr><td>'+new Date(p.createdAt).toLocaleString('fr-FR')+'</td>'+
      '<td>'+(p.user?p.user.phone:'—')+'</td>'+
      '<td><code>'+p.transactionId+'</code></td>'+
      '<td>'+fmt(p.amount)+' '+p.currency+'</td>'+
      '<td>'+(p.method||'—')+'</td>'+
      '<td><span class="badge s-'+p.status+'">'+p.status+'</span></td></tr>'
    ).join('') || '<tr><td colspan="6">Aucun paiement</td></tr>';
  }
  async function ingest(){
    const msg = document.getElementById('ingestMsg');
    msg.textContent = '⏳ Ingestion démo…';
    try {
      const r = await fetch('/admin/api/ingest', { method: 'POST' });
      const d = await r.json();
      msg.textContent = d.ok ? ('✅ '+d.count+' courses (démo) ingérées') : ('❌ '+(d.error||'erreur'));
    } catch(e){ msg.textContent = '❌ '+e.message; }
    load();
  }
  async function scrape(){
    const msg = document.getElementById('ingestMsg');
    const btn = document.getElementById('scrapeBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    msg.textContent = '⏳ Scraping des vraies courses du jour… (peut prendre 1-2 min)';
    try {
      const r = await fetch('/admin/api/scrape', { method: 'POST' });
      const d = await r.json();
      msg.textContent = d.ok ? ('✅ '+d.count+' vraies courses ('+d.hippodromes+' hippodromes) le '+d.date) : ('❌ '+(d.error||'erreur'));
    } catch(e){ msg.textContent = '❌ '+e.message; }
    finally { btn.disabled = false; }
    load();
  }
  async function resetSupportPassword(){
    const msg = document.getElementById('supportMsg');
    const phone = document.getElementById('supportPhone').value.trim();
    const newPassword = document.getElementById('supportPassword').value;
    const requestId = document.getElementById('supportRequestId').value;
    if (!phone || newPassword.length < 12) {
      msg.textContent = '❌ Numéro et mot de passe temporaire de 12 caractères minimum requis.';
      return;
    }
    if (!confirm('Identité vérifiée par référence de paiement pour '+phone+' ?')) return;
    msg.textContent = '⏳ Réinitialisation…';
    try {
      const r = await fetch('/admin/api/reset-password', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({phone, newPassword, requestId}),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Erreur');
      msg.textContent = '✅ Compte réinitialisé. Nouveau code de récupération : '+d.recoveryCode+' — transmettez-le séparément et demandez au client de le conserver.';
      document.getElementById('supportPassword').value = '';
      document.getElementById('supportRequestId').value = '';
      loadRecoveryRequests();
    } catch(e) {
      msg.textContent = '❌ '+e.message;
    }
  }
  function selectRecoveryRequest(id){
    const item = recoveryRequestById[id];
    if (!item) return;
    document.getElementById('supportPhone').value = item.phone;
    document.getElementById('supportRequestId').value = item.id;
    document.getElementById('supportMsg').textContent = 'Demande sélectionnée : '+item.id+'. Vérifiez les informations avant de continuer.';
  }
  async function loadRecoveryRequests(){
    try {
      const data = await fetch('/admin/api/recovery-requests').then(r=>r.json());
      const items = data.requests || [];
      recoveryRequestById = Object.fromEntries(items.map(item=>[item.id,item]));
      document.getElementById('recoveryRequests').innerHTML = items.length ? items.map(item=>{
        const stored = item.user || {};
        return '<div style="border-top:1px solid var(--border);padding:10px 0">'+
          '<strong>'+esc(item.phone)+'</strong> · '+esc(new Date(item.createdAt).toLocaleString('fr-FR'))+
          (item.emailSent?' · ✉️ notifié':' · en attente')+'<br/>'+
          '<span class="muted" style="margin:0">Déclaré : '+esc(item.claimedFirstName)+' '+esc(item.claimedLastName)+
          ', '+esc(item.claimedBirthDate)+', '+esc(item.claimedBirthPlace)+' · Paiement : '+esc(item.paymentReference||'non fourni')+'</span><br/>'+
          '<span class="muted" style="margin:0">Compte : '+esc(stored.firstName||'—')+' '+esc(stored.lastName||'—')+
          ', '+esc(stored.birthDate||'—')+', '+esc(stored.birthPlace||'—')+'</span> '+
          '<button onclick="selectRecoveryRequest(\''+item.id+'\')">Traiter</button></div>';
      }).join('') : '<span class="muted" style="margin:0">Aucune demande en attente.</span>';
    } catch(e) {
      document.getElementById('recoveryRequests').textContent = 'Impossible de charger les demandes.';
    }
  }
  const FLAGS = ${JSON.stringify(PICK_FLAGS)};
  async function loadPicks(){
    try {
      // Courses du jour pour le sélecteur.
      const d = await fetch('/races').then(r=>r.json());
      const sel = document.getElementById('npRace');
      sel.innerHTML = '';
      (d.racetracks||[]).forEach(t=>(t.races||[]).forEach(r=>{
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = t.name+' '+(r.number||'')+' — '+r.name+(r.time?(' ('+r.time+')'):'');
        sel.appendChild(o);
      }));
      // Picks déjà enregistrés.
      const p = await fetch('/admin/api/national-picks').then(r=>r.json());
      document.getElementById('npList').innerHTML = (p.picks||[]).length
        ? p.picks.map(x=>(FLAGS[x.country]||x.country)+' '+x.country.toUpperCase()+' → <code>'+x.externalId+'</code> '+(x.betType||'')+(x.journalUrl?' · <a href="'+x.journalUrl+'" target="_blank" style="color:#10b981">journal</a>':'')).join('  ·  ')
        : 'Aucune course désignée pour aujourd\\'hui.';
    } catch(e) { /* silencieux */ }
  }
  async function savePick(){
    const body = {
      country: document.getElementById('npCountry').value,
      externalId: document.getElementById('npRace').value,
      betType: document.getElementById('npBet').value,
      journalUrl: document.getElementById('npJournal').value,
    };
    const r = await fetch('/admin/api/national-pick', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d = await r.json();
    alert(d.ok ? '✅ Course du jour enregistrée' : ('❌ '+(d.error||'erreur')));
    loadPicks();
  }
  load();
  loadPicks();
  loadRecoveryRequests();
  setInterval(load, 15000);
  setInterval(loadRecoveryRequests, 30000);
</script>
</body></html>`;

module.exports = router;
