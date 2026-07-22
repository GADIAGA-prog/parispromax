const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: sessionStorage.getItem('ppm_web_token') || '',
  countries: [],
  questions: [],
  plans: [],
  racetracks: [],
  raceDate: null,
  nationalCountry: localStorage.getItem('ppm_quinte_country') || 'bf',
  me: null,
  notifications: [],
  selectedRaceId: null,
  selectedPlan: null,
  recovery: { phone: '', country: 'bf' },
  payment: { provider: null, operator: null, otpMode: 'none', transactionId: null },
};

const FALLBACK_COUNTRIES = [
  { code: 'bf', flag: '🇧🇫', name: 'Burkina Faso' },
  { code: 'ci', flag: '🇨🇮', name: "Côte d'Ivoire" },
  { code: 'sn', flag: '🇸🇳', name: 'Sénégal' },
  { code: 'tg', flag: '🇹🇬', name: 'Togo' },
  { code: 'bj', flag: '🇧🇯', name: 'Bénin' },
  { code: 'ml', flag: '🇲🇱', name: 'Mali' },
  { code: 'ne', flag: '🇳🇪', name: 'Niger' },
];

let deferredInstallPrompt = null;

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function setInstallButtonsVisible(visible) {
  $$('[data-install-app]').forEach((button) => button.classList.toggle('hidden', !visible));
}

function installationSteps() {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) {
    return [
      'Ouvrez ParisPromax dans Safari.',
      'Touchez le bouton Partager.',
      'Choisissez « Sur l’écran d’accueil », activez « Ouvrir comme app web », puis touchez « Ajouter ».',
    ];
  }
  if (/android/.test(ua)) {
    return [
      'Ouvrez le menu ⋮ de votre navigateur.',
      'Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».',
      'Confirmez avec « Installer ».',
    ];
  }
  return [
    'Ouvrez le menu de Chrome ou Edge, ou utilisez l’icône d’installation dans la barre d’adresse.',
    'Choisissez « Installer ParisPromax ».',
    'Confirmez : ParisPromax s’ouvrira ensuite dans sa propre fenêtre.',
  ];
}

async function requestAppInstallation() {
  if (isStandaloneApp()) {
    toast('ParisPromax est déjà installé');
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (choice.outcome === 'accepted') setInstallButtonsVisible(false);
    return;
  }
  const steps = installationSteps();
  $('#install-steps').innerHTML = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  openDialog('#install-dialog');
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  setInstallButtonsVisible(true);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  setInstallButtonsVisible(false);
  toast('ParisPromax est installé');
});

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

function safeHttpUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function siteSharePayload() {
  return {
    title: 'ParisPromax',
    text: 'Découvrez ParisPromax : Quinté par pays, pronostics hippiques commentés et sélection finale Podium + 2.',
    url: new URL('/', window.location.origin).href,
  };
}

function prepareSiteShareLinks() {
  const payload = siteSharePayload();
  const links = {
    telegram: `https://t.me/share/url?url=${encodeURIComponent(payload.url)}&text=${encodeURIComponent(payload.text)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(payload.url)}`,
  };
  $$('[data-share-platform]').forEach((link) => {
    link.href = links[link.dataset.sharePlatform] || payload.url;
  });
}

function showShareMessage(message) {
  const node = $('#share-message');
  if (!node) return;
  node.textContent = message;
  clearTimeout(showShareMessage.timer);
  showShareMessage.timer = setTimeout(() => { node.textContent = ''; }, 3200);
}

async function copyPlainText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_) {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
}

async function copySiteLink() {
  const { url } = siteSharePayload();
  await copyPlainText(url);
  showShareMessage('Lien ParisPromax copié. Vous pouvez maintenant le partager.');
  toast('Lien du site copié');
}

async function shareSite() {
  const payload = siteSharePayload();
  if (navigator.share) {
    try {
      await navigator.share(payload);
      showShareMessage('Merci d’avoir partagé ParisPromax.');
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  await copySiteLink();
}

function normalizeReferralCodeClient(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

function referralUrl(code) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('ref', normalizeReferralCodeClient(code));
  return url.href;
}

function currentReferralCode() {
  return normalizeReferralCodeClient(state.me?.referral?.code || $('#referral-code')?.textContent);
}

function showReferralMessage(message) {
  const node = $('#referral-message');
  if (!node) return;
  node.textContent = message;
  clearTimeout(showReferralMessage.timer);
  showReferralMessage.timer = setTimeout(() => { node.textContent = ''; }, 3500);
}

async function copyReferralCode() {
  const code = currentReferralCode();
  if (!code) return;
  await copyPlainText(code);
  showReferralMessage('Code de parrainage copié.');
  toast('Code copié');
}

async function copyReferralLink() {
  const code = currentReferralCode();
  if (!code) return;
  await copyPlainText(referralUrl(code));
  showReferralMessage('Lien personnel copié. Le code sera prérempli à l’inscription.');
  toast('Lien de parrainage copié');
}

async function shareReferralLink() {
  const code = currentReferralCode();
  if (!code) return;
  const payload = {
    title: 'Rejoignez ParisPromax',
    text: `Je vous invite sur ParisPromax avec mon code ${code}.`,
    url: referralUrl(code),
  };
  if (navigator.share) {
    try {
      await navigator.share(payload);
      showReferralMessage('Invitation partagée.');
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  await copyReferralLink();
}

function applyReferralInvitation() {
  if (state.token && state.me) return;
  const code = normalizeReferralCodeClient(new URLSearchParams(window.location.search).get('ref'));
  if (!code) return;
  const form = $('#register-form');
  form.elements.referralCode.value = code;
  openAuth('register');
  setMessage('#auth-message', `Code de parrainage ${code} appliqué automatiquement.`, true);
}

function loginErrorMessage(error) {
  if (error?.status >= 500) return 'Connexion temporairement indisponible. Réessayez dans un instant.';
  return error?.message || 'Impossible de se connecter pour le moment.';
}

function resetPasswordRecoveryUi() {
  $('#recovery-identify-form').classList.remove('hidden');
  $('#recovery-reset-form').classList.add('hidden');
  $('#recovery-reset-form').reset();
  setMessage('#password-recovery-message', '');
  state.recovery = { phone: '', country: 'bf' };
}

function openPasswordRecovery() {
  resetPasswordRecoveryUi();
  const loginForm = $('#login-form');
  const form = $('#recovery-identify-form');
  form.elements.country.value = loginForm.elements.country.value || 'bf';
  form.elements.phone.value = loginForm.elements.phone.value || '';
  closeDialogs();
  openDialog('#password-recovery-dialog');
}

async function identifyRecoveryAccount(form) {
  const data = Object.fromEntries(new FormData(form));
  const phone = normalizePhone(data.phone, data.country);
  const result = await api('/auth/recovery-question', {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  state.recovery = { phone, country: data.country };
  $('#recovery-question-label').textContent = result.question;
  form.classList.add('hidden');
  $('#recovery-reset-form').classList.remove('hidden');
  setMessage('#password-recovery-message', 'Question de sécurité trouvée.', true);
}

async function resetPasswordWithSecurity(form) {
  const data = Object.fromEntries(new FormData(form));
  const result = await api('/auth/reset-password-security', {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ phone: state.recovery.phone, ...data }),
    timeout: 60000,
  });
  $('#recovery-code').textContent = result.recoveryCode || 'Non disponible';
  $('#recovery-success-title').textContent = 'Mot de passe modifié';
  $('#recovery-success-copy').textContent = 'Notez votre nouveau code de récupération. Il remplace l’ancien et ne sera affiché qu’une seule fois.';
  const loginForm = $('#login-form');
  loginForm.elements.phone.value = state.recovery.phone;
  loginForm.elements.country.value = state.recovery.country;
  form.reset();
  closeDialogs();
  openDialog('#recovery-dialog');
}

function setChatboxOpen(open) {
  $('#chatbox').classList.toggle('hidden', !open);
  $('#chat-toggle').setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => $('#chat-input').focus(), 0);
}

function chatAnswer(question) {
  const normalized = String(question || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/connexion|connecter|mot de passe|serveur/.test(normalized)) {
    return { text: 'Vérifiez le pays et le numéro, puis réessayez. Si le mot de passe est refusé, utilisez « Mot de passe oublié ? » sous le formulaire de connexion.', label: 'Ouvrir la connexion', auth: 'login' };
  }
  if (/parrain|invitation|code/.test(normalized)) {
    return state.me
      ? { text: 'Votre code et votre lien personnel sont visibles dans Mon espace. Le lien préremplit automatiquement votre code chez le nouveau membre.', label: 'Voir mon espace', target: '#espace' }
      : { text: 'Connectez-vous pour afficher votre code et partager votre lien personnel de parrainage.', label: 'Se connecter', auth: 'login' };
  }
  if (/abonnement|formule|acces|prix/.test(normalized)) {
    return { text: 'Les formules disponibles sont prépayées et sans reconduction automatique. Vous pouvez les consulter dans la section Abonnements.', label: 'Voir les abonnements', target: '#abonnements' };
  }
  if (/pronostic|course|quinte|cote|cheval/.test(normalized)) {
    return { text: 'Les courses, cotes et analyses sont regroupées dans le programme du jour. Le pronostic final suit le format Podium + 2.', label: 'Voir les courses', target: '#courses' };
  }
  if (/paiement|mobile money|otp/.test(normalized)) {
    return { text: 'Choisissez une formule, puis suivez les instructions de l’opérateur affiché. Ne saisissez jamais votre code PIN Mobile Money sur ParisPromax.', label: 'Voir les formules', target: '#abonnements' };
  }
  if (/telegram|canal/.test(normalized)) {
    return { text: 'Le canal Telegram officiel publie les actualités, programmes et analyses ParisPromax.', label: 'Rejoindre Telegram', target: 'https://t.me/ParisPromaxOfficiel', external: true };
  }
  return { text: 'Je peux vous guider sur la connexion, le parrainage, les abonnements, les paiements et les pronostics. Pour une demande personnelle, contactez l’équipe.', label: 'Contacter ParisPromax', target: '#contact' };
}

function appendChatMessage(role, text, action) {
  const messages = $('#chat-messages');
  const node = document.createElement('div');
  node.className = `chat-message ${role}`;
  node.append(document.createTextNode(text));
  if (action?.label) {
    const link = document.createElement('a');
    link.href = action.auth ? '#' : action.target;
    link.textContent = `${action.label} →`;
    if (action.external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.addEventListener('click', (event) => {
      if (action.auth) { event.preventDefault(); setChatboxOpen(false); openAuth(action.auth); }
      else if (!action.external) setChatboxOpen(false);
    });
    node.append(link);
  }
  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

function askChat(question) {
  const labels = {
    connexion: 'Je n’arrive pas à me connecter',
    parrainage: 'Comment partager mon code de parrainage ?',
    abonnement: 'Quelles sont les formules ?',
    pronostics: 'Où voir les pronostics ?',
  };
  const text = labels[question] || String(question || '').trim();
  if (!text) return;
  appendChatMessage('user', text);
  const answer = chatAnswer(text);
  setTimeout(() => appendChatMessage('bot', answer.text, answer), 180);
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
  if (!state.countries.some((country) => country.code === state.nationalCountry)) {
    state.nationalCountry = state.countries[0]?.code || 'bf';
  }
  const nationalSelect = $('#quinte-country');
  nationalSelect.innerHTML = state.countries.map((country) =>
    `<option value="${escapeHtml(country.code)}">${escapeHtml(country.flag || '')} ${escapeHtml(country.name)}</option>`
  ).join('');
  nationalSelect.value = state.nationalCountry;
  renderCountryMarquee();
}

function renderCountryMarquee() {
  const track = $('#country-marquee-track');
  if (!track) return;
  const countries = state.countries.length ? state.countries : FALLBACK_COUNTRIES;
  const items = countries.map((country) =>
    `<span class="country-marquee-item" role="listitem"><span class="country-marquee-flag">${escapeHtml(country.flag || '🌍')}</span>${escapeHtml(country.name)}</span>`
  ).join('');
  track.innerHTML = `<div class="country-marquee-group" role="list">${items}</div><div class="country-marquee-group" aria-hidden="true">${items}</div>`;
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
    state.raceDate = data.meta?.date || null;
    $('#program-kicker').textContent = state.raceDate ? `PROGRAMME DU ${dateLabel(state.raceDate).toUpperCase()}` : 'PROGRAMME DISPONIBLE';
    renderRaces();
    buildMemberNotifications();
    updateHeroRace();
    await loadNationalSpotlight();
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
      <span><strong>${escapeHtml(race.name)} ${race.isQuinte ? '<em class="quinte-mini">Q+</em>' : ''}</strong><small>${escapeHtml(race.distance || '')} · ${escapeHtml(race.runners || 0)} partants</small></span>
      <span class="race-arrow">›</span>
    </button>`).join('')}
  `).join('');
  $$('.race-item', list).forEach((button) => button.addEventListener('click', () => selectRace(button.dataset.raceId)));
}

function firstRace() {
  for (const track of state.racetracks) {
    const quinte = track.races?.find((race) => race.isQuinte);
    if (quinte) return { track, race: quinte };
  }
  for (const track of state.racetracks) {
    if (track.races?.length) return { track, race: track.races[0] };
  }
  return null;
}

function notificationStorageKey() {
  const userId = state.me?.user?.id;
  return userId ? `ppm_notifications_seen:${userId}` : '';
}

function seenNotificationIds() {
  const key = notificationStorageKey();
  if (!key) return new Set();
  try {
    const ids = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function buildMemberNotifications() {
  if (!state.token || !state.me) {
    state.notifications = [];
    renderNotificationUi();
    return;
  }

  const notifications = [];
  const access = state.me.access || {};
  if (access.hasAccess) {
    const paidUntil = access.paidUntil ? new Date(access.paidUntil) : null;
    const daysLeft = paidUntil && !Number.isNaN(paidUntil.getTime())
      ? Math.ceil((paidUntil.getTime() - Date.now()) / 86400000)
      : null;
    const expiring = daysLeft != null && daysLeft <= 3;
    notifications.push({
      id: `access-active-${access.plan || 'active'}-${access.paidUntil || 'unlimited'}`,
      icon: expiring ? '⏳' : '✓',
      tone: expiring ? 'warning' : 'success',
      title: expiring ? 'Votre accès expire bientôt' : 'Votre accès est actif',
      message: paidUntil
        ? `${access.plan ? `Formule ${access.plan} · ` : ''}valable jusqu’au ${dateLabel(access.paidUntil)}.`
        : 'Vos pronostics complets sont disponibles.',
      target: '#espace',
      action: 'Voir mon espace',
    });
  } else {
    notifications.push({
      id: 'access-required',
      icon: '!',
      tone: 'warning',
      title: 'Accès aux pronostics limité',
      message: 'Activez une formule pour consulter les analyses et le pronostic final Podium + 2.',
      target: '#abonnements',
      action: 'Voir les abonnements',
    });
  }

  const featured = firstRace();
  if (featured) {
    const { track, race } = featured;
    notifications.push({
      id: `race-${state.raceDate || 'today'}-${race.id}`,
      icon: race.isQuinte ? 'Q+' : '🏇',
      tone: 'success',
      title: race.isQuinte ? 'Le Quinté+ du jour est disponible' : 'La course principale est disponible',
      message: `${track.name} · ${race.name}${race.time ? ` · départ ${race.time}` : ''}.`,
      target: '#courses',
      action: 'Voir la course',
      raceId: race.id,
    });
  }

  state.notifications = notifications;
  renderNotificationUi();
}

function renderNotificationUi() {
  const loggedIn = Boolean(state.token && state.me);
  $$('[data-open-notifications]').forEach((button) => button.classList.toggle('hidden', !loggedIn));
  $('#mobile-member-actions')?.classList.toggle('hidden', !loggedIn);

  const seen = seenNotificationIds();
  const unreadCount = loggedIn ? state.notifications.filter((item) => !seen.has(item.id)).length : 0;
  $$('[data-notification-badge]').forEach((badge) => {
    badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    badge.classList.toggle('hidden', unreadCount === 0);
  });
  $$('[data-open-notifications]').forEach((button) => {
    button.setAttribute('aria-label', unreadCount
      ? `Ouvrir les notifications, ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}`
      : 'Ouvrir les notifications');
  });

  const list = $('#notification-list');
  if (!list) return;
  if (!loggedIn || !state.notifications.length) {
    list.innerHTML = '<div class="notification-empty">Aucune notification pour le moment.</div>';
  } else {
    list.innerHTML = state.notifications.map((item) => {
      const unread = !seen.has(item.id);
      return `<article class="notification-item ${escapeHtml(item.tone)} ${unread ? 'unread' : ''}">
        <span class="notification-item-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
        <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.message)}</p>
          <button type="button" data-notification-id="${escapeHtml(item.id)}" data-notification-target="${escapeHtml(item.target)}" ${item.raceId ? `data-notification-race="${escapeHtml(item.raceId)}"` : ''}>${escapeHtml(item.action)} →</button>
        </div>
      </article>`;
    }).join('');
  }
  const readAll = $('#notification-read-all');
  if (readAll) readAll.disabled = unreadCount === 0;
  $$('[data-notification-id]', list).forEach((button) => button.addEventListener('click', async () => {
    markNotificationsRead([button.dataset.notificationId]);
    closeDialogs();
    const raceId = button.dataset.notificationRace;
    if (raceId) await selectRace(raceId);
    const target = $(button.dataset.notificationTarget);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function markNotificationsRead(ids = state.notifications.map((item) => item.id)) {
  const key = notificationStorageKey();
  if (!key) return;
  const seen = seenNotificationIds();
  ids.forEach((id) => seen.add(String(id)));
  try { localStorage.setItem(key, JSON.stringify([...seen].slice(-100))); }
  catch (_) { /* The notification centre still works without local persistence. */ }
  renderNotificationUi();
}

function openNotifications() {
  buildMemberNotifications();
  $('#mobile-nav').classList.add('hidden');
  $('#menu-button').setAttribute('aria-expanded', 'false');
  openDialog('#notification-dialog');
}

function countryDetails(code) {
  return state.countries.find((country) => country.code === code) || { code, name: String(code || '').toUpperCase(), flag: '🌍' };
}

function fallbackQuinte() {
  for (const track of state.racetracks) {
    const race = track.races?.find((item) => item.isQuinte);
    if (race) return { ...race, track: track.name };
  }
  return null;
}

async function loadNationalSpotlight() {
  const node = $('#national-race');
  const country = countryDetails(state.nationalCountry);
  node.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div>';
  try {
    const data = await api(`/races/national?country=${encodeURIComponent(state.nationalCountry)}`, { auth: false });
    const nationalRace = data.pick?.race || null;
    const race = nationalRace || fallbackQuinte();
    if (!race) {
      node.innerHTML = `<div class="national-empty"><strong>${escapeHtml(country.flag)} Sélection ${escapeHtml(country.name)}</strong><p>Le Quinté national est en cours de préparation. Revenez dans quelques instants.</p></div>`;
      return;
    }
    const isNational = Boolean(nationalRace);
    const journalUrl = safeHttpUrl(data.pick?.journalUrl);
    node.innerHTML = `
      <div class="quinte-seal" aria-hidden="true">Q<span>+</span></div>
      <div class="national-main">
        <span class="national-status">${escapeHtml(country.flag)} ${isNational ? `QUINTÉ ${country.name.toUpperCase()}` : 'PROGRAMME INTERNATIONAL'} · ${escapeHtml(dateLabel(data.date || race.date))}</span>
        <h4>${escapeHtml(race.name)}</h4>
        <p>${[race.track, race.number, race.time, race.distance, race.type || race.discipline].filter(Boolean).map(escapeHtml).join(' · ')}</p>
        <div class="national-tags"><span>${escapeHtml(data.pick?.betType || (race.isQuinte ? 'Quinté+' : 'Course du jour'))}</span><span>${escapeHtml(race.runners || 0)} partants</span><span>Pronostic final : 5 chevaux</span></div>
      </div>
      <div class="national-actions">
        <button class="button button-primary" type="button" data-national-race="${escapeHtml(race.id)}">Analyser cette course <span>→</span></button>
        ${journalUrl ? `<a class="journal-link" href="${escapeHtml(journalUrl)}" target="_blank" rel="noopener noreferrer">Journal hippique ↗</a>` : ''}
        ${!isNational ? '<small>La sélection nationale sera affichée dès sa validation.</small>' : '<small>Course officielle mise en avant pour votre pays.</small>'}
      </div>`;
    const button = $('[data-national-race]', node);
    if (button) button.addEventListener('click', async () => {
      await selectRace(button.dataset.nationalRace);
      $('.race-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } catch (error) {
    node.innerHTML = `<div class="national-empty"><strong>Programme momentanément indisponible</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
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

function enrichPick(pick, horses) {
  if (!pick) return null;
  const horse = horses.find((item) => String(item.number) === String(pick.number)) || {};
  return { ...horse, ...pick, odds: pick.odds ?? horse.odds, form: pick.form || horse.form };
}

function pickComment(role, pick) {
  if (!pick) return '';
  const score = Number(pick.aiScore);
  const podium = Number(pick.probaPodium);
  const facts = [];
  if (Number.isFinite(score) && score > 0) facts.push(`indice IA ${Math.round(score)}/100`);
  if (Number.isFinite(podium) && podium > 0) facts.push(`${Math.round(podium * 100)} % estimés pour le podium`);
  if (pick.odds != null && Number.isFinite(Number(pick.odds))) facts.push(`cote ${Number(pick.odds).toLocaleString('fr-FR')}`);
  if (pick.form) facts.push(`forme ${pick.form}`);
  const evidence = facts.length ? ` Repères disponibles : ${facts.join(', ')}.` : ' Les données disponibles invitent à garder une confiance mesurée.';
  const intros = {
    base: 'Point d’appui principal du modèle et premier cheval de la hiérarchie.',
    favorite: 'Référence actuelle du marché ; ce statut décrit la cote et ne garantit pas le résultat.',
    couple: 'Élément du duo recommandé autour de la base, choisi parmi les profils les mieux classés.',
    chance: 'Profil régulier retenu pour consolider la sélection autour de la base.',
    tocard: 'Profil plus spéculatif : potentiel intéressant, mais niveau de risque supérieur.',
    tip: pick.valueBet ? 'Signal de valeur détecté entre le classement du modèle et la cote.' : 'Complément à surveiller pour finaliser le Podium + 2.',
  };
  return `${intros[role] || 'Profil retenu dans la synthèse.'}${evidence}`;
}

function compactHorse(pick) {
  if (!pick) return '';
  return `<span class="compact-horse"><b>${escapeHtml(pick.number)}</b><span><strong>${escapeHtml(pick.name || `N° ${pick.number}`)}</strong><small>${pick.odds != null ? `Cote ${escapeHtml(pick.odds)}` : 'Cote non disponible'}</small></span></span>`;
}

function roleCard(label, subtitle, items, role, tone = '') {
  const available = (items || []).filter(Boolean);
  return `<article class="analysis-role ${tone}"><div class="role-head"><span>${escapeHtml(label)}</span><small>${escapeHtml(subtitle)}</small></div>
    ${available.length ? available.map((pick) => `<div class="role-horse">${compactHorse(pick)}<p>${escapeHtml(pickComment(role, pick))}</p></div>`).join('') : '<p class="role-empty">Aucun profil ne réunit assez de signaux pour recevoir cette étiquette aujourd’hui.</p>'}
  </article>`;
}

function predictionMarkup(prediction, error, detail) {
  if (prediction?.topPicks?.length) {
    const horses = detail?.horses || [];
    const groups = prediction.groups || {};
    const enrich = (pick) => enrichPick(pick, horses);
    const selectedSource = groups.selected?.length ? groups.selected : prediction.topPicks;
    const selected = selectedSource.slice(0, 5).map(enrich).filter(Boolean);
    const base = (groups.bases || selected.slice(0, 1)).map(enrich);
    const couple = (groups.couple || selected.slice(0, 2)).map(enrich);
    const chances = (groups.chances || selected.slice(2, 4)).map(enrich);
    const tocards = (groups.tocards || groups.outsiders || []).map(enrich);
    const marketFavorite = horses
      .filter((horse) => !horse.nonPartant && Number(horse.odds) > 1)
      .sort((a, b) => Number(a.odds) - Number(b.odds))[0];
    const tip = enrich(selected.find((pick) => pick.valueBet) || groups.regret || selected[4]);
    const finalLabels = ['1er podium', '2e podium', '3e podium', 'Complément 1', 'Complément 2'];
    return `<section class="prediction-block">
      <div class="prediction-title"><div><small>ANALYSE COMMENTÉE</small><h4>Pronostic ParisPromax</h4></div><span>${prediction.source === 'ltr' ? 'MODÈLE IA' : 'ANALYSE IA'}</span></div>
      <div class="final-verdict"><div><span>PRONOSTIC FINAL</span><h5>Podium + 2</h5><p>Une synthèse resserrée à cinq chevaux, classés par ordre de préférence.</p></div><div class="final-five">
        ${selected.map((pick, index) => `<div class="final-pick ${index < 3 ? 'podium' : 'complement'}"><small>${finalLabels[index]}</small><b>${escapeHtml(pick.number)}</b><span>${escapeHtml(pick.name)}</span></div>`).join('')}
      </div></div>
      <div class="analysis-grid">
        ${roleCard('Base', 'Point d’appui', base, 'base', 'role-base')}
        ${roleCard('Favori', 'Lecture du marché', marketFavorite ? [enrich(marketFavorite)] : [], 'favorite', 'role-favorite')}
        ${roleCard('Couplé', 'Duo recommandé', couple, 'couple', 'role-couple')}
        ${roleCard('Chances régulières', 'Profils solides', chances, 'chance', 'role-chance')}
        ${roleCard('Tocard', 'Risque assumé', tocards, 'tocard', 'role-tocard')}
        ${roleCard('Tuyau', 'Signal à suivre', tip ? [tip] : [], 'tip', 'role-tip')}
      </div>
      <p class="analysis-disclaimer">Analyse statistique informative. Les commentaires expliquent les données disponibles et ne constituent jamais une garantie de résultat.</p>
    </section>`;
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
    ${predictionMarkup(prediction, predictionError, detail)}
    <div class="table-wrap"><table class="horse-table"><thead><tr><th>N°</th><th>Cheval</th><th>Jockey / entraîneur</th><th>Forme</th><th>Cote</th></tr></thead><tbody>
      ${horses.map((horse) => `<tr><td><span class="horse-num">${escapeHtml(horse.number)}</span></td><td><span class="horse-name">${escapeHtml(horse.name)}</span>${horse.nonPartant ? '<span class="horse-sub">Non-partant</span>' : ''}</td><td><span>${escapeHtml(horse.jockey || '—')}</span><span class="horse-sub">${escapeHtml(horse.trainer || '')}</span></td><td>${escapeHtml(horse.form || '—')}</td><td class="odds">${horse.odds != null ? escapeHtml(horse.odds) : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  const loginButton = $('[data-race-login]');
  if (loginButton) loginButton.addEventListener('click', () => openAuth('login'));
}

async function login(form) {
  const data = Object.fromEntries(new FormData(form));
  const phone = normalizePhone(data.phone, data.country);
  const options = {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ phone, password: data.password, country: data.country }),
    timeout: 60000,
  };
  let result;
  try {
    result = await api('/auth/login', options);
  } catch (error) {
    if (error.status < 500) throw error;
    result = await api('/auth/login', options);
  }
  state.token = result.token;
  sessionStorage.setItem('ppm_web_token', state.token);
  await refreshMe();
  if (!state.me) {
    state.token = '';
    sessionStorage.removeItem('ppm_web_token');
    throw new Error('La session n’a pas pu être ouverte. Réessayez.');
  }
  closeDialogs();
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
  $('#recovery-success-title').textContent = 'Compte créé';
  $('#recovery-success-copy').textContent = 'Notez ce code de récupération dans un endroit sûr. Il ne sera affiché qu’une seule fois.';
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
  buildMemberNotifications();
  if (!loggedIn) {
    $('#referral-link').value = '';
    return;
  }
  const { user, access, referral } = state.me;
  $('#account-title').textContent = `Bienvenue, ${user.firstName || 'dans votre espace'}.`;
  $('#account-phone').textContent = user.phone;
  const country = state.countries.find((item) => item.code === user.country);
  $('#account-country').textContent = country?.name || user.country?.toUpperCase() || 'Pays non renseigné';
  const referralCode = normalizeReferralCodeClient(referral?.code);
  $('#referral-code').textContent = referralCode || '—';
  $('#referral-link').value = referralCode ? referralUrl(referralCode) : '';
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

function renderReviewSummary(summary = {}) {
  const count = Number(summary.count) || 0;
  const average = Number(summary.average) || 0;
  const filled = Math.max(0, Math.min(5, Math.round(average)));
  $('#review-average').textContent = count ? average.toFixed(1).replace('.0', '') : '—';
  $('#review-stars').textContent = `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`;
  $('#review-count').textContent = count
    ? `${count} avis reçu${count > 1 ? 's' : ''}`
    : 'Soyez le premier à donner votre avis.';
}

async function loadReviewSummary() {
  try {
    renderReviewSummary(await api('/feedback/reviews/summary', { auth: false }));
  } catch (_) {
    renderReviewSummary();
  }
}

async function submitContactForm(form) {
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  setMessage('#contact-message', 'Envoi en cours…', true);
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await api('/feedback/contact', {
      method: 'POST',
      auth: false,
      body: JSON.stringify(payload),
    });
    form.reset();
    setMessage('#contact-message', result.message || 'Votre message a bien été transmis.', true);
  } catch (error) {
    setMessage('#contact-message', error.message);
  } finally {
    button.disabled = false;
  }
}

async function submitReviewForm(form) {
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  setMessage('#review-message', 'Publication en cours…', true);
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.rating = Number(payload.rating);
    const result = await api('/feedback/reviews', {
      method: 'POST',
      auth: false,
      body: JSON.stringify(payload),
    });
    form.reset();
    renderReviewSummary(result.summary);
    setMessage('#review-message', result.message || 'Merci pour votre avis.', true);
  } catch (error) {
    setMessage('#review-message', error.message);
  } finally {
    button.disabled = false;
  }
}

function bindEvents() {
  prepareSiteShareLinks();
  $$('[data-install-app]').forEach((button) => button.addEventListener('click', requestAppInstallation));
  $$('[data-open-auth]').forEach((button) => button.addEventListener('click', () => openAuth(button.dataset.openAuth)));
  $$('[data-open-notifications]').forEach((button) => button.addEventListener('click', openNotifications));
  $$('[data-open-account]').forEach((button) => button.addEventListener('click', () => {
    window.location.hash = 'espace';
    $('#mobile-nav').classList.add('hidden');
    $('#menu-button').setAttribute('aria-expanded', 'false');
  }));
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
    catch (error) { setMessage('#auth-message', loginErrorMessage(error)); }
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
  $('#open-password-recovery').addEventListener('click', openPasswordRecovery);
  $('#recovery-identify-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    setMessage('#password-recovery-message', 'Recherche du compte…', true);
    try { await identifyRecoveryAccount(event.currentTarget); }
    catch (error) { setMessage('#password-recovery-message', error.message); }
    finally { button.disabled = false; }
  });
  $('#recovery-reset-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    setMessage('#password-recovery-message', 'Modification du mot de passe…', true);
    try { await resetPasswordWithSecurity(event.currentTarget); }
    catch (error) { setMessage('#password-recovery-message', error.message); }
    finally { button.disabled = false; }
  });
  $('#restart-recovery').addEventListener('click', resetPasswordRecoveryUi);
  $('#continue-login').addEventListener('click', () => { closeDialogs(); openAuth('login'); });
  $('#payment-form').addEventListener('submit', (event) => { event.preventDefault(); submitPayment(event.currentTarget); });
  $('#contact-form').addEventListener('submit', (event) => { event.preventDefault(); submitContactForm(event.currentTarget); });
  $('#review-form').addEventListener('submit', (event) => { event.preventDefault(); submitReviewForm(event.currentTarget); });
  $('#refresh-races').addEventListener('click', loadRaces);
  $('#quinte-country').addEventListener('change', (event) => {
    state.nationalCountry = event.target.value;
    localStorage.setItem('ppm_quinte_country', state.nationalCountry);
    loadNationalSpotlight();
  });
  $('#logout-button').addEventListener('click', logout);
  $('#account-button').addEventListener('click', () => { window.location.hash = 'espace'; });
  $('#notification-read-all').addEventListener('click', () => markNotificationsRead());
  $('#native-share').addEventListener('click', shareSite);
  $('#copy-site-link').addEventListener('click', copySiteLink);
  $('#copy-referral').addEventListener('click', copyReferralCode);
  $('#copy-referral-link').addEventListener('click', copyReferralLink);
  $('#share-referral-link').addEventListener('click', shareReferralLink);
  $('#chat-toggle').addEventListener('click', () => setChatboxOpen($('#chatbox').classList.contains('hidden')));
  $('#chat-close').addEventListener('click', () => setChatboxOpen(false));
  $$('[data-chat-question]').forEach((button) => button.addEventListener('click', () => askChat(button.dataset.chatQuestion)));
  $('#chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#chat-input');
    askChat(input.value);
    input.value = '';
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#chatbox').classList.contains('hidden')) setChatboxOpen(false);
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
  if (isStandaloneApp()) setInstallButtonsVisible(false);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  bindEvents();
  renderCountryMarquee();
  try { await loadCatalogs(); }
  catch (error) { toast(`Configuration indisponible : ${error.message}`); }
  await Promise.all([loadRaces(), refreshMe(), loadReviewSummary()]);
  applyReferralInvitation();
}

boot();
