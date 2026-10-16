'use strict';

const button = document.getElementById('check');
const result = document.getElementById('result');
const bridge = window.vkBridge;
let initialized = false;
let observedHandlers = null;
let receiveHandlers = null;
button.disabled = true;

function parseHandlers(data) {
  const handlers = data?.supportedHandlers;
  if (!Array.isArray(handlers) || handlers.length === 0 ||
      !handlers.every((method) => typeof method === 'string')) return null;
  return new Set(handlers);
}

// The desktop client may announce its list without a request identifier.
// Observe that event before initialization instead of treating a library fallback as a result.
if (typeof bridge?.subscribe === 'function') {
  bridge.subscribe((event) => {
    if (event.detail?.type !== 'SetSupportedHandlers') return;
    const handlers = parseHandlers(event.detail.data);
    if (!handlers) return;
    observedHandlers = handlers;
    if (receiveHandlers) receiveHandlers(handlers);
  });
}

function bounded(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function browserHandlers() {
  if (observedHandlers) return observedHandlers;
  try {
    return await bounded(new Promise((resolve, reject) => {
      receiveHandlers = resolve;
      bridge.send('SetSupportedHandlers').then((data) => {
        const handlers = parseHandlers(data);
        if (!handlers) {
          reject(new Error('invalid-list'));
          return;
        }
        observedHandlers = handlers;
        resolve(handlers);
      }, () => reject(new Error('request-error')));
    }), 8000);
  } finally {
    receiveHandlers = null;
  }
}

async function initialize() {
  if (!bridge || typeof bridge.send !== 'function' || typeof bridge.isEmbedded !== 'function') {
    result.textContent = 'Библиотека ВК не загрузилась. Поддержка метода не проверена.';
    return;
  }
  if (!bridge.isEmbedded()) {
    result.textContent = 'Страница открыта вне встроенного мини-приложения. Этот запуск не проверяет возможности клиента ВК.';
    return;
  }
  result.textContent = 'Устанавливаем связь с ВК…';
  try {
    const response = await bounded(bridge.send('VKWebAppInit'), 8000);
    if (response?.result !== true) {
      result.textContent = 'ВК не подтвердил запуск страницы. Закройте мини-приложение и откройте его снова.';
      return;
    }
    initialized = true;
    if (bridge.isWebView() && typeof bridge.supportsAsync !== 'function') {
      result.textContent = 'Связь с ВК установлена, но библиотека не предоставляет проверку возможностей.';
      return;
    }
    result.textContent = 'Связь с ВК установлена. Нажмите «Проверить доступность окна».';
    button.disabled = false;
  } catch {
    result.textContent = 'Не получено подтверждение запуска от ВК. Закройте мини-приложение и откройте его снова.';
  }
}

button.addEventListener('click', async () => {
  if (!initialized || button.disabled) return;
  button.disabled = true;
  result.textContent = 'Проверка доступности…';
  try {
    if (bridge.isWebView()) {
      const supported = await bounded(bridge.supportsAsync('VKWebAppShowMessageBox'), 8000);
      result.textContent = 'Встроенный мобильный клиент\n' + (supported
        ? 'Клиент объявляет поддержку окна сообщения. Работа с черновиком ещё не проверена.'
        : 'Этот клиент не объявляет поддержку окна сообщения. Другие клиенты этой проверкой не охвачены.');
    } else {
      const handlers = await browserHandlers();
      result.textContent = 'Встроенная браузерная страница\nПолучен действительный список возможностей ВК: ' + handlers.size + '.\n' +
        (handlers.has('VKWebAppShowMessageBox')
          ? 'Окно сообщения присутствует в списке. Работа с черновиком ещё не проверена.'
          : 'Окна сообщения в полученном списке нет. Этот клиент его не объявляет; это не сбой получения списка.');
    }
  } catch (error) {
    result.textContent = error?.message === 'invalid-list'
      ? 'ВК ответил без действительного списка возможностей. Наличие окна сообщения не установлено.'
      : error?.message === 'request-error'
        ? 'ВК отклонил запрос списка возможностей. Наличие окна сообщения не установлено.'
        : 'Не удалось получить ответ о возможностях ВК. Наличие окна сообщения не установлено.';
  } finally {
    button.disabled = false;
  }
});

// VK must receive its initialization event before it can expose the page controls.
void initialize();
