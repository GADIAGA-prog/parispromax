const express = require('express');
const prisma = require('../db');
const { requireAdmin } = require('../auth');
const { ingestFromFile, ingestData } = require('../jobs/ingest');
const { scrapeProgramme } = require('../jobs/scrape');

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
    // Clean replace: drop this date's existing races (+ their predictions/results)
    // so demo/stale data doesn't mix with the fresh scrape.
    const old = await prisma.race.findMany({ where: { date }, select: { id: true } });
    const ids = old.map((r) => r.id);
    if (ids.length) {
      await prisma.prediction.deleteMany({ where: { raceId: { in: ids } } });
      await prisma.result.deleteMany({ where: { raceId: { in: ids } } });
      await prisma.race.deleteMany({ where: { id: { in: ids } } });
    }
    const count = await ingestData(payload);
    res.json({ ok: true, date, hippodromes: payload.racetracks.length, count, replaced: ids.length });
  } catch (e) {
    console.error('scrape endpoint error', e.message);
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
  }

  const result = await prisma.result.upsert({
    where: { raceId: race.id },
    update: { winners: JSON.stringify(winners), predicted },
    create: { raceId: race.id, winners: JSON.stringify(winners), predicted },
  });
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
  button,select{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 12px;cursor:pointer}
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
    <button onclick="scrape()" style="background:#10b981;color:#06251c;font-weight:800">🏇 Scraper les courses du jour</button>
    <button onclick="ingest()">⬇ Charger la démo</button>
    <span id="ingestMsg" class="muted"></span>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Téléphone</th><th>Transaction</th><th>Montant</th><th>Méthode</th><th>Statut</th></tr></thead>
    <tbody id="rows"><tr><td colspan="6">Chargement…</td></tr></tbody>
  </table>
</div>
<script>
  document.getElementById('now').textContent = new Date().toLocaleString('fr-FR');
  function fmt(n){return Number(n).toLocaleString('fr-FR')}
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
    msg.textContent = '⏳ Scraping des vraies courses du jour… (peut prendre 1-2 min)';
    try {
      const r = await fetch('/admin/api/scrape', { method: 'POST' });
      const d = await r.json();
      msg.textContent = d.ok ? ('✅ '+d.count+' vraies courses ('+d.hippodromes+' hippodromes) le '+d.date) : ('❌ '+(d.error||'erreur'));
    } catch(e){ msg.textContent = '❌ '+e.message; }
    load();
  }
  load();
  setInterval(load, 15000);
</script>
</body></html>`;

module.exports = router;
