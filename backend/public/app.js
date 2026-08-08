const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: sessionStorage.getItem('ppm_web_token') || '',
  countries: [],
  plans: [],
  racetracks: [],
  results: [],
  successStats: null,
  resultCategory: 'ecd',
  raceDate: null,
  ecdProfile: null,
  ecdSelectionMode: null,
  nationalGame: null,
  nationalRaceId: null,
  nationalCountry: localStorage.getItem('ppm_quinte_country') || 'bf',
  me: null,
  notifications: [],
  selectedRaceId: null,
  selectedRaceMode: null,
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
const CANONICAL_WEB_ORIGIN = 'https://www.parispromax.com';
const RACE_CAROUSEL_SLIDES = Object.freeze([
  { src: '/assets/race-flat.jpg', alt: 'Chevaux et jockeys pendant une course de plat', label: 'Course de plat' },
  { src: '/assets/race-harness.jpg', alt: 'Chevaux au trot pendant une course attelée', label: 'Trot attelé' },
  { src: '/assets/race-finish.jpg', alt: 'Chevaux franchissant la ligne d’arrivée', label: 'Arrivée de course' },
]);
let raceCarouselTimer = null;

function setRaceCarouselSlide(carousel, index) {
  const slides = $$('.race-carousel-slide', carousel);
  const dots = $$('[data-carousel-dot]', carousel);
  if (!slides.length) return;
  const safeIndex = ((Number(index) || 0) % slides.length + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === safeIndex;
    slide.classList.toggle('active', active);
    slide.setAttribute('aria-hidden', String(!active));
  });
  dots.forEach((dot, dotIndex) => {
    const active = dotIndex === safeIndex;
    dot.classList.toggle('active', active);
    dot.setAttribute('aria-current', active ? 'true' : 'false');
  });
  carousel.dataset.carouselIndex = String(safeIndex);
}

function raceCarouselPlaceholder(label, start = 0) {
  return `<div class="race-carousel race-carousel-inline" data-race-carousel data-carousel-start="${start}" data-carousel-label="${escapeHtml(label)}" aria-label="Images de courses hippiques"></div>`;
}

function hydrateRaceCarousels(root = document) {
  $$('[data-race-carousel]', root).forEach((carousel) => {
    if (carousel.dataset.carouselReady === 'true') return;
    const label = carousel.dataset.carouselLabel || 'Courses hippiques';
    carousel.innerHTML = `${RACE_CAROUSEL_SLIDES.map((slide, index) => `
      <img class="race-carousel-slide" src="${slide.src}" alt="${slide.alt}" width="1600" height="900" loading="${index === 0 ? 'eager' : 'lazy'}" />
    `).join('')}
      <div class="race-carousel-bar">
        <span><small>EN IMAGES</small><strong>${escapeHtml(label)}</strong></span>
        <div class="race-carousel-dots" aria-label="Choisir une image">
          ${RACE_CAROUSEL_SLIDES.map((slide, index) => `<button type="button" data-carousel-dot="${index}" aria-label="Afficher : ${slide.label}"></button>`).join('')}
        </div>
      </div>`;
    carousel.dataset.carouselReady = 'true';
    carousel.addEventListener('click', (event) => {
      const dot = event.target.closest('[data-carousel-dot]');
      if (dot) setRaceCarouselSlide(carousel, Number(dot.dataset.carouselDot));
    });
    carousel.addEventListener('pointerenter', () => { carousel.dataset.carouselPaused = 'true'; });
    carousel.addEventListener('pointerleave', () => { carousel.dataset.carouselPaused = 'false'; });
    setRaceCarouselSlide(carousel, Number(carousel.dataset.carouselStart || 0));
  });
}

function startRaceCarousels() {
  hydrateRaceCarousels();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || raceCarouselTimer) return;
  raceCarouselTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    hydrateRaceCarousels();
    $$('[data-race-carousel]').forEach((carousel) => {
      if (carousel.dataset.carouselPaused === 'true') return;
      setRaceCarouselSlide(carousel, Number(carousel.dataset.carouselIndex || 0) + 1);
    });
  }, 4800);
}

function publicWebOrigin() {
  const current = new URL(window.location.origin);
  const legacyHosts = new Set(['parispromax.com', 'parispromax-backend.onrender.com']);
  return legacyHosts.has(current.hostname.toLowerCase()) ? CANONICAL_WEB_ORIGIN : current.origin;
}

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

function formatFcfa(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
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
    url: new URL('/', publicWebOrigin()).href,
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
  const url = new URL('/', publicWebOrigin());
  url.searchParams.set('ref', normalizeReferralCodeClient(code));
  return url.href;
}

function currentReferralCode() {
  return normalizeReferralCodeClient(state.me?.referral?.code || $('#referral-code')?.textContent);
}

function showReferralMessage(message) {
  const nodes = ['#referral-message', '#contact-referral-message'].map((selector) => $(selector)).filter(Boolean);
  nodes.forEach((node) => { node.textContent = message; });
  clearTimeout(showReferralMessage.timer);
  showReferralMessage.timer = setTimeout(() => nodes.forEach((node) => { node.textContent = ''; }), 3500);
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
  state.recovery = { phone, country: data.country };
  form.classList.add('hidden');
  $('#recovery-reset-form').classList.remove('hidden');
  setMessage('#password-recovery-message', 'Saisissez votre code de récupération.', true);
}

async function resetPasswordWithSecurity(form) {
  const data = Object.fromEntries(new FormData(form));
  const result = await api('/auth/reset-password', {
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
    return { text: 'Les courses du jour, les partants, les cotes et les jeux proposés sont disponibles dans la même rubrique.', label: 'Voir les courses', target: '#courses' };
  }
  if (/paiement|mobile money|otp/.test(normalized)) {
    return { text: 'Choisissez une formule, puis suivez les instructions de l’opérateur affiché. Ne saisissez jamais votre code PIN Mobile Money sur ParisPromax.', label: 'Voir les formules', target: '#abonnements' };
  }
  if (/telegram|canal/.test(normalized)) {
    return { text: 'Le canal Telegram officiel publie les programmes, les résultats et les nouvelles de ParisPromax.', label: 'Rejoindre Telegram', target: 'https://t.me/ParisPromaxOfficiel', external: true };
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
    // Old installed/cached copies can still run under the apex or Render host.
    // Calling www directly avoids a cross-host redirect that strips the JWT.
    const endpoint = new URL(path, `${publicWebOrigin()}/`).href;
    const response = await fetch(endpoint, { ...options, headers, signal: controller.signal });
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
  const dial = String(country.dial || '').replace(/\D/g, '');
  const nationalLength = Number(country.nationalLength);
  if (digits.startsWith('00')) digits = digits.slice(2);
  const hasExpectedInternationalLength = Number.isFinite(nationalLength)
    ? digits.length === dial.length + nationalLength
    : digits.startsWith(dial);
  if (dial && digits.startsWith(dial) && hasExpectedInternationalLength) {
    return `+${digits}`;
  }
  if (!country.keepLeadingZero) digits = digits.replace(/^0/, '');
  return `+${dial}${digits}`;
}

async function loadCatalogs() {
  const [countryData, planData] = await Promise.all([
    api('/payments/countries', { auth: false }),
    api('/plans', { auth: false }),
  ]);
  state.countries = countryData.countries || [];
  state.plans = planData.plans || [];
  renderCountrySelects();
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

  const ticker = $('#plan-ticker-track');
  if (ticker) {
    const tickerItems = (interactive = true) => state.plans.map((plan) => `
      <button class="plan-ticker-item" type="button" data-plan="${escapeHtml(plan.id)}"${interactive ? '' : ' tabindex="-1"'}>
        <strong>${escapeHtml(plan.label)}</strong>
        <span>${Number(plan.pricePromo).toLocaleString('fr-FR')} XOF</span>
        <small>${escapeHtml(plan.days)} jour${Number(plan.days) > 1 ? 's' : ''}</small>
      </button>`).join('');
    ticker.innerHTML = `
      <div class="plan-ticker-group" role="list">${tickerItems(true)}</div>
      <div class="plan-ticker-group" aria-hidden="true">${tickerItems(false)}</div>`;
    ticker.classList.add('is-ready');
  }
  $$('[data-plan]').forEach((button) => button.addEventListener('click', () => startPayment(button.dataset.plan)));
}

async function loadRaces() {
  const list = $('#race-list');
  list.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>';
  try {
    const data = await api(`/races/ecd?country=${encodeURIComponent(state.nationalCountry)}`, { auth: false });
    state.racetracks = data.racetracks || [];
    state.raceDate = data.meta?.date || null;
    state.raceDate = data.date || state.raceDate;
    state.ecdProfile = data.profile || null;
    state.ecdSelectionMode = data.selectionMode || null;
    const country = countryDetails(state.nationalCountry);
    $('#program-kicker').textContent = state.raceDate
      ? `ECD ${country.name.toUpperCase()} · ${dateLabel(state.raceDate).toUpperCase()}`
      : `ECD ${country.name.toUpperCase()}`;
    const ecdDescription = $('#ecd-program-description');
    if (ecdDescription) {
      const stake = data.profile?.unitStake
        ? ` Mise de base : ${formatFcfa(data.profile.unitStake)}.`
        : ' Mise à confirmer.';
      const meetings = (data.meetings || []).map((meeting) => `R${meeting}`).join(' et ');
      const status = data.selectionMode === 'official-country-program'
        ? `Programme officiel ${data.operator || country.name}${meetings ? ` : ${meetings}` : ''}.`
        : data.selectionMode === 'country-validated'
          ? 'Programme ECD validé spécifiquement pour votre pays.'
          : 'Le programme officiel de votre pays est en attente de publication.';
      ecdDescription.textContent = `${status}${stake}`;
    }
    const programLinks = $('#ecd-program-links');
    if (programLinks) {
      programLinks.innerHTML = (data.journals || []).map((journal) => {
        const url = safeHttpUrl(journal.url);
        return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Programme officiel R${escapeHtml(journal.meeting)} ↗</a>` : '';
      }).join('');
    }
    renderRaces();
    buildMemberNotifications();
    updateHeroRace();
  } catch (error) {
    list.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p></div>`;
  } finally {
    await loadNationalSpotlight();
  }
}

function raceDiscipline(race = {}) {
  const raw = String(race.type || race.discipline || '').toLowerCase();
  if (/attel|harness/.test(raw)) return 'TROT ATTELÉ';
  if (/mont/.test(raw)) return 'TROT MONTÉ';
  if (/haie|steeple|obstacle|cross/.test(raw)) return 'OBSTACLE';
  if (/plat|flat/.test(raw)) return 'PLAT';
  return raw ? raw.toUpperCase() : 'COURSE HIPPIQUE';
}

function raceReference(race = {}, fallback = {}) {
  const sources = [race.reference, race.number, race.id, race.externalId];
  for (const source of sources) {
    const exact = String(source || '').toUpperCase().match(/R\s*(\d+)\D*C\s*(\d+)/);
    if (exact) return `R${Number(exact[1])}C${Number(exact[2])}`;
  }
  const meeting = Number(race.meetingNumber || race.reunionNumber || fallback.meetingNumber);
  const taggedCourse = String(race.number || '').toUpperCase().match(/C\s*(\d+)/);
  const course = Number(race.courseNumber || taggedCourse?.[1] || fallback.courseNumber);
  return Number.isInteger(meeting) && meeting > 0 && Number.isInteger(course) && course > 0
    ? `R${meeting}C${course}`
    : String(race.number || '').trim();
}

function normalizeBet(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function betKind(value) {
  const bet = normalizeBet(value);
  if (bet.includes('trio')) return 'trio';
  if (bet.includes('ordre')) return 'jum-order';
  if (bet.includes('jum') && bet.includes('place')) return 'jum-place';
  if (bet.includes('jum')) return 'jum-win';
  if (bet.includes('place')) return 'place';
  return 'win';
}

function resultNumbers(value) {
  return String(value || '').match(/\d+/g)?.map(Number) || [];
}

function predictionNumbers(result = {}) {
  return (result.topPicks || [])
    .slice()
    .sort((a, b) => Number(a?.rank || 999) - Number(b?.rank || 999))
    .map((pick) => Number(typeof pick === 'object' ? pick.number : pick))
    .filter(Number.isFinite);
}

function predictionForBet(kind, prediction, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const pair = (values) => values.length < 3
    ? values.slice(0, 2).join(' - ')
    : `${values[0]} - ${values[1]} / ${values[0]} - ${values[2]} / ${values[1]} - ${values[2]}`;
  if (kind === 'win') return String(prediction[0] || '—');
  if (kind === 'place') return prediction.slice(0, podium).join(' - ') || '—';
  if (kind === 'trio') return prediction.slice(0, 3).join(' - ') || '—';
  if (kind === 'jum-place') return pair(prediction.slice(0, 3)) || '—';
  return prediction.slice(0, 2).join(' - ') || '—';
}

function predictionCovers(kind, officialValue, prediction, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const official = resultNumbers(officialValue);
  if (!official.length || !prediction.length) return false;
  if (kind === 'win') return official[0] === prediction[0];
  if (kind === 'place') return prediction.slice(0, podium).includes(official[0]);
  if (kind === 'jum-order') return official[0] === prediction[0] && official[1] === prediction[1];
  if (kind === 'jum-win') {
    const expected = new Set(prediction.slice(0, 2));
    return official.length >= 2 && official.slice(0, 2).every((number) => expected.has(number));
  }
  return official.every((number) => prediction.slice(0, 3).includes(number));
}

function fallbackPayoutRows(arrival = [], podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const [first, second, third] = arrival.slice(0, podium);
  const rows = [
    { bet: 'Gagnant', numbers: first },
    ...arrival.slice(0, podium).map((number) => ({ bet: 'Placé', numbers: number })),
  ];
  if (podium === 2) {
    rows.push({ bet: 'Jumelé ordre', numbers: `${first} - ${second}` });
  } else {
    rows.push(
      { bet: 'Jumelé gagnant', numbers: `${first} - ${second}` },
      { bet: 'Jumelé placé', numbers: `${first} - ${second}` },
      { bet: 'Jumelé placé', numbers: `${first} - ${third}` },
      { bet: 'Jumelé placé', numbers: `${second} - ${third}` },
      { bet: 'Trio', numbers: `${first} - ${second} - ${third}` }
    );
  }
  return rows.filter((row) => !String(row.numbers).includes('undefined'));
}

function ecdGainsTableMarkup(result = {}) {
  const prediction = predictionNumbers(result);
  const podiumSize = Math.max(2, Math.min(3, Number(result.ecdTicketOutcome?.podiumSize) || 3));
  const reportStatus = result.ecdReport?.status ?? null;
  const reportsAvailable = reportStatus === 'complete'
    && Array.isArray(result.payouts)
    && result.payouts.length > 0;
  const reportLabel = reportsAvailable
    ? 'Rapport complet validé'
    : reportStatus === 'partial' || reportStatus === 'arrival-incomplete'
      ? 'Rapport partiel · calcul suspendu'
      : reportStatus === 'pending'
        ? 'Rapports officiels en attente'
        : 'Statut du rapport à confirmer';
  const reportClass = reportsAvailable
    ? 'published'
    : reportStatus === 'partial' || reportStatus === 'arrival-incomplete'
      ? 'partial'
      : 'pending';
  const rows = reportsAvailable
    ? result.payouts
    : fallbackPayoutRows(result.winners || [], podiumSize);
  return `<section class="ecd-gains" aria-label="Tableau des gains ECD pour ${escapeHtml(countryDetails(state.nationalCountry).name)}">
    <div class="ecd-gains-head">
      <div><span>GAINS ECD · ${escapeHtml(countryDetails(state.nationalCountry).name.toUpperCase())}</span><strong>Rapports de la course et pronostic ParisPromax</strong></div>
      <em class="${reportClass}">${escapeHtml(reportLabel)}</em>
    </div>
    <p class="horizontal-scroll-hint">Faites glisser le tableau vers la gauche pour voir les montants et le pronostic.</p>
    <div class="ecd-gains-scroll" tabindex="0" aria-label="Tableau des rapports ECD, défilement horizontal"><table class="ecd-gains-table">
      <thead><tr><th>Pari</th><th>N°</th><th>Montant</th><th>NB</th><th>Pronostic ParisPromax</th></tr></thead>
      <tbody>${rows.map((row) => {
        const kind = betKind(row.bet);
        const covered = predictionCovers(kind, row.numbers, prediction, podiumSize);
        const reportIndeterminate = reportsAvailable
          && Number.isFinite(Number(row.amount))
          && Number(row.amount) <= 0;
        const amount = reportsAvailable
          ? reportIndeterminate
            ? 'Non calculable'
            : `${Number(row.amount || 0).toLocaleString('fr-FR')} FCFA`
          : 'En attente';
        return `<tr><th>${escapeHtml(String(row.bet || 'Pari').toUpperCase())}</th><td>${escapeHtml(row.numbers || '—')}</td><td>${escapeHtml(amount)}</td><td>${reportsAvailable ? escapeHtml(row.winnerCount ?? 0) : '—'}</td><td class="prediction-cell ${covered ? 'covered' : ''}">${escapeHtml(predictionForBet(kind, prediction, podiumSize))}${covered ? ' <b>✓ Couvert</b>' : ''}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <p>${reportsAvailable ? 'Montants officiels publiés par l’opérateur.' : 'Aucun solde n’est calculé tant que le rapport complet n’est pas validé.'} La colonne ParisPromax compare le pronostic archivé à l’arrivée ; elle ne représente pas un pari encaissé.</p>
  </section>`;
}

function ecdTicketOutcomeMarkup(outcome) {
  if (!outcome) {
    return `<section class="ecd-ticket-outcome unknown">
      <div class="ecd-ticket-outcome-head"><div><span>BILAN DES TICKETS PARISPROMAX</span><strong>Statut officiel à confirmer</strong></div><em>Calcul non lancé</em></div>
      <p>Aucun gain ni aucune perte ne sont affichés tant que les données officielles nécessaires ne sont pas disponibles.</p>
    </section>`;
  }
  if (outcome.status === 'prediction-unavailable') {
    return `<section class="ecd-ticket-outcome pending">
      <div class="ecd-ticket-outcome-head"><div><span>BILAN DES TICKETS PARISPROMAX</span><strong>Pronostic archivé indisponible</strong></div></div>
      <p>Le bilan des tickets ne peut pas être calculé pour cette course.</p>
    </section>`;
  }

  const currency = escapeHtml(outcome.currency || 'FCFA');
  const money = (value) => value == null
    ? 'En attente'
    : `${Number(value || 0).toLocaleString('fr-FR')} ${currency}`;
  const settled = outcome.status === 'settled';
  const indeterminate = outcome.status === 'settled-indeterminate';
  const partial = outcome.status === 'reports-partial';
  const positive = settled && Number(outcome.netReturn || 0) >= 0;
  const winningTickets = outcome.winningTickets || [];
  const outcomeClass = settled
    ? positive ? 'positive' : 'negative'
    : indeterminate
      ? 'indeterminate'
      : partial
        ? 'partial'
        : 'pending';
  const status = settled
    ? `${Number(outcome.winningCount || 0)} ticket${Number(outcome.winningCount || 0) > 1 ? 's' : ''} gagnant${Number(outcome.winningCount || 0) > 1 ? 's' : ''} sur ${Number(outcome.ticketsCount || 0)}`
    : indeterminate
      ? `${Number(outcome.winningCount || 0)} sélection${Number(outcome.winningCount || 0) > 1 ? 's' : ''} correcte${Number(outcome.winningCount || 0) > 1 ? 's' : ''} · rapport non calculable`
      : partial
        ? `${Number(outcome.ticketsCount || 0)} tickets proposés · rapport officiel partiel`
        : `${Number(outcome.ticketsCount || 0)} tickets proposés · rapports en attente`;

  return `<section class="ecd-ticket-outcome ${outcomeClass}">
    <div class="ecd-ticket-outcome-head">
      <div><span>BILAN DES TICKETS PARISPROMAX</span><strong>${escapeHtml(status)}</strong></div>
      <em>${settled ? 'Calcul terminé' : indeterminate ? 'Montant indéterminable' : partial ? 'Calcul suspendu' : 'À confirmer'}</em>
    </div>
    <div class="ecd-ticket-metrics">
      <span><small>Sélections correctes</small><b>${settled || indeterminate ? `${Number(outcome.winningCount || 0)} / ${Number(outcome.ticketsCount || 0)}` : '—'}</b></span>
      <span><small>Retour théorique</small><b>${indeterminate ? 'Non calculable' : money(outcome.totalReturn)}</b></span>
      <span><small>Mise illustrative</small><b>${money(outcome.totalStake)}</b></span>
      <span><small>Solde théorique</small><b>${money(outcome.netReturn)}</b></span>
    </div>
    ${settled || indeterminate ? `<div class="ecd-winning-tickets">
      <strong>Sélections correctes du pronostic</strong>
      ${winningTickets.length
        ? `<ul>${winningTickets.map((ticket) => `<li><span>${escapeHtml(ticket.bet)} · ${escapeHtml((ticket.numbers || []).join(' - '))}</span><b>${ticket.reportIndeterminate ? 'Rapport non calculable' : money(ticket.returnAmount)}</b></li>`).join('')}</ul>`
        : '<p>Aucune sélection correcte pour ce pronostic.</p>'}
    </div>` : '<p>Les tickets gagnants et les montants apparaîtront dès la publication des rapports officiels.</p>'}
    <p>Simulation du pronostic ParisPromax archivé, avec une mise de ${money(outcome.unitStake)} par ticket.${indeterminate ? ' Un rapport à zéro gagnant reste non calculable, car un ticket supplémentaire aurait modifié le partage du pari mutuel.' : ''} Aucun pari n’est effectué ou encaissé par ParisPromax.</p>
  </section>`;
}

function resultPredictionVariant(result = {}) {
  if (state.resultCategory !== 'ecd' || !Array.isArray(result.ecdTopPicks)) return result;
  const podiumSize = Math.max(2, Math.min(3, Number(result.ecdTicketOutcome?.podiumSize) || 3));
  const baseNumber = Number(result.ecdTopPicks[0]?.number);
  const basePlaced = Number.isFinite(baseNumber)
    && (result.winners || []).slice(0, podiumSize).map(Number).includes(baseNumber);
  return {
    ...result,
    topPicks: result.ecdTopPicks,
    groups: result.ecdGroups || null,
    aiHit: typeof result.ecdAiHit === 'boolean' ? result.ecdAiHit : basePlaced,
  };
}

function grandCarnetFallbackMarkup(result = {}) {
  const arrivalStatus = result.nationalArrivalComplete;
  const reportStatus = result.nationalReport?.status ?? null;
  const partialReport = reportStatus === 'report-partial' || reportStatus === 'partial';
  const title = arrivalStatus === false
    ? 'Arrivée officielle partielle · calcul suspendu'
    : partialReport
        ? 'Rapport officiel incomplet · calcul suspendu'
      : arrivalStatus == null
        ? 'Statut de l’arrivée officielle à confirmer'
        : 'Pronostic archivé indisponible';
  const detail = arrivalStatus === false
    ? 'Aucun gain ni aucune perte ne sont calculés avant la publication de l’arrivée complète.'
    : partialReport
        ? 'Les montants restent en attente jusqu’à la publication du rapport complet.'
      : arrivalStatus == null
        ? 'Le résultat n’est pas présenté comme vérifié tant que son état officiel n’est pas connu.'
        : 'Le gain illustratif ne peut pas être calculé pour cette course.';
  return `<section class="grand-carnet-outcome ${arrivalStatus === false || partialReport ? 'partial' : 'unknown'}"><div class="grand-carnet-outcome-head"><div><span>BILAN GRAND CARNET PARISPROMAX</span><strong>${title}</strong></div><em>${arrivalStatus === false || partialReport ? 'Calcul suspendu' : 'À confirmer'}</em></div><p>${detail}</p></section>`;
}

function grandCarnetOutcomeMarkup(outcome, result = {}) {
  if (!outcome) {
    return grandCarnetFallbackMarkup(result);
  }
  const confirmed = outcome.gainStatus === 'confirmed';
  const pending = outcome.gainStatus === 'pending-official-report';
  const indeterminate = outcome.gainStatus === 'official-report-indeterminate';
  const partial = outcome.gainStatus === 'report-partial';
  const notWinning = outcome.gainStatus === 'not-winning';
  const outcomeClass = confirmed
    ? 'confirmed'
    : pending
      ? 'pending'
      : indeterminate
        ? 'indeterminate'
        : partial
          ? 'partial'
          : notWinning
            ? 'not-winning'
            : 'unknown';
  const status = confirmed
    ? `Gain officiel : ${Number(outcome.gain || 0).toLocaleString('fr-FR')} ${escapeHtml(outcome.currency || 'FCFA')}`
    : pending
      ? 'Pronostic gagnant · gain officiel en attente'
      : indeterminate
        ? 'Sélection correcte · montant officiel non calculable'
        : partial
          ? 'Calcul suspendu · rapport officiel incomplet'
          : notWinning
            ? 'Pronostic non gagnant · gain 0 FCFA'
            : 'Bilan officiel à confirmer';
  const badge = confirmed
    ? 'Rapport complet'
    : pending
      ? 'Rapport en attente'
      : indeterminate
        ? 'Montant indéterminable'
        : partial
          ? 'Rapport partiel'
          : notWinning
            ? 'Aucune combinaison gagnante'
            : 'À confirmer';
  const currency = escapeHtml(outcome.currency || 'FCFA');
  const amount = (value, fallback = '—') => value == null
    ? fallback
    : `${Number(value).toLocaleString('fr-FR')} ${currency}`;
  const gain = confirmed || notWinning
    ? amount(outcome.gain, notWinning ? `0 ${currency}` : '—')
    : indeterminate
      ? 'Non calculable'
      : 'En attente';
  const netGain = confirmed || notWinning
    ? amount(outcome.netGain)
    : indeterminate
      ? 'Non calculable'
      : 'En attente';
  const breakdown = Object.entries(outcome.winningBreakdown || {}).filter(([, item]) => Number(item?.count) > 0);
  const outcomeLabels = { order: 'Ordre', disorder: 'Désordre', bonus: 'Bonus' };
  const winningCount = Number(outcome.winningCombinations || 0);
  return `<section class="grand-carnet-outcome ${outcomeClass}">
    <div class="grand-carnet-outcome-head"><div><span>BILAN GRAND CARNET PARISPROMAX</span><strong>${status}</strong></div><em>${badge}</em></div>
    <p class="grand-carnet-match">${escapeHtml(outcome.matchedHorses || 0)} / ${escapeHtml(outcome.arrival?.length || 0)} chevaux trouvés · ${escapeHtml(winningCount)} combinaison${winningCount > 1 ? 's' : ''} gagnante${winningCount > 1 ? 's' : ''}</p>
    <div class="grand-carnet-outcome-lines"><span><small>Pronostic</small><b>${escapeHtml((outcome.selection || []).join(' - '))}</b></span><span><small>Arrivée</small><b>${escapeHtml((outcome.arrival || []).join(' - '))}</b></span><span><small>Mise illustrative</small><b>${amount(outcome.totalStake)}</b></span><span><small>Gain officiel</small><b>${gain}</b></span><span><small>Solde théorique</small><b>${netGain}</b></span></div>
    ${breakdown.length ? `<div class="grand-carnet-winning"><strong>Combinaisons gagnantes</strong><ul>${breakdown.map(([kind, item]) => `<li><span>${escapeHtml(outcomeLabels[kind] || kind)}</span><b>${escapeHtml(item.count)}${item.gain == null ? indeterminate ? ' · montant non calculable' : ' · montant en attente' : ` · ${amount(item.gain)}`}</b></li>`).join('')}</ul></div>` : ''}
    <p>Simulation basée sur le Grand Carnet ParisPromax archivé avant la course. Aucun pari n’est encaissé par ParisPromax.</p>
  </section>`;
}

function renderRaces() {
  const list = $('#race-list');
  const count = state.racetracks.reduce((total, track) => total + (track.races || []).length, 0);
  const countNode = $('#race-count');
  if (countNode) countNode.textContent = `${count} course${count > 1 ? 's' : ''} · faites défiler pour toutes les voir`;
  if (!state.racetracks.length) {
    list.innerHTML = '<div class="empty-state"><p>Aucune course disponible actuellement.</p></div>';
    return;
  }
  list.innerHTML = state.racetracks.map((track, trackIndex) => `
    <div class="track-label"><span>${escapeHtml(track.name)}</span><small>ECD · ${escapeHtml(countryDetails(state.nationalCountry).name)}</small></div>
    ${(track.races || []).map((race, raceIndex) => {
      const reference = raceReference(race, { meetingNumber: trackIndex + 1, courseNumber: raceIndex + 1 });
      const winners = race.result?.winners || [];
      const resultLabel = winners.length
        ? `<small class="race-result-mini">Arrivée : ${winners.slice(0, 5).map(escapeHtml).join(' - ')}</small>`
        : `<small>${escapeHtml(race.distance || '')} · ${escapeHtml(race.runners || 0)} partants${race.ecd?.variants?.length ? ` · ${escapeHtml(race.ecd.variants.map((variant) => variant.label).join(', '))}` : ''}</small>`;
      return `<button class="race-item ${race.id === state.selectedRaceId ? 'active' : ''}" type="button" data-race-id="${escapeHtml(race.id)}">
        <span class="race-time"><b>${escapeHtml(reference || 'COURSE')}</b><small>${escapeHtml(race.time || 'À venir')}</small></span>
        <span class="race-item-main"><span class="race-discipline-badge">${escapeHtml(raceDiscipline(race))}</span><strong>${escapeHtml(race.name)} ${race.isQuinte ? '<em class="quinte-mini">Q+</em>' : ''}</strong>${resultLabel}</span>
        <span class="race-arrow">${winners.length ? '✓' : '›'}</span>
      </button>`;
    }).join('')}
  `).join('');
  $$('.race-item', list).forEach((button) => button.addEventListener('click', () => selectRace(button.dataset.raceId, 'ecd')));
}

function renderResults() {
  const grid = $('#results-grid');
  const visibleResults = state.results.filter((result) => state.resultCategory === 'ecd'
    ? result.isEcd || result.category === 'ecd'
    : result.category === 'national');
  $$('[data-results-category]').forEach((button) => {
    button.classList.toggle('active', button.dataset.resultsCategory === state.resultCategory);
    button.setAttribute('aria-selected', String(button.dataset.resultsCategory === state.resultCategory));
  });
  if (!visibleResults.length) {
    grid.innerHTML = '<div class="results-empty"><strong>Aucune arrivée officielle disponible</strong><p>Les résultats apparaîtront ici dès leur publication.</p></div>';
    return;
  }

  grid.innerHTML = visibleResults.map((result) => {
    const displayResult = resultPredictionVariant(result);
    const winners = (result.winners || []).slice(0, 5);
    const hasAccess = Boolean(state.me?.access?.hasAccess);
    const arrivalComplete = state.resultCategory === 'ecd'
      ? result.ecdArrivalComplete
      : result.nationalArrivalComplete;
    const comparison = arrivalComplete === false
      ? '<span class="result-hit neutral">Arrivée officielle en cours de complétion</span>'
      : arrivalComplete == null
        ? '<span class="result-hit unknown">Statut officiel à confirmer</span>'
        : hasAccess && displayResult.aiHit === true
        ? '<span class="result-hit success">Base ParisPromax placée</span>'
        : '<span class="result-hit neutral">Résultat officiel vérifié</span>';
    const reference = raceReference(result);
    const resultDetails = !hasAccess
      ? ''
      : state.resultCategory === 'national'
        ? grandCarnetOutcomeMarkup(result.grandCarnetOutcome, result)
        : `${ecdTicketOutcomeMarkup(result.ecdTicketOutcome)}${ecdGainsTableMarkup(displayResult)}`;
    return `<article class="result-card result-card-detailed">
      <div class="result-card-head">
        <div><span>${escapeHtml([reference, result.track].filter(Boolean).join(' · '))}</span><h3>${escapeHtml(result.race)}</h3><time>${escapeHtml(dateLabel(result.date))}</time></div>
        ${comparison}
      </div>
      <div class="result-arrival" aria-label="Arrivée officielle">
        ${winners.map((number, index) => `<span class="${index === 0 ? 'winner' : ''}"><small>${index + 1}${index === 0 ? 'er' : 'e'}</small><b>${escapeHtml(number)}</b></span>`).join('')}
      </div>
      ${resultDetails}
      ${findRace(result.raceId) ? `<button class="result-detail-link" type="button" data-result-race="${escapeHtml(result.raceId)}">Voir la fiche de la course →</button>` : ''}
    </article>`;
  }).join('');

  $$('[data-result-race]', grid).forEach((button) => button.addEventListener('click', async () => {
    await selectRace(button.dataset.resultRace, state.resultCategory);
    $('.race-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

async function loadResults(silent = false) {
  const grid = $('#results-grid');
  if (!silent) {
    grid.innerHTML = '<div class="result-placeholder"></div><div class="result-placeholder"></div><div class="result-placeholder"></div>';
  }
  try {
    const data = await api(`/races/history?country=${encodeURIComponent(state.nationalCountry)}`);
    state.results = data.history || [];
    renderResults();
    $('#results-updated').textContent = `Dernière vérification : ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
  } catch (error) {
    if (!silent) {
      grid.innerHTML = `<div class="results-empty"><strong>Résultats momentanément indisponibles</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }
}

function measuredRate(value) {
  if (value == null || value === '') return 'En cours de mesure';
  const rate = Number(value);
  return Number.isFinite(rate) ? `${Math.round(rate)} %` : 'En cours de mesure';
}

function measuredSample(value, singular = 'résultat', plural = `${singular}s`) {
  const sample = Math.max(0, Math.round(Number(value) || 0));
  return sample
    ? `Échantillon : ${sample.toLocaleString('fr-FR')} ${sample > 1 ? plural : singular}`
    : 'Échantillon en cours de constitution';
}

function renderSuccessRate(stats = null, error = null) {
  const ecdRate = $('#success-rate-ecd');
  const ecdSample = $('#success-rate-ecd-sample');
  const nationalRate = $('#success-rate-national');
  const nationalSample = $('#success-rate-national-sample');
  const allRate = $('#success-rate-all');
  const allSample = $('#success-rate-all-sample');
  const recentRate = $('#success-rate-30');
  const recentSample = $('#success-rate-30-sample');
  const status = $('#success-rate-status');
  if (
    !ecdRate || !ecdSample || !nationalRate || !nationalSample
    || !allRate || !allSample || !recentRate || !recentSample || !status
  ) return;

  ecdRate.textContent = measuredRate(stats?.byContext?.ecd?.rate);
  ecdSample.textContent = measuredSample(
    stats?.byContext?.ecd?.sampleSize,
    'pronostic ECD archivé',
    'pronostics ECD archivés'
  );
  nationalRate.textContent = measuredRate(stats?.byContext?.national?.rate);
  nationalSample.textContent = measuredSample(
    stats?.byContext?.national?.sampleSize,
    'pronostic national archivé',
    'pronostics nationaux archivés'
  );
  allRate.textContent = measuredRate(stats?.rate);
  allSample.textContent = measuredSample(stats?.sampleSize, 'contexte archivé', 'contextes archivés');
  recentRate.textContent = measuredRate(stats?.last30Days?.rate);
  recentSample.textContent = measuredSample(stats?.last30Days?.sampleSize, 'pronostic comparable', 'pronostics comparables');
  const baseStatus = error
    ? 'Mesure momentanément indisponible. Les résultats officiels restent visibles ci-dessous.'
    : stats?.window?.truncated
      ? `Mesure bornée aux ${Number(stats.window.resultLimit).toLocaleString('fr-FR')} dernières courses pertinentes pour le pays.`
      : 'Mesure recalculée à partir des arrivées officielles et des contextes ECD/nationale du pays.';
  const modelRows = !error && Array.isArray(stats?.byModel) ? stats.byModel : [];
  const displayedModels = modelRows.slice(0, 3);
  const archivedModelCount = modelRows.length - displayedModels.length;
  const modelSummary = displayedModels.length
    ? ` Versions suivies : ${displayedModels.map((model) => `${model.modelVersion} (${model.sampleSize} pronostic${model.sampleSize > 1 ? 's' : ''}, ${measuredRate(model.rate)})`).join(' · ')}.${archivedModelCount > 0 ? ` ${archivedModelCount} ancienne${archivedModelCount > 1 ? 's' : ''} version${archivedModelCount > 1 ? 's' : ''} archivée${archivedModelCount > 1 ? 's' : ''}.` : ''}`
    : '';
  status.textContent = `${baseStatus}${modelSummary}`;
  status.classList.toggle('error', Boolean(error));
}

async function loadSuccessRate() {
  try {
    state.successStats = await api(
      `/stats/success-rate?country=${encodeURIComponent(state.nationalCountry)}`,
      { auth: false }
    );
    renderSuccessRate(state.successStats);
  } catch (error) {
    state.successStats = null;
    renderSuccessRate(null, error);
  }
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
      message: 'Activez une formule pour consulter les jeux complets et le pronostic Podium + 2.',
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

function combinationCount(selectedHorses, podium) {
  const n = Number(selectedHorses);
  const k = Number(podium);
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < k || k < 0) return 0;
  const smallerSide = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= smallerSide; index += 1) {
    result = (result * (n - smallerSide + index)) / index;
  }
  return Math.round(result);
}

function nationalProposalMarkup(game) {
  if (!state.me?.access?.hasAccess) return '';
  const proposal = game?.proposal;
  const grandCarnet = proposal?.grandCarnet;
  if (!grandCarnet?.horses?.length) {
    return `<section class="national-proposal national-proposal-pending">
      <div><span>PROPOSITIONS ILLUSTRATIVES</span><strong>Pronostic en préparation</strong></div>
      <p>Les tickets Couplé et Grand Carnet seront affichés dès que l’ordre des chevaux sera disponible.</p>
    </section>`;
  }

  const horseNumbers = (horses) => horses
    .map((horse) => `<b title="${escapeHtml(horse.name)}">${escapeHtml(horse.number)}</b>`)
    .join('<i>–</i>');
  const sourceLabel = proposal.source && proposal.source !== 'market-ranking'
    ? 'Pronostic ParisPromax à jour'
    : 'Ordre provisoire selon les cotes';
  const budgetLine = (play) => play.cost != null
    ? `<span class="play-budget"><small>${escapeHtml(play.combinationsCount || 1)} combinaison${Number(play.combinationsCount) > 1 ? 's' : ''} × ${formatFcfa(play.stake)}</small><strong>${formatFcfa(play.cost)}</strong></span>`
    : '<span class="play-budget"><small>Mise opérateur</small><strong>À confirmer</strong></span>';

  return `<section class="national-proposal" aria-labelledby="national-proposal-title">
    <div class="national-proposal-head">
      <div>
        <span>PROPOSITIONS ILLUSTRATIVES · COURSE NATIONALE</span>
        <h5 id="national-proposal-title">Tickets conseillés aujourd’hui</h5>
        <p>${escapeHtml(sourceLabel)} · non-partants exclus.</p>
      </div>
      <div class="podium-ticket">
        <small>Podium proposé</small>
        <div>${horseNumbers(proposal.podiumSelection || [])}</div>
      </div>
    </div>
    <div class="national-ticket-grid">
      ${(proposal.couples || []).length ? `<div class="couple-tickets">
        ${(proposal.couples || []).map((ticket) => `<article class="bet-choice-card">
          <div class="bet-choice-head"><span>${escapeHtml(ticket.label)}</span><button class="bet-choice-toggle" type="button" data-play-id="${escapeHtml(ticket.id)}" data-play-cost="${escapeHtml(ticket.cost ?? '')}" aria-pressed="false">Choisir</button></div>
          <div>${horseNumbers(ticket.horses || [])}</div>
          <small>${escapeHtml(ticket.horses?.map((horse) => horse.name).join(' · ') || '')}</small>
          ${budgetLine(ticket)}
        </article>`).join('')}
      </div>` : ''}
      <article class="grand-carnet-ticket bet-choice-card">
        <div class="grand-carnet-ticket-head">
          <div><span>GRAND CARNET ${escapeHtml(game.label.toUpperCase())}</span><strong>${escapeHtml(grandCarnet.selectedHorses)} chevaux retenus</strong></div>
          <button class="bet-choice-toggle" type="button" data-play-id="grand-carnet" data-play-cost="${escapeHtml(grandCarnet.cost ?? '')}" aria-pressed="false">Choisir</button>
        </div>
        <div class="grand-carnet-horses">${horseNumbers(grandCarnet.horses)}</div>
        ${budgetLine(grandCarnet)}
        <details>
          <summary>Voir les ${escapeHtml(grandCarnet.combinationsCount)} combinaisons</summary>
          <div class="grand-carnet-combinations">
            ${(grandCarnet.combinations || []).map((combination, index) => `<span><small>${index + 1}</small>${combination.map(escapeHtml).join(' – ')}</span>`).join('')}
          </div>
        </details>
      </article>
    </div>
    <div class="selected-budget" data-selected-budget aria-live="polite">
      <span><small>Vos choix illustratifs</small><strong data-selected-count>Aucune proposition sélectionnée</strong></span>
      <span><small>Montant illustratif</small><strong data-selected-total>0 FCFA</strong></span>
    </div>
    <p class="budget-disclaimer">Simulation uniquement : aucun jeu ni pari n’est effectué sur ParisPromax. Les propositions et montants sont illustratifs et aucune mise n’est collectée.</p>
  </section>`;
}

function setupNationalBudget(root) {
  const buttons = $$('.bet-choice-toggle', root);
  const countNode = $('[data-selected-count]', root);
  const totalNode = $('[data-selected-total]', root);
  if (!buttons.length || !countNode || !totalNode) return;
  const selected = new Map();

  const render = () => {
    const costs = [...selected.values()];
    const total = costs.reduce((sum, value) => sum + value, 0);
    countNode.textContent = costs.length
      ? `${costs.length} proposition${costs.length > 1 ? 's' : ''} sélectionnée${costs.length > 1 ? 's' : ''}`
      : 'Aucune proposition sélectionnée';
    totalNode.textContent = formatFcfa(total);
  };

  buttons.forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.playId;
    const active = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? 'Sélectionné ✓' : 'Choisir';
    button.closest('.bet-choice-card')?.classList.toggle('selected', active);
    if (active) selected.set(id, Number(button.dataset.playCost) || 0);
    else selected.delete(id);
    render();
  }));
  render();
}

function renderNationalGameGuide(game) {
  if (!game) return '';
  const stakeLabel = game.stake
    ? `${escapeHtml(game.stake)} FCFA par combinaison`
    : 'Mise à confirmer auprès de l’opérateur national';
  return `
    <section class="burkina-game-guide" aria-labelledby="national-rules-title">
      <div class="burkina-guide-head">
        <div>
          <span class="spotlight-label">${game.verified ? 'RÈGLES VÉRIFIÉES' : 'FORMAT NATIONAL DU JOUR'} · ${escapeHtml(game.countryName || '')}</span>
          <h4 id="national-rules-title">${escapeHtml(game.label)} aujourd’hui</h4>
          <p>${escapeHtml(game.podium)} chevaux au podium · ${stakeLabel}</p>
        </div>
        ${game.isLastTuesday ? '<span class="last-tuesday-badge">Dernier mardi du mois</span>' : ''}
      </div>

      ${nationalProposalMarkup(game)}

      <details class="national-rules-disclosure">
        <summary>Règles, calendrier et calculateur</summary>
        <div class="national-rules-content">
      ${(game.schedule || []).length ? `<div class="burkina-schedule">
        ${(game.schedule || []).map((item) => `
          <article>
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.days)}</span>
            <small>${escapeHtml(item.podium)} arrivées · ${escapeHtml(item.stake)} FCFA / combinaison<br />${escapeHtml(item.note || '')}</small>
          </article>`).join('')}
      </div>` : ''}

      <div class="national-strategies">
        ${(game.strategies || []).map((strategy) => `
          <article class="${strategy.id === 'coverage' ? 'recommended' : ''}">
            <div><strong>${escapeHtml(strategy.label)}</strong>${strategy.id === 'coverage' ? '<span>CONSEILLÉ</span>' : ''}</div>
            <b>${escapeHtml(strategy.selectedHorses)} chevaux · ${escapeHtml(strategy.combinations)} combinaison${strategy.combinations > 1 ? 's' : ''}</b>
            <small>${strategy.cost != null ? `${escapeHtml(strategy.cost.toLocaleString('fr-FR'))} FCFA · ` : ''}${escapeHtml(strategy.description)}</small>
          </article>`).join('')}
      </div>

      <div class="burkina-tools">
        ${(game.couples || []).length ? `<div class="burkina-couples">
          <span class="burkina-tool-label">COUPLÉS POSSIBLES</span>
          <div>
            ${(game.couples || []).map((couple) => `
              <article><strong>${escapeHtml(couple.label)}</strong><small>${escapeHtml(couple.description)}</small></article>`).join('')}
          </div>
        </div>` : ''}
        <div class="grand-carnet" data-grand-carnet>
          <span class="burkina-tool-label">CALCULATEUR GRAND CARNET</span>
          <label for="grand-carnet-horses">Nombre de chevaux choisis</label>
          <input id="grand-carnet-horses" type="number" min="${escapeHtml(game.podium)}" max="20" value="${escapeHtml(game.podium)}" inputmode="numeric" />
          <div class="grand-carnet-total">
            <span><small>Combinaisons</small><strong data-grand-carnet-combinations>1</strong></span>
            <span><small>Montant illustratif</small><strong data-grand-carnet-cost>${game.stake ? `${escapeHtml(game.stake)} FCFA` : 'À confirmer'}</strong></span>
          </div>
          <p>C(${escapeHtml(game.podium)}, ${escapeHtml(game.podium)})${game.stake ? ` × ${escapeHtml(game.stake)} FCFA` : ''}</p>
        </div>
      </div>
        </div>
      </details>
    </section>`;
}

function setupGrandCarnetCalculator(game, root) {
  const calculator = $('[data-grand-carnet]', root);
  if (!game || !calculator) return;
  const input = $('#grand-carnet-horses', calculator);
  const combinationsNode = $('[data-grand-carnet-combinations]', calculator);
  const costNode = $('[data-grand-carnet-cost]', calculator);
  const formulaNode = $('p', calculator);

  const update = () => {
    const selected = Math.max(game.podium, Math.min(20, Number.parseInt(input.value, 10) || game.podium));
    input.value = String(selected);
    const combinations = combinationCount(selected, game.podium);
    combinationsNode.textContent = combinations.toLocaleString('fr-FR');
    costNode.textContent = game.stake
      ? `${(combinations * game.stake).toLocaleString('fr-FR')} FCFA`
      : 'À confirmer';
    formulaNode.textContent = `C(${selected}, ${game.podium})${game.stake ? ` × ${game.stake} FCFA` : ''}`;
  };

  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
}

async function loadNationalSpotlight() {
  const node = $('#national-race');
  const country = countryDetails(state.nationalCountry);
  node.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div>';
  try {
    const data = await api(`/races/national?country=${encodeURIComponent(state.nationalCountry)}`);
    const nationalRace = data.pick?.race || null;
    const race = nationalRace || fallbackQuinte();
    const game = data.game || null;
    state.nationalGame = game;
    state.nationalRaceId = nationalRace?.id || null;
    const gameGuide = renderNationalGameGuide(game);
    if (!race) {
      node.innerHTML = `<div class="national-empty"><strong>${escapeHtml(country.flag)} Sélection ${escapeHtml(country.name)}</strong><p>La course nationale est en cours de préparation. Les règles du jeu du jour restent disponibles ci-dessous.</p></div>${gameGuide}`;
      setupGrandCarnetCalculator(game, node);
      setupNationalBudget(node);
      return;
    }
    const isNational = Boolean(nationalRace);
    const journalUrl = safeHttpUrl(data.pick?.journalUrl);
    const gameSeal = isNational && game?.label === 'Tiercé'
      ? 'T<span>3</span>'
      : isNational && game?.label === 'Quarté'
        ? 'Q<span>4</span>'
        : 'Q<span>5</span>';
    const nationalLabel = game
      ? `${game.label.toUpperCase()} ${country.name.toUpperCase()}`
      : `SÉLECTION ${country.name.toUpperCase()}`;
    const gameTags = isNational && game
      ? `<span>${escapeHtml(game.podium)} chevaux au podium</span><span>${game.stake ? `${escapeHtml(game.stake)} FCFA / combinaison` : 'Mise à confirmer'}</span>`
      : '<span>Pronostic final : 5 chevaux</span>';
    node.innerHTML = `
      <div class="quinte-seal" aria-hidden="true">${gameSeal}</div>
      <div class="national-main">
        <span class="national-status">${escapeHtml(country.flag)} ${isNational ? escapeHtml(nationalLabel) : 'PROGRAMME INTERNATIONAL'} · ${escapeHtml(dateLabel(data.date || race.date))}</span>
        <span class="race-discipline-badge race-discipline-prominent">${escapeHtml(raceDiscipline(race))}</span>
        <h4>${escapeHtml(race.name)}</h4>
        <p>${[race.track, race.number, race.time, race.distance, race.type || race.discipline].filter(Boolean).map(escapeHtml).join(' · ')}</p>
        <div class="national-tags"><span>${escapeHtml((isNational && game?.label) || data.pick?.betType || (race.isQuinte ? 'Quinté+' : 'Course du jour'))}</span><span>${escapeHtml(race.runners || 0)} partants</span>${gameTags}</div>
      </div>
      <div class="national-actions">
        <button class="button button-primary" type="button" data-national-race="${escapeHtml(race.id)}">Voir les partants et le pronostic <span>→</span></button>
        ${journalUrl ? `<a class="journal-link" href="${escapeHtml(journalUrl)}" target="_blank" rel="noopener noreferrer">Journal hippique ↗</a>` : ''}
        ${!isNational ? '<small>La sélection nationale sera affichée dès sa validation.</small>' : '<small>Course nationale retenue pour votre pays.</small>'}
      </div>
      ${gameGuide}`;
    setupGrandCarnetCalculator(game, node);
    setupNationalBudget(node);
    const button = $('[data-national-race]', node);
    if (button) button.addEventListener('click', async () => {
      await selectRace(button.dataset.nationalRace, 'national');
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
  $('#hero-meta').textContent = [raceReference(first.race), first.race.distance, `${first.race.runners || 0} partants`].filter(Boolean).join(' · ');
  $('#hero-race-status').textContent = first.race.isQuinte ? 'COURSE NATIONALE · QUINTÉ+' : 'COURSE DU JOUR';
  $('#hero-discipline').textContent = raceDiscipline(first.race);
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

async function selectRace(id, requestedMode = null) {
  state.selectedRaceId = id;
  state.selectedRaceMode = requestedMode === 'national' || requestedMode === 'ecd'
    ? requestedMode
    : String(id) === String(state.nationalRaceId)
      ? 'national'
      : 'ecd';
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
    if (window.matchMedia('(max-width: 980px)').matches) {
      detailNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
  const podium = Number(pick.probaPodium);
  const facts = [];
  if (Number.isFinite(podium) && podium > 0) facts.push(`${Math.round(podium * 100)} % estimés pour le podium`);
  if (pick.odds != null && Number.isFinite(Number(pick.odds))) facts.push(`cote ${Number(pick.odds).toLocaleString('fr-FR')}`);
  if (pick.form) facts.push(`forme ${pick.form}`);
  const evidence = facts.length ? ` À retenir : ${facts.join(', ')}.` : ' Consultez les partants et les cotes avant de jouer.';
  const intros = {
    base: 'Premier cheval retenu pour construire le jeu.',
    favorite: 'Cheval le plus joué selon la cote disponible.',
    couple: 'Cheval associé à la base pour former le duo.',
    chance: 'Cheval retenu pour compléter le jeu.',
    tocard: 'Cheval peu joué qui peut créer la surprise.',
    tip: pick.valueBet ? 'Cheval intéressant au regard de sa cote.' : 'Cheval à surveiller pour compléter le Podium + 2.',
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

function predictionSelectionProfile(detail = {}, availablePicks = 0) {
  const activeRunners = (detail.horses || []).filter((horse) => !horse.nonPartant).length
    || Math.max(0, Number(detail.runners) || 0)
    || Math.max(0, Number(availablePicks) || 0);
  const isNational = Boolean(
    state.selectedRaceMode === 'national'
    &&
    detail.id
    && state.nationalRaceId
    && String(detail.id) === String(state.nationalRaceId)
    && Number(state.nationalGame?.podium) > 0
  );
  const podium = isNational
    ? Number(state.nationalGame.podium)
    : activeRunners > 0 && activeRunners < 8
      ? 2
      : 3;
  const desiredSize = podium + 2;
  const selectionSize = activeRunners > 0 ? Math.min(activeRunners, desiredSize) : desiredSize;
  return {
    isNational,
    podium,
    selectionSize,
    label: isNational
      ? `${state.nationalGame.label || 'Course nationale'} + 2`
      : podium === 2 ? 'Jumelé ordre + 2' : 'Trio + 2',
  };
}

function canonicalPredictionPicks(prediction, detail = {}) {
  const horses = detail.horses || [];
  const seen = new Set();
  return (prediction?.topPicks || [])
    .map((pick, index) => ({ pick, index }))
    .sort((left, right) => (
      Number(left.pick?.rank || 999) - Number(right.pick?.rank || 999)
      || left.index - right.index
    ))
    .map(({ pick }) => enrichPick(pick, horses))
    .filter((pick) => {
      const key = String(pick?.number ?? '');
      if (!pick || !key || pick.nonPartant || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function finalPickLabel(index, podium) {
  if (index >= podium) return `Complément ${index - podium + 1}`;
  return index === 0 ? '1er choix' : `${index + 1}e choix`;
}

function canonicalPredictionRoles(selected = []) {
  const base = selected.slice(0, 1);
  const couple = selected.slice(0, 2);
  const remaining = selected.slice(2);
  const tocard = remaining
    .filter((pick) => Number(pick.odds) >= 15 || pick.valueBet)
    .filter((pick) => pick.probaPodium == null || Number(pick.probaPodium) >= 0.1)
    .sort((left, right) => (
      Number(right.probaPodium || 0) - Number(left.probaPodium || 0)
      || Number(right.aiScore || 0) - Number(left.aiScore || 0)
    ))[0] || null;
  const tip = [...remaining].reverse().find((pick) => pick.number !== tocard?.number)
    || selected[selected.length - 1]
    || null;
  const chances = remaining.filter((pick) => (
    pick.number !== tocard?.number && pick.number !== tip?.number
  ));
  const marketFavorite = selected
    .filter((pick) => Number(pick.odds) > 1)
    .sort((left, right) => Number(left.odds) - Number(right.odds))[0] || null;
  return { base, couple, chances, tocards: tocard ? [tocard] : [], marketFavorite, tip };
}

function predictionMarkup(prediction, error, detail) {
  if (state.selectedRaceMode === 'ecd' && state.ecdProfile?.verified !== true) {
    return '<section class="prediction-block locked-prediction"><h4>Format ECD non validé pour ce pays</h4><p>ParisPromax n’applique pas automatiquement les règles Jumelé ordre / Trio du Burkina Faso. Le pronostic de jeu reste suspendu jusqu’à validation des règles locales.</p></section>';
  }
  if (prediction?.topPicks?.length) {
    const canonical = canonicalPredictionPicks(prediction, detail);
    const profile = predictionSelectionProfile(detail, canonical.length);
    const selected = canonical.slice(0, profile.selectionSize);
    const { base, couple, chances, tocards, marketFavorite, tip } = canonicalPredictionRoles(selected);
    return `<section class="prediction-block">
      <div class="prediction-title"><div><small>POURQUOI CES CHEVAUX</small><h4>Pronostic ParisPromax</h4></div><span>REPÈRES DE COURSE</span></div>
      <div class="final-verdict"><div><span>PRONOSTIC FINAL</span><h5>${escapeHtml(profile.label)}</h5><p>${selected.length} chevaux, préfixe du même classement de référence.</p></div><div class="final-five final-size-${selected.length}">
        ${selected.map((pick, index) => `<div class="final-pick ${index < profile.podium ? 'podium' : 'complement'}"><small>${escapeHtml(finalPickLabel(index, profile.podium))}</small><b>${escapeHtml(pick.number)}</b><span>${escapeHtml(pick.name)}</span></div>`).join('')}
      </div></div>
      <div class="analysis-grid">
        ${roleCard('Base', 'Point d’appui', base, 'base', 'role-base')}
        ${roleCard('Favori', 'Lecture du marché', marketFavorite ? [marketFavorite] : [], 'favorite', 'role-favorite')}
        ${roleCard('Couplé', 'Duo recommandé', couple, 'couple', 'role-couple')}
        ${roleCard('Chances régulières', 'Profils solides', chances, 'chance', 'role-chance')}
        ${roleCard('Tocard', 'Risque assumé', tocards, 'tocard', 'role-tocard')}
        ${roleCard('Tuyau', 'Signal à suivre', tip ? [tip] : [], 'tip', 'role-tip')}
      </div>
      <p class="analysis-disclaimer">Pronostic indicatif. Aucun gain n’est garanti.</p>
    </section>`;
  }
  if (state.token && error?.status === 402) {
    return '<section class="prediction-block locked-prediction"><h4>Accès complet requis</h4><p>Choisissez une formule pour afficher le pronostic détaillé de cette course.</p><a class="button button-primary" href="#abonnements">Voir les formules</a></section>';
  }
  if (state.token) return `<section class="prediction-block locked-prediction"><p>${escapeHtml(error?.message || 'Pronostic en cours de préparation.')}</p></section>`;
  return `<section class="prediction-block locked-prediction">${raceCarouselPlaceholder('Course sélectionnée', 2)}<h4>Connectez-vous pour voir le pronostic</h4><p>Les partants et les cotes restent accessibles ci-dessous.</p><button class="button button-primary" type="button" data-race-login>Se connecter</button></section>`;
}

function officialResultMarkup(detail) {
  const winners = (detail?.result?.winners || []).slice(0, 5);
  if (!winners.length) {
    const startsAt = detail?.startsAt ? new Date(detail.startsAt).getTime() : NaN;
    if (!Number.isFinite(startsAt) || startsAt > Date.now()) return '';
    return `<section class="official-result partial">
      <div class="official-result-head">
        <div><span>ARRIVÉE EN VALIDATION</span><h4>Résultat officiel en attente</h4></div>
        <small>La course est passée · actualisation automatique</small>
      </div>
      <p>Le résultat apparaîtra dès sa publication par l’opérateur officiel. Aucun bilan n’est calculé entre-temps.</p>
    </section>`;
  }
  const horses = detail.horses || [];
  const activeRunnerCount = horses.filter((horse) => !horse.nonPartant).length;
  const nationalPlaces = state.selectedRaceMode === 'national'
    && String(detail?.id || '') === String(state.nationalRaceId || '')
    ? Number(state.nationalGame?.podium) || 0
    : 0;
  const ecdPlaces = state.selectedRaceMode === 'ecd' && state.ecdProfile?.verified === true
    ? (activeRunnerCount > 0 && activeRunnerCount < 8 ? 2 : 3)
    : 0;
  const expectedPlaces = nationalPlaces || ecdPlaces || Math.min(3, activeRunnerCount || 3);
  const resultComplete = winners.length >= expectedPlaces;
  return `<section class="official-result ${resultComplete ? 'complete' : 'partial'}">
    <div class="official-result-head">
      <div><span>${resultComplete ? 'ARRIVÉE VALIDÉE' : 'ARRIVÉE OFFICIELLE PARTIELLE'}</span><h4>${resultComplete ? 'Résultat officiel' : 'Résultat en cours de complétion'}</h4></div>
      <small>${resultComplete ? `Source officielle · ${escapeHtml(dateLabel(detail.date))}` : `${winners.length}/${expectedPlaces} positions disponibles · bilan suspendu`}</small>
    </div>
    <div class="official-result-list">
      ${winners.map((number, index) => {
        const horse = horses.find((item) => String(item.number) === String(number));
        return `<div class="${index === 0 ? 'winner' : ''}">
          <small>${index + 1}${index === 0 ? 'er' : 'e'}</small>
          <b>${escapeHtml(number)}</b>
          <span>${escapeHtml(horse?.name || `N° ${number}`)}</span>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function nationalStrategyMarkup(detail) {
  const game = state.selectedRaceMode === 'national'
    && detail?.id === state.nationalRaceId
    ? state.nationalGame
    : null;
  if (!game?.strategies?.length) return '';
  return `<section class="national-smart-play">
    <div>
      <span>JEUX DU JOUR · ${escapeHtml(game.countryName || '')}</span>
      <h4>${escapeHtml(game.label)} : choisissez votre couverture</h4>
      <p>Le nombre de chevaux, les combinaisons et la mise totale sont affichés pour chaque choix.</p>
    </div>
    <div class="national-smart-options">
      ${game.strategies.map((strategy) => `<span class="${strategy.id === 'coverage' ? 'recommended' : ''}">
        <small>${escapeHtml(strategy.label)}</small>
        <strong>${escapeHtml(strategy.selectedHorses)} chevaux</strong>
        <em>${escapeHtml(strategy.combinations)} combinaison${strategy.combinations > 1 ? 's' : ''}${strategy.cost != null ? ` · ${escapeHtml(strategy.cost.toLocaleString('fr-FR'))} FCFA` : ''}</em>
      </span>`).join('')}
    </div>
  </section>`;
}

function renderRaceDetail(context, detail, prediction, predictionError) {
  const horses = detail.horses || [];
  const activeRunnerCount = horses.filter((horse) => !horse.nonPartant).length;
  const nonRunnerCount = horses.length - activeRunnerCount;
  const reference = raceReference(context?.race || detail);
  $('#race-detail').innerHTML = `<div class="detail-head"><div><span class="section-kicker">${escapeHtml([reference, context?.track?.name || detail.track || 'COURSE'].filter(Boolean).join(' · '))}</span><h3>${escapeHtml(detail.name)}</h3><p>${[detail.time, detail.distance, detail.type || detail.discipline, dateLabel(detail.date)].filter(Boolean).map(escapeHtml).join(' · ')}</p></div><div class="detail-badges"><span class="race-discipline-badge race-discipline-prominent">${escapeHtml(raceDiscipline(detail))}</span><span class="race-badge">${activeRunnerCount} PARTANTS ACTIFS${nonRunnerCount > 0 ? ` · ${nonRunnerCount} NP` : ''}</span></div></div>
    ${officialResultMarkup(detail)}
    ${nationalStrategyMarkup(detail)}
    ${predictionMarkup(prediction, predictionError, detail)}
    <p class="horizontal-scroll-hint">Faites glisser le tableau vers la gauche pour voir toutes les colonnes.</p>
    <div class="table-wrap" tabindex="0" aria-label="Tableau des partants, défilement horizontal"><table class="horse-table"><thead><tr><th>N°</th><th>Cheval</th><th>Jockey / entraîneur</th><th>Forme</th><th>Cote</th></tr></thead><tbody>
      ${horses.map((horse) => `<tr><td><span class="horse-num">${escapeHtml(horse.number)}</span></td><td><span class="horse-name">${escapeHtml(horse.name)}</span>${horse.nonPartant ? '<span class="horse-sub">Non-partant</span>' : ''}</td><td><span>${escapeHtml(horse.jockey || '—')}</span><span class="horse-sub">${escapeHtml(horse.trainer || '')}</span></td><td>${escapeHtml(horse.form || '—')}</td><td class="odds">${horse.odds != null ? escapeHtml(horse.odds) : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  hydrateRaceCarousels($('#race-detail'));
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
  await refreshMe();
  if (!state.me) {
    state.token = '';
    sessionStorage.removeItem('ppm_web_token');
    throw new Error('La session n’a pas pu être ouverte. Réessayez.');
  }
  closeDialogs();
  toast('Connexion réussie');
  if (state.selectedRaceId) selectRace(state.selectedRaceId, state.selectedRaceMode);
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
  if (!state.token) {
    renderSession();
    renderResults();
    return loadNationalSpotlight();
  }
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
  renderResults();
  await loadNationalSpotlight();
}

function renderSession() {
  const loggedIn = Boolean(state.token && state.me);
  $$('[data-open-auth]').forEach((button) => button.classList.toggle('hidden', loggedIn));
  $$('[data-referral-guest]').forEach((node) => node.classList.toggle('hidden', loggedIn));
  $$('[data-referral-member]').forEach((node) => node.classList.toggle('hidden', !loggedIn));
  $('#account-button').classList.toggle('hidden', !loggedIn);
  $('#espace').classList.toggle('hidden', !loggedIn);
  buildMemberNotifications();
  if (!loggedIn) {
    $('#referral-link').value = '';
    $('#contact-referral-link').value = '';
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
  $('#contact-referral-link').value = referralCode ? referralUrl(referralCode) : '';
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
  if (state.selectedRaceId) selectRace(state.selectedRaceId, state.selectedRaceMode);
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
    loadRaces()
      .then(() => Promise.all([loadResults(), loadSuccessRate()]))
      .catch(() => {});
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
  $('#contact-copy-referral').addEventListener('click', copyReferralLink);
  $('#contact-share-referral').addEventListener('click', shareReferralLink);
  $$('[data-results-category]').forEach((button) => button.addEventListener('click', () => {
    state.resultCategory = button.dataset.resultsCategory;
    renderResults();
  }));
  $$('[data-open-ecd-results]').forEach((link) => link.addEventListener('click', () => {
    state.resultCategory = 'ecd';
    renderResults();
  }));
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
  startRaceCarousels();
  renderCountryMarquee();
  try { await loadCatalogs(); }
  catch (error) { toast(`Configuration indisponible : ${error.message}`); }
  await loadRaces();
  await Promise.all([loadResults(), refreshMe(), loadReviewSummary(), loadSuccessRate()]);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadRaces().then(() => Promise.all([loadResults(true), loadSuccessRate()])).catch(() => {});
    }
  }, 120000);
  applyReferralInvitation();
  const requestedAuth = new URLSearchParams(window.location.search).get('auth');
  if (!state.token && requestedAuth === 'register') openAuth('register');
  if (!state.token && requestedAuth === 'login') openAuth('login');
}

boot();
