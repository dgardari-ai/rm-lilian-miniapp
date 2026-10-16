'use strict';

const button = document.getElementById('check');
const result = document.getElementById('result');
const bridge = window.vkBridge;
let initialized = false;
button.disabled = true;

function bounded(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
    if (typeof bridge.supportsAsync !== 'function') {
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
    const supported = await bounded(bridge.supportsAsync('VKWebAppShowMessageBox'), 8000);
    const environment = bridge.isWebView() ? 'Встроенный мобильный клиент' : 'Встроенная браузерная страница';
    result.textContent = environment + '\n' + (supported
      ? 'Клиент объявляет поддержку окна сообщения. Работа с черновиком и подтверждение отправки ещё не проверены.'
      : 'Поддержка окна не подтверждена. В браузере причиной также может быть ошибка получения списка возможностей.');
  } catch {
    result.textContent = 'Клиент не завершил проверку. Этот результат не доказывает отсутствие метода.';
  } finally {
    button.disabled = false;
  }
});

// VK must receive its initialization event before it can expose the page controls.
void initialize();
