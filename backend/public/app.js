const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: sessionStorage.getItem('ppm_web_token') || '',
  countries: [],
  questions: [],
  plans: [],
  racetracks: [],
  me: null,
  selectedRaceId: null,
  selectedPlan: null,
  payment: { provider: null, operator: null, otpMode: 'none', transactionId: null },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatXof(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} XOF`;
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (options.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    const response = await fetch(path, { ...options, headers, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Erreur ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Le serveur met trop de temps à répondre. Réessayez dans un instant.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function setMessage(selector, message, success = false) {
  const node = $(selector);
  node.textContent = message || '';
  node.classList.toggle('success', Boolean(success));
}

function openDialog(selector) {
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
}

function closeDialogs() {
  $$('dialog[open]').forEach((dialog) => dialog.close());
}

function switchAuthTab(tab) {
  $$('[data-auth-tab]').forEach((button) => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#login-form').classList.toggle('hidden', tab !== 'login');
  $('#register-form').classList.toggle('hidden', tab !== 'register');
  setMessage('#auth-message', '');
}

function openAuth(tab = 'login') {
  switchAuthTab(tab);
  openDialog('#auth-dialog');
}

function normalizePhone(raw, countryCode) {
  const country = state.countries.find((item) => item.code === countryCode);
  const source = String(raw || '').trim();
  if (source.startsWith('+')) return `+${source.slice(1).replace(/\D/g, '')}`;
  let digits = source.replace(/\D/g, '');
  if (!country) return digits;
  if (!country.keepLeadingZero) digits = digits.replace(/^0/, '');
  const dial = String(country.dial || '').replace(/\D/g, '');
  return `+${dial}${digits}`;
}

async function loadCatalogs() {
  const [countryData, questionData, planData] = await Promise.all([
    api('/payments/countries', { auth: false }),
    api('/auth/recovery-questions', { auth: false }),
    api('/plans', { auth: false }),
  ]);
  state.countries = countryData.countries || [];
  state.questions = questionData.questions || [];
  state.plans = planData.plans || [];
  renderCountrySelects();
  renderQuestions();
  renderPlans();
}

function renderCountrySelects() {
  const options = state.countries.map((country) =>
    `<option value="${escapeHtml(country.code)}">${escapeHtml(country.flag || '')} ${escapeHtml(country.name)} (${escapeHtml(country.dial)})</option>`
  ).join('');
  $$('.country-select').forEach((select) => { select.innerHTML = options; });
}

function renderQuestions() {
  $('#recovery-question').innerHTML = state.questions.map((question) =>
    `<option value="${escapeHtml(question.id)}">${escapeHtml(question.label)}</option>`
  ).join('');
}

function renderPlans() {
  const featuredId = state.plans.some((plan) => plan.id === 'monthly') ? 'monthly' : state.plans[0]?.id;
  $('#plans-grid').innerHTML = state.plans.map((plan) => {
    const featured = plan.id === featuredId;
    return `<article class="plan-card ${featured ? 'featured' : ''}">
      ${featured ? '<span class="plan-tag">POPULAIRE</span>' : ''}
      <h3>${escapeHtml(plan.label)}</h3>
      <span class="plan-days">${escapeHtml(plan.days)} jour${Number(plan.days) > 1 ? 's' : ''} d'accès</span>
      <div class="plan-price">${Number(plan.pricePromo).toLocaleString('fr-FR')} <small>XOF</small></div>
      <div class="old-price">${Number(plan.priceNormal) > Number(plan.pricePromo) ? `${Number(plan.priceNormal).toLocaleString('fr-FR')} XOF` : ''}</div>
      <button class="button ${featured ? 'button-primary' : 'button-outline'}" type="button" data-plan="${escapeHtml(plan.id)}">Choisir cette formule</button>
    </article>`;
  }).join('');
  $$('[data-plan]').forEach((button) => button.addEventListener('click', () => startPayment(button.dataset.plan)));
}

async function loadRaces() {
  const list = $('#race-list');
  list.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>';
  try {
    const data = await api('/races', { auth: false });
    state.racetracks = data.racetracks || [];
    renderRaces();
    updateHeroRace();
  } catch (error) {
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderRaces() {
  const list = $('#race-list');
  if (!state.racetracks.length) {
    list.innerHTML = '<div class="empty-state"><p>Aucune course disponible actuellement.</p></div>';
    return;
  }
  list.innerHTML = state.racetracks.map((track) => `
    <div class="track-label">${escapeHtml(track.name)}</div>
    ${(track.races || []).map((race) => `<button class="race-item ${race.id === state.selectedRaceId ? 'active' : ''}" type="button" data-race-id="${escapeHtml(race.id)}">
      <span class="race-time">${escapeHtml(race.time || `C${race.number || ''}`)}</span>
      <span><strong>${escapeHtml(race.name)}</strong><small>${escapeHtml(race.distance || '')} · ${escapeHtml(race.runners || 0)} partants</small></span>
      <span class="race-arrow">›</span>
    </button>`).join('')}
  `).join('');
  $$('.race-item', list).forEach((button) => button.addEventListener('click', () => selectRace(button.dataset.raceId)));
}

function firstRace() {
  for (const track of state.racetracks) {
    if (track.races?.length) return { track, race: track.races[0] };
  }
  return null;
}

async function updateHeroRace() {
  const first = firstRace();
  if (!first) return;
  $('#hero-track').textContent = first.track.name;
  $('#hero-race').textContent = first.race.name;
  $('#hero-race-time').textContent = first.race.time || 'Aujourd’hui';
  $('#hero-meta').textContent = [first.race.distance, first.race.type, `${first.race.runners || 0} partants`].filter(Boolean).join(' · ');
  $('#hero-race-status').textContent = first.race.isQuinte ? 'COURSE QUINTÉ+' : 'COURSE À ANALYSER';
  try {
    const detail = await api(`/races/${encodeURIComponent(first.race.id)}`, { auth: false });
    const horses = (detail.horses || []).slice(0, 3);
    $('#selection-preview').innerHTML = horses.map((horse, index) => `<div class="pick ${index === 0 ? 'main-pick' : ''}">
      <span>${escapeHtml(horse.number)}</span><div><small>${index === 0 ? 'APERÇU' : 'PARTANT'}</small><strong>${escapeHtml(horse.name)}</strong></div><b>${horse.odds != null ? escapeHtml(horse.odds) : '—'}</b>
    </div>`).join('');
  } catch (_) { /* The main races list remains usable. */ }
}

function findRace(id) {
  for (const track of state.racetracks) {
    const race = (track.races || []).find((item) => item.id === id);
    if (race) return { track, race };
  }
  return null;
}

async function selectRace(id) {
  state.selectedRaceId = id;
  renderRaces();
  const context = findRace(id);
  const detailNode = $('#race-detail');
  detailNode.innerHTML = '<div class="empty-state"><div class="skeleton-line" style="width:80%"></div><div class="skeleton-line" style="width:100%"></div></div>';
  try {
    const detail = await api(`/races/${encodeURIComponent(id)}`, { auth: false });
    let prediction = null;
    let predictionError = null;
    if (state.token) {
      try { prediction = await api(`/races/${encodeURIComponent(id)}/prediction`); }
      catch (error) { predictionError = error; }
    }
    renderRaceDetail(context, detail, prediction, predictionError);
  } catch (error) {
    detailNode.innerHTML = `<div class="empty-state"><h3>Détail indisponible</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function predictionMarkup(prediction, error) {
  if (prediction?.topPicks?.length) {
    return `<section class="prediction-block"><div class="prediction-title"><h4>Pronostic ParisPromax</h4><span>${escapeHtml((prediction.source || 'IA').toUpperCase())}</span></div><div class="prediction-picks">
      ${prediction.topPicks.slice(0, 7).map((pick) => `<div class="prediction-pick"><b>${escapeHtml(pick.number)}</b><span>${escapeHtml(pick.name)}<small>Score ${Math.round(Number(pick.aiScore || 0))}/100</small></span></div>`).join('')}
    </div></section>`;
  }
  if (state.token && error?.status === 402) {
    return '<section class="prediction-block locked-prediction"><h4>Accès complet requis</h4><p>Choisissez une formule pour afficher le pronostic détaillé de cette course.</p><a class="button button-primary" href="#abonnements">Voir les formules</a></section>';
  }
  if (state.token) return `<section class="prediction-block locked-prediction"><p>${escapeHtml(error?.message || 'Pronostic en cours de préparation.')}</p></section>`;
  return '<section class="prediction-block locked-prediction"><h4>Connectez-vous pour voir le pronostic</h4><p>Les partants et les cotes restent accessibles ci-dessous.</p><button class="button button-primary" type="button" data-race-login>Se connecter</button></section>';
}

function renderRaceDetail(context, detail, prediction, predictionError) {
  const horses = detail.horses || [];
  $('#race-detail').innerHTML = `<div class="detail-head"><div><span class="section-kicker">${escapeHtml(context?.track?.name || detail.track || 'COURSE')}</span><h3>${escapeHtml(detail.name)}</h3><p>${[detail.time, detail.distance, detail.type || detail.discipline, dateLabel(detail.date)].filter(Boolean).map(escapeHtml).join(' · ')}</p></div><span class="race-badge">${horses.length} PARTANTS</span></div>
    ${predictionMarkup(prediction, predictionError)}
    <div class="table-wrap"><table class="horse-table"><thead><tr><th>N°</th><th>Cheval</th><th>Jockey / entraîneur</th><th>Forme</th><th>Cote</th></tr></thead><tbody>
      ${horses.map((horse) => `<tr><td><span class="horse-num">${escapeHtml(horse.number)}</span></td><td><span class="horse-name">${escapeHtml(horse.name)}</span>${horse.nonPartant ? '<span class="horse-sub">Non-partant</span>' : ''}</td><td><span>${escapeHtml(horse.jockey || '—')}</span><span class="horse-sub">${escapeHtml(horse.trainer || '')}</span></td><td>${escapeHtml(horse.form || '—')}</td><td class="odds">${horse.odds != null ? escapeHtml(horse.odds) : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  const loginButton = $('[data-race-login]');
  if (loginButton) loginButton.addEventListener('click', () => openAuth('login'));
}

async function login(form) {
  const data = Object.fromEntries(new FormData(form));
  const phone = normalizePhone(data.phone, data.country);
  const result = await api('/auth/login', {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ phone, password: data.password, country: data.country }),
    timeout: 60000,
  });
  state.token = result.token;
  sessionStorage.setItem('ppm_web_token', state.token);
  closeDialogs();
  await refreshMe();
  toast('Connexion réussie');
  if (state.selectedRaceId) selectRace(state.selectedRaceId);
}

async function register(form) {
  const data = Object.fromEntries(new FormData(form));
  const phone = normalizePhone(data.phone, data.country);
  const result = await api('/auth/register', {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ ...data, phone }),
    timeout: 90000,
  });
  $('#recovery-code').textContent = result.recoveryCode || 'Non disponible';
  closeDialogs();
  openDialog('#recovery-dialog');
  const loginForm = $('#login-form');
  loginForm.elements.phone.value = phone;
  loginForm.elements.country.value = data.country;
  form.reset();
}

async function refreshMe() {
  if (!state.token) return renderSession();
  try {
    state.me = await api('/me');
  } catch (error) {
    if (error.status === 401) {
      state.token = '';
      state.me = null;
      sessionStorage.removeItem('ppm_web_token');
    }
  }
  renderSession();
}

function renderSession() {
  const loggedIn = Boolean(state.token && state.me);
  $$('[data-open-auth]').forEach((button) => button.classList.toggle('hidden', loggedIn));
  $('#account-button').classList.toggle('hidden', !loggedIn);
  $('#espace').classList.toggle('hidden', !loggedIn);
  if (!loggedIn) return;
  const { user, access, referral } = state.me;
  $('#account-title').textContent = `Bienvenue, ${user.firstName || 'dans votre espace'}.`;
  $('#account-phone').textContent = user.phone;
  const country = state.countries.find((item) => item.code === user.country);
  $('#account-country').textContent = country?.name || user.country?.toUpperCase() || 'Pays non renseigné';
  $('#referral-code').textContent = referral?.code || '—';
  $('#access-label').textContent = access?.hasAccess ? 'Accès actif' : 'Accès limité';
  $('#access-detail').textContent = access?.hasAccess
    ? `Formule ${access.plan || 'active'}${access.paidUntil ? ` · jusqu’au ${dateLabel(access.paidUntil)}` : ''}`
    : 'Choisissez une formule pour débloquer les pronostics complets.';
}

function logout() {
  state.token = '';
  state.me = null;
  sessionStorage.removeItem('ppm_web_token');
  renderSession();
  toast('Vous êtes déconnecté');
  window.location.hash = 'accueil';
  if (state.selectedRaceId) selectRace(state.selectedRaceId);
}

async function startPayment(planId) {
  if (!state.token || !state.me) {
    openAuth('login');
    setMessage('#auth-message', 'Connectez-vous d’abord pour activer une formule.');
    return;
  }
  const plan = state.plans.find((item) => item.id === planId);
  if (!plan) return;
  state.selectedPlan = plan;
  state.payment = { provider: null, operator: null, otpMode: 'none', transactionId: null };
  $('#payment-title').textContent = `${plan.label} · ${formatXof(plan.pricePromo)}`;
  $('#payment-summary').textContent = `${plan.days} jour${plan.days > 1 ? 's' : ''} d’accès, sans reconduction automatique.`;
  $('#payment-phone').value = state.me.user.phone || '';
  $('#payment-otp').value = '';
  setMessage('#payment-message', '');
  openDialog('#payment-dialog');
  try {
    const providerData = await api(`/payments/providers?country=${encodeURIComponent(state.me.user.country)}`, { auth: false });
    state.payment.provider = providerData.default || providerData.providers?.[0]?.id;
    if (state.payment.provider === 'yengapay') await loadYengaOperators();
    else renderGenericProvider(providerData.providers || []);
  } catch (error) {
    setMessage('#payment-message', error.message);
  }
}

async function loadYengaOperators() {
  const data = await api(`/payments/yengapay/operators?country=${encodeURIComponent(state.me.user.country)}`, { auth: false });
  const details = data.operatorDetails || [];
  $('#operator-list').innerHTML = details.map((operator, index) => `<button class="operator-chip ${index === 0 ? 'active' : ''}" type="button" data-operator="${escapeHtml(operator.code)}" data-otp-mode="${escapeHtml(operator.otpMode)}">${escapeHtml(operator.name)}</button>`).join('');
  if (details[0]) {
    state.payment.operator = details[0].code;
    state.payment.otpMode = details[0].otpMode;
  }
  $$('.operator-chip').forEach((button) => button.addEventListener('click', () => {
    $$('.operator-chip').forEach((chip) => chip.classList.remove('active'));
    button.classList.add('active');
    state.payment.operator = button.dataset.operator;
    state.payment.otpMode = button.dataset.otpMode;
    state.payment.transactionId = null;
    $('#payment-otp').value = '';
    updateOtpUi();
  }));
  updateOtpUi();
}

function renderGenericProvider(providers) {
  $('#operator-list').innerHTML = providers.map((provider, index) => `<button class="operator-chip ${index === 0 ? 'active' : ''}" type="button" data-provider="${escapeHtml(provider.id)}">${escapeHtml(provider.label)}</button>`).join('');
  $$('.operator-chip').forEach((button) => button.addEventListener('click', () => {
    $$('.operator-chip').forEach((chip) => chip.classList.remove('active'));
    button.classList.add('active');
    state.payment.provider = button.dataset.provider;
  }));
  $('#otp-field').classList.add('hidden');
  $('#payment-submit').textContent = 'Ouvrir le paiement sécurisé';
}

function updateOtpUi() {
  const needsCustomerOtp = state.payment.otpMode === 'customer';
  const needsServerOtp = state.payment.otpMode === 'server' && Boolean(state.payment.transactionId);
  $('#otp-field').classList.toggle('hidden', !(needsCustomerOtp || needsServerOtp));
  $('#payment-submit').textContent = state.payment.otpMode === 'server' && !state.payment.transactionId
    ? 'Recevoir le code OTP'
    : state.payment.otpMode === 'none' ? 'Envoyer la demande' : 'Valider le paiement';
}

async function submitPayment(form) {
  const submit = $('#payment-submit');
  submit.disabled = true;
  setMessage('#payment-message', 'Traitement sécurisé en cours…', true);
  try {
    if (state.payment.provider !== 'yengapay') {
      const result = await api('/payments/initiate', { method: 'POST', body: JSON.stringify({ planId: state.selectedPlan.id, provider: state.payment.provider }) });
      if (result.paymentUrl) window.location.assign(result.paymentUrl);
      else throw new Error('Le prestataire n’a pas fourni de page de paiement.');
      return;
    }
    const otp = $('#payment-otp').value.trim();
    if (state.payment.otpMode === 'customer' && otp.length < 4) throw new Error('Saisissez le code OTP fourni par votre opérateur.');
    if (state.payment.otpMode === 'server' && state.payment.transactionId && otp.length < 4) throw new Error('Saisissez le code OTP reçu par SMS.');
    const result = await api('/payments/yengapay/mobile', {
      method: 'POST',
      body: JSON.stringify({
        planId: state.selectedPlan.id,
        phone: $('#payment-phone').value,
        operator: state.payment.operator,
        otp,
        transactionId: state.payment.transactionId,
      }),
      timeout: 60000,
    });
    if (result.status === 'otp_required') {
      state.payment.transactionId = result.transactionId;
      updateOtpUi();
      setMessage('#payment-message', result.providerMessage || 'Code OTP envoyé. Saisissez-le pour continuer.', true);
      $('#payment-otp').focus();
      return;
    }
    if (result.status === 'success') {
      setMessage('#payment-message', 'Paiement confirmé. Votre accès est actif.', true);
      await refreshMe();
      setTimeout(closeDialogs, 1200);
      return;
    }
    setMessage('#payment-message', result.providerMessage || 'Validez la demande reçue sur votre téléphone.', true);
    if (result.transactionId) pollPayment(result.transactionId);
  } catch (error) {
    setMessage('#payment-message', error.data?.reason || error.message);
  } finally {
    submit.disabled = false;
  }
}

async function pollPayment(transactionId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      const result = await api(`/payments/status/${encodeURIComponent(transactionId)}`);
      if (result.status === 'success') {
        setMessage('#payment-message', 'Paiement confirmé. Votre accès est actif.', true);
        await refreshMe();
        setTimeout(closeDialogs, 1200);
        return;
      }
      if (result.status === 'failed') {
        setMessage('#payment-message', 'Le paiement n’a pas abouti. Vous pouvez réessayer.');
        return;
      }
    } catch (_) { /* Keep polling while the provider confirms. */ }
  }
  setMessage('#payment-message', 'Confirmation en attente. Votre accès s’activera automatiquement après validation.', true);
}

function bindEvents() {
  $$('[data-open-auth]').forEach((button) => button.addEventListener('click', () => openAuth(button.dataset.openAuth)));
  $$('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => switchAuthTab(button.dataset.authTab)));
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  $$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  }));
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    setMessage('#auth-message', 'Connexion en cours…', true);
    try { await login(event.currentTarget); }
    catch (error) { setMessage('#auth-message', error.message); }
    finally { button.disabled = false; }
  });
  $('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    setMessage('#auth-message', 'Création du compte…', true);
    try { await register(event.currentTarget); }
    catch (error) { setMessage('#auth-message', error.message); }
    finally { button.disabled = false; }
  });
  $('#continue-login').addEventListener('click', () => { closeDialogs(); openAuth('login'); });
  $('#payment-form').addEventListener('submit', (event) => { event.preventDefault(); submitPayment(event.currentTarget); });
  $('#refresh-races').addEventListener('click', loadRaces);
  $('#logout-button').addEventListener('click', logout);
  $('#account-button').addEventListener('click', () => { window.location.hash = 'espace'; });
  $('#copy-referral').addEventListener('click', async () => {
    const code = $('#referral-code').textContent;
    if (code && code !== '—') { await navigator.clipboard.writeText(code); toast('Code copié'); }
  });
  const menuButton = $('#menu-button');
  menuButton.addEventListener('click', () => {
    const open = $('#mobile-nav').classList.toggle('hidden') === false;
    menuButton.setAttribute('aria-expanded', String(open));
  });
  $$('#mobile-nav a').forEach((link) => link.addEventListener('click', () => {
    $('#mobile-nav').classList.add('hidden');
    menuButton.setAttribute('aria-expanded', 'false');
  }));
}

async function boot() {
  bindEvents();
  try { await loadCatalogs(); }
  catch (error) { toast(`Configuration indisponible : ${error.message}`); }
  await Promise.all([loadRaces(), refreshMe()]);
}

boot();
