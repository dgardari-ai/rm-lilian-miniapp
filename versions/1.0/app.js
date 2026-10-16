import { CONFIG, normalizeHeight, validate, createContactUrl } from './model.mjs';

const state = { screen: 'intro', branch: null, size: null, height: '' };
const screens = ['intro', 'select', 'form'];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const heightInput = $('#height-input');
let attempted = false;
let telegram = null;

function populate() {
  const words = CONFIG.ui.introTitle.split(' ');
  $('#hero-heading').replaceChildren();
  for (const line of [words.slice(0, 2), words.slice(2, 4), words.slice(4)]) {
    const span = document.createElement('span'); span.textContent = line.join(' ');
    $('#hero-heading').append(span, ' ');
  }
  $$('[data-back] > span:last-child').forEach((label) => { label.textContent = CONFIG.ui.backButton; });
  const text = {
    '#intro-description': 'introDescription', '#start': 'startButton',
    '#select-title': 'branchTitle', '#form-heading': 'formTitle',
    '#size-label': 'sizeLabel', '#height-label': 'heightLabel',
    '#size-error': 'sizeError', '#height-error': 'heightError',
    '#contact-hint': 'contactHint',
  };
  for (const [selector, key] of Object.entries(text)) $(selector).textContent = CONFIG.ui[key];
  heightInput.placeholder = CONFIG.ui.heightPlaceholder;
  for (const branch of CONFIG.branches) {
    const figure = $(`[data-image-branch="${branch.key}"]`);
    figure.querySelector('img').src = branch.image;
    figure.querySelector('img').alt = branch.alt;
    figure.querySelector('figcaption').textContent = branch.collageLabel;
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'direction-card'; card.dataset.branch = branch.key;
    const image = document.createElement('img');
    image.src = branch.image; image.alt = branch.alt; image.width = branch.key === 'training' ? 1280 : 960; image.height = 1280;
    const copy = document.createElement('span');
    for (const [className, value] of [['d-brand', branch.brand], ['d-title', branch.cardTitle]]) {
      const span = document.createElement('span'); span.className = className; span.textContent = value; copy.append(span);
    }
    const arrow = document.createElement('span'); arrow.className = 'd-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '→';
    card.append(image, copy, arrow); card.addEventListener('click', () => selectBranch(branch.key)); $('#directions').append(card);
  }
  for (const size of CONFIG.sizes) {
    const label = document.createElement('label'); label.className = 'size-btn';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'size'; input.value = size; input.required = true; input.setAttribute('aria-describedby', 'size-error');
    const caption = document.createElement('span'); caption.textContent = size;
    input.addEventListener('change', () => { state.size = input.value; if (attempted) showErrors(); });
    label.append(input, caption); $('#size-options').append(label);
  }
}

function showErrors() {
  const result = validate(state);
  for (const key of ['size', 'height']) {
    $(`#${key}-error`).hidden = !result.errors[key];
  }
  heightInput.setAttribute('aria-invalid', String(Boolean(result.errors.height)));
  $('#size-field').setAttribute('aria-invalid', String(Boolean(result.errors.size)));
  $('#size-options').classList.toggle('has-error', Boolean(result.errors.size));
  return result;
}

function syncForm() {
  const branch = CONFIG.branches.find((item) => item.key === state.branch);
  if (!branch) return;
  $('#chosen-brand').textContent = branch.brand;
  $('#chosen-label').textContent = branch.cardTitle;
  $('#submit-btn').textContent = branch.cta;
  $('#chosen-photo').dataset.branch = branch.key;
  for (const img of [$('#photo-large'), $('#photo-inline')]) {
    img.src = branch.image; img.alt = branch.alt; img.dataset.branch = branch.key;
    img.width = branch.key === 'training' ? 1280 : 960; img.height = 1280;
  }
  heightInput.value = state.height;
  for (const radio of $$('input[name="size"]')) radio.checked = radio.value === state.size;
}

function showScreen(screen, { push = true, focus = true } = {}) {
  if (!screens.includes(screen) || (screen === 'form' && !state.branch)) screen = 'intro';
  state.screen = screen;
  for (const section of $$('.screen')) section.hidden = section.dataset.screen !== screen;
  const step = screens.indexOf(screen);
  $$('.step').forEach((segment, index) => segment.classList.toggle('active', index === step));
  $('.steps').setAttribute('aria-label', `Шаг ${step + 1} из 3`);
  if (push) history.pushState({ rmLilian: true, screen }, '', location.href);
  updateBackButton();
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (focus) $(`[data-screen="${screen}"] h1, [data-screen="${screen}"] h2`).focus({ preventScroll: true });
}

function selectBranch(key) {
  if (!CONFIG.branches.some((branch) => branch.key === key)) return;
  state.branch = key; syncForm();
  if (attempted) showErrors();
  showScreen('form');
}

function goBack() {
  if (state.screen !== 'intro') history.back();
}

function updateBackButton() {
  if (!telegram?.BackButton) return;
  if (state.screen === 'intro') telegram.BackButton.hide();
  else telegram.BackButton.show();
}

function updateSafeArea() {
  if (!telegram) return;
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const value = Math.max(0, Number(telegram.safeAreaInset?.[side]) || 0) + Math.max(0, Number(telegram.contentSafeAreaInset?.[side]) || 0);
    document.documentElement.style.setProperty(`--tg-safe-${side}`, `${value}px`);
  }
}

function initializeTelegram() {
  const candidate = window.Telegram?.WebApp;
  // The SDK also exists in ordinary browsers; only use the bridge in a launch context.
  if (telegram || !candidate?.initData || !candidate.platform || candidate.platform === 'unknown') return;
  telegram = candidate;
  document.documentElement.dataset.telegram = 'true';
  telegram.ready(); telegram.expand();
  if (telegram.isVersionAtLeast?.('6.1')) {
    telegram.setHeaderColor('#9AA982'); telegram.setBackgroundColor('#9AA982');
    telegram.BackButton?.onClick(goBack);
  }
  if (telegram.isVersionAtLeast?.('7.10')) telegram.setBottomBarColor?.('#9AA982');
  updateSafeArea(); updateBackButton();
  telegram.onEvent?.('safeAreaChanged', updateSafeArea);
  telegram.onEvent?.('contentSafeAreaChanged', updateSafeArea);
}

function openContact(event) {
  event.preventDefault(); attempted = true;
  state.height = normalizeHeight(heightInput.value);
  heightInput.value = state.height;
  const result = showErrors();
  if (!result.valid) {
    if (result.errors.size) $('input[name="size"]').focus();
    else heightInput.focus();
    return;
  }
  const url = createContactUrl(state.branch, state.size, result.height);
  initializeTelegram();
  if (telegram && typeof telegram.openTelegramLink === 'function') telegram.openTelegramLink(url);
  else window.location.assign(url);
}

populate();
history.replaceState({ rmLilian: true, screen: 'intro' }, '', location.href);
$('#start').addEventListener('click', () => showScreen('select'));
$('#home').addEventListener('click', () => { if (state.screen !== 'intro') showScreen('intro'); });
$$('[data-back]').forEach((button) => button.addEventListener('click', goBack));
window.addEventListener('popstate', (event) => {
  if (event.state?.rmLilian) showScreen(event.state.screen, { push: false });
});
heightInput.addEventListener('input', () => {
  // Keep malformed typing/paste visible and invalid: never turn -168 into 168.
  state.height = heightInput.value;
  if (attempted || /[^0-9\s]/.test(state.height)) { attempted = true; showErrors(); }
});
heightInput.addEventListener('blur', () => {
  state.height = normalizeHeight(heightInput.value); heightInput.value = state.height;
  if (attempted) showErrors();
});
$('#parameters').addEventListener('submit', openContact);
$('#telegram-sdk').addEventListener('load', initializeTelegram);
initializeTelegram();
showScreen('intro', { push: false, focus: false });
