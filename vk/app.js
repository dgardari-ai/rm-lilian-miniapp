import { CONFIG, normalizeHeight, validate, buildMessage } from '../model.mjs?v=1.1.2';
import { createVkTransport, COMMUNITY_URL } from './transport.mjs';

const state = { screen: 'intro', branch: null, size: null, height: '' };
const screens = ['intro', 'select', 'form', 'space'];
const stepByScreen = { intro: 0, select: 1, form: 2 };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const heightInput = $('#height-input');
let attempted = false;
let transportReady = false;
let contactBusy = false;
let operationId = 0;
let pendingNavigation = null;
const assetUrl = path => new URL('../' + path, import.meta.url).href;

const MIRROR = 'https://dgardari-ai.github.io/rm-lilian-miniapp/versions/1.1/';
const APPROVED_IMAGES = new Set([
  'assets/IMG_4584.jpeg', 'assets/IMG_4914.jpeg',
  'assets/IMG_4915.jpeg', 'assets/IMG_4920.jpeg',
]);
const imageRequests = new WeakMap();

/** Keep the original image first; a failed or stalled request gets one exact mirror. */
function setResilientImage(img, source, { timeoutMs = 2800 } = {}) {
  const primary = assetUrl(source);
  const previous = imageRequests.get(img);
  if (previous?.primary === primary && img.src === previous.expected) return;
  previous?.cleanup();

  const relative = source.replace(/^\.\//, '');
  const fallback = APPROVED_IMAGES.has(relative) ? MIRROR + relative : null;
  let timer;
  const request = { primary, expected: primary, usedFallback: false, cleanup };
  imageRequests.set(img, request);
  img.referrerPolicy = 'no-referrer';

  function cleanup() {
    clearTimeout(timer);
    img.removeEventListener('load', onLoad);
    img.removeEventListener('error', onError);
  }

  function isCurrent() {
    return imageRequests.get(img) === request && img.src === request.expected;
  }

  function isExpectedSource() {
    return !img.currentSrc || img.currentSrc === request.expected;
  }

  function useFallback() {
    if (!isCurrent() || request.usedFallback || !fallback) {
      cleanup();
      return;
    }
    if (img.complete && img.naturalWidth > 0 && isExpectedSource()) {
      cleanup();
      return;
    }
    cleanup();
    request.usedFallback = true;
    request.expected = fallback;
    img.src = fallback;
  }

  function onLoad() {
    if (!isCurrent()) return;
    if (!isExpectedSource()) return;
    cleanup();
  }

  function onError() {
    if (!isExpectedSource()) return;
    useFallback();
  }

  if (fallback) {
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    timer = setTimeout(useFallback, timeoutMs);
  }
  if (img.src !== primary) img.src = primary;
  if (img.complete && isExpectedSource()) {
    if (img.naturalWidth > 0) cleanup();
    else if (fallback) useFallback();
  }
}

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
    '#space-start': 'spaceButton', '#space-title': 'spaceTitle', '#city-prompt': 'cityPrompt',
  };
  for (const [selector, key] of Object.entries(text)) $(selector).textContent = CONFIG.ui[key];
  heightInput.placeholder = CONFIG.ui.heightPlaceholder;
  $('#contact-hint').textContent = 'Скопируем готовое обращение и откроем чат Rubia&Morena. Вставьте текст в сообщение и отправьте его.';
  for (const branch of CONFIG.branches) {
    const figure = $(`[data-image-branch="${branch.key}"]`);
    setResilientImage(figure.querySelector('img'), branch.image);
    figure.querySelector('img').alt = branch.alt;
    figure.querySelector('img').width = branch.imageWidth;
    figure.querySelector('img').height = branch.imageHeight;
    figure.querySelector('figcaption').textContent = branch.collageLabel;
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'direction-card'; card.dataset.branch = branch.key;
    const image = document.createElement('img');
    setResilientImage(image, branch.image); image.alt = branch.alt; image.width = branch.imageWidth; image.height = branch.imageHeight;
    const copy = document.createElement('span');
    const title = document.createElement('span'); title.className = 'd-title'; title.textContent = branch.cardTitle; copy.append(title);
    const arrow = document.createElement('span'); arrow.className = 'd-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '→';
    card.append(image, copy, arrow); card.addEventListener('click', () => selectBranch(branch.key)); $('#directions').append(card);
  }
  for (const city of CONFIG.cities) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'city-card'; button.dataset.city = city.key;
    const label = document.createElement('span'); label.className = 'city-label'; label.textContent = city.label;
    const arrow = document.createElement('span'); arrow.className = 'd-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '→';
    button.append(label, arrow);
    button.setAttribute('aria-describedby', 'city-contact-hint');
    button.addEventListener('click', () => copyAndOpen(city.message));
    $('#cities').append(button);
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
  $('#submit-btn').textContent = 'Скопировать и открыть чат';
  $('#chosen-photo').dataset.branch = branch.key;
  for (const img of [$('#photo-large'), $('#photo-inline')]) {
    setResilientImage(img, branch.image); img.alt = branch.alt; img.dataset.branch = branch.key;
    img.width = branch.imageWidth; img.height = branch.imageHeight;
  }
  heightInput.value = state.height;
  for (const radio of $$('input[name="size"]')) radio.checked = radio.value === state.size;
}

function showScreen(screen, { push = true, focus = true } = {}) {
  if (!screens.includes(screen) || (screen === 'form' && !state.branch)) screen = 'intro';
  operationId += 1;
  pendingNavigation = null;
  clearFeedback();
  state.screen = screen;
  for (const section of $$('.screen')) section.hidden = section.dataset.screen !== screen;
  const step = stepByScreen[screen];
  $('.steps').hidden = step === undefined;
  if (step !== undefined) {
    $$('.step').forEach((segment, index) => segment.classList.toggle('active', index === step));
    $('.steps').setAttribute('aria-label', `Шаг ${step + 1} из 3`);
  }
  if (push) history.pushState({ rmLilianVK: true, screen }, '', location.href);
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
  if (state.screen !== 'intro') {
    operationId += 1;
    pendingNavigation = null;
    history.back();
  }
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
  copyAndOpen(buildMessage(state.branch, state.size, result.height));
}

function clearFeedback() {
  $$('[data-contact-feedback]').forEach((area) => {
    area.hidden = true;
    area.querySelector('a').hidden = true;
    area.querySelector('p').textContent = '';
  });
}

function showFeedback(message, { copied = false, error = false } = {}) {
  const area = $(`[data-contact-feedback="${state.screen}"]`);
  if (!area) return;
  area.hidden = false;
  const text = area.querySelector('p');
  text.textContent = message;
  text.classList.toggle('error', error);
  text.setAttribute('role', error ? 'alert' : 'status');
  const link = area.querySelector('a');
  link.href = COMMUNITY_URL;
  link.hidden = !copied;
}

function showCopied() {
  showFeedback('Текст скопирован. В чате нажмите «Вставить», затем «Отправить». Если чат не открылся, воспользуйтесь ссылкой ниже.', { copied: true });
}

function updateContactControls() {
  $('#submit-btn').disabled = !transportReady || contactBusy;
  $$('.city-card').forEach((button) => { button.disabled = !transportReady || contactBusy; });
  heightInput.disabled = contactBusy;
  $$('input[name="size"]').forEach((input) => { input.disabled = contactBusy; });
}

function navigateToChat(url) {
  if (pendingNavigation === null || pendingNavigation !== operationId) return false;
  showCopied();
  // An iframe can refuse this attempt. The visible fallback link uses a fresh user click.
  const link = document.createElement('a');
  link.href = url;
  link.target = '_top';
  link.rel = 'noreferrer';
  link.hidden = true;
  document.body.append(link);
  try { link.click(); } finally { link.remove(); }
  return true;
}

async function copyAndOpen(text) {
  if (!transportReady || contactBusy) return;
  clearFeedback();
  const id = ++operationId;
  pendingNavigation = id;
  contactBusy = true;
  updateContactControls();
  showFeedback('Копируем сообщение…');
  try {
    const outcome = await transport.copyAndOpen(text);
    if (id !== operationId) return;
    if (outcome.copied) showCopied();
    else showFeedback(outcome.message || 'Не удалось скопировать сообщение. Попробуйте ещё раз.', { error: true });
  } catch {
    if (id === operationId) showFeedback('Не удалось завершить действие. Попробуйте ещё раз.', { error: true });
  } finally {
    if (pendingNavigation === id) pendingNavigation = null;
    contactBusy = false;
    updateContactControls();
  }
}

const bridge = window.vkBridge;
// Use only layout information emitted by the client; no profile or permission requests.
bridge?.subscribe?.((event) => {
  if (!['VKWebAppUpdateConfig', 'VKWebAppUpdateInsets'].includes(event.detail?.type)) return;
  const insets = event.detail.data?.insets;
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const value = Number(insets?.[side]);
    if (Number.isFinite(value) && value >= 0 && value <= 200) {
      document.documentElement.style.setProperty(`--vk-safe-${side}`, `${value}px`);
    }
  }
});

const transport = createVkTransport({
  bridge,
  clipboard: navigator.clipboard,
  secureContext: window.isSecureContext,
  navigate: navigateToChat,
});

setResilientImage($('#home img'), 'assets/IMG_4584.jpeg');
populate();
updateContactControls();
transport.ready.then((outcome) => {
  transportReady = outcome.ok;
  updateContactControls();
  const notice = $('#platform-status');
  notice.hidden = outcome.ok;
  if (!outcome.ok) notice.textContent = outcome.message;
});
history.replaceState({ rmLilianVK: true, screen: 'intro' }, '', location.href);
$('#start').addEventListener('click', () => showScreen('select'));
$('#space-start').addEventListener('click', () => showScreen('space'));
$('#home').addEventListener('click', () => { if (state.screen !== 'intro') showScreen('intro'); });
$$('[data-back]').forEach((button) => button.addEventListener('click', goBack));
window.addEventListener('popstate', (event) => {
  if (event.state?.rmLilianVK) showScreen(event.state.screen, { push: false });
});
heightInput.addEventListener('input', () => {
  clearFeedback();
  // Keep malformed typing/paste visible and invalid: never turn -168 into 168.
  state.height = heightInput.value;
  if (attempted || /[^0-9\s]/.test(state.height)) { attempted = true; showErrors(); }
});
heightInput.addEventListener('blur', () => {
  state.height = normalizeHeight(heightInput.value); heightInput.value = state.height;
  if (attempted) showErrors();
});
$('#parameters').addEventListener('submit', openContact);
$('#size-options').addEventListener('change', clearFeedback);

showScreen('intro', { push: false, focus: false });
