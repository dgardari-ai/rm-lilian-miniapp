export const COMMUNITY_URL = 'https://vk.me/rubiamorena';
export const VK_APP_ID = 54826868;

const MESSAGES = {
  initializing: 'Подождите, устанавливаем связь с ВК.',
  'environment-failed': 'Не удалось определить окружение. Закройте страницу и откройте её снова.',
  'init-unavailable': 'Библиотека ВК недоступна. Закройте мини-приложение и откройте его снова.',
  'init-not-confirmed': 'ВК не подтвердил запуск. Закройте мини-приложение и откройте его снова.',
  'init-failed': 'Не удалось установить связь с ВК. Закройте мини-приложение и откройте его снова.',
  'init-timeout': 'ВК не ответил вовремя. Закройте мини-приложение и откройте его снова.',
  'invalid-text': 'Сначала подготовьте текст обращения.',
  'insecure-context': 'Для копирования откройте защищённую версию страницы по HTTPS.',
  'clipboard-unavailable': 'Этот браузер не предоставляет копирование. Попробуйте открыть страницу в другом браузере.',
  'copy-not-confirmed': 'Копирование не подтверждено. Чат не открыт. Попробуйте ещё раз.',
  'copy-failed': 'Не удалось скопировать текст. Чат не открыт. Попробуйте ещё раз.',
  'copy-timeout': 'Не удалось вовремя подтвердить копирование. Чат не открыт. Попробуйте ещё раз.',
  busy: 'Дождитесь завершения копирования.',
};

class OperationTimeout extends Error {}

// Invoke immediately, preserving the caller's user gesture for browser clipboard access.
// A timeout does not cancel the platform operation; its late result cannot replace the outcome.
async function bounded(operation, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeout()), milliseconds);
  });
  try {
    return await Promise.race([Promise.resolve(operation()), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function failure(code) {
  return {
    ok: false,
    status: code === 'busy' ? 'busy' : 'failed',
    copied: false,
    url: COMMUNITY_URL,
    code,
    message: MESSAGES[code],
  };
}

/**
 * Owns only initialization and copying.
 * Create once when the page is ready, await `ready`, then call `copyText(text)`
 * directly from a user click. No copy or permission request runs at creation.
 * The transport never opens a page; the UI owns any separate user action on the returned URL.
 */
export function createVkTransport({
  bridge = null,
  clipboard = null,
  secureContext = false,
  timeoutMs = 8000,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');

  let embedded = false;
  let environmentFailed = false;
  try {
    embedded = typeof bridge?.isEmbedded === 'function' && bridge.isEmbedded() === true;
  } catch {
    environmentFailed = true;
  }

  let busy = false;
  let readiness = Object.freeze({
    ok: !embedded && !environmentFailed,
    embedded,
    ...((embedded || environmentFailed) && { code: 'initializing', message: MESSAGES.initializing }),
  });

  function finishInitialization(code = null) {
    readiness = Object.freeze({
      ok: code === null,
      embedded,
      ...(code && { code, message: MESSAGES[code] }),
    });
    return readiness;
  }

  async function initialize() {
    if (environmentFailed) return finishInitialization('environment-failed');
    if (!embedded) return finishInitialization();
    if (typeof bridge.send !== 'function') return finishInitialization('init-unavailable');
    try {
      const response = await bounded(() => bridge.send('VKWebAppInit'), timeoutMs);
      return finishInitialization(response?.result === true ? null : 'init-not-confirmed');
    } catch (error) {
      return finishInitialization(error instanceof OperationTimeout ? 'init-timeout' : 'init-failed');
    }
  }

  // Exactly one initialization attempt, started before returning the transport.
  const ready = initialize();

  async function copyText(text) {
    if (busy) return failure('busy');
    if (!readiness.ok) return failure(readiness.code);
    if (typeof text !== 'string' || !text.trim()) return failure('invalid-text');
    if (!embedded && secureContext !== true) return failure('insecure-context');
    if (!embedded && typeof clipboard?.writeText !== 'function') return failure('clipboard-unavailable');

    busy = true;
    try {
      let copied;
      try {
        const response = await bounded(
          () => embedded
            ? bridge.send('VKWebAppCopyText', { text })
            : clipboard.writeText(text),
          timeoutMs,
        );
        copied = embedded ? response?.result === true : response !== false;
      } catch (error) {
        return failure(error instanceof OperationTimeout ? 'copy-timeout' : 'copy-failed');
      }
      if (!copied) return failure('copy-not-confirmed');

      return { ok: true, status: 'copied', copied: true, url: COMMUNITY_URL };
    } finally {
      busy = false;
    }
  }

  return Object.freeze({ embedded, ready, copyText });
}
