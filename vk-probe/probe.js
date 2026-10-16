'use strict';

const button = document.getElementById('check');
const result = document.getElementById('result');

function bounded(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

button.addEventListener('click', async () => {
  const bridge = window.vkBridge;
  if (!bridge || typeof bridge.supportsAsync !== 'function') {
    result.textContent = 'Библиотека ВК не загрузилась. Поддержка метода не проверена.';
    return;
  }
  if (!bridge.isEmbedded()) {
    result.textContent = 'Страница открыта вне встроенного мини-приложения. Этот запуск не проверяет возможности клиента ВК.';
    return;
  }
  button.disabled = true;
  result.textContent = 'Проверка доступности…';
  try {
    await bounded(bridge.send('VKWebAppInit'), 8000);
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
