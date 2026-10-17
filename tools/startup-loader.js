(() => {
  'use strict';
  if (window.__rmStartupLoading) return;
  window.__rmStartupLoading = true;
  const release = __RM_RELEASE__;
  const shell = document.getElementById('rm-boot');
  const message = document.getElementById('rm-boot-message');
  const retry = document.getElementById('rm-retry');
  retry.onclick = () => location.reload();

  async function request(url, part, ms) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, {
            signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
          });
          if (!response.ok) throw new Error('HTTP');
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== part.bytes) throw new Error('Length');
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          if (btoa(String.fromCharCode(...digest)) !== part.sha256) throw new Error('Integrity');
          return bytes;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(); reject(new Error('Timeout'));
          }, ms);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function loadPart(part) {
    if (!Number.isInteger(part.bytes) || part.bytes < 1 || part.bytes >= 12288) {
      throw new Error('Part size');
    }
    try { return await request(new URL(part.path, document.baseURI).href, part, 2500); }
    catch { return request(new URL(part.path, release.mirror).href, part, 5000); }
  }

  async function loadGroup(group) {
    const parts = await Promise.all(group.parts.map(loadPart));
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function execute(group, text) {
    const script = document.createElement('script');
    if (group.id) script.id = group.id;
    script.textContent = text;
    let failure;
    const onError = (event) => { failure = event.error || new Error('Script'); };
    window.addEventListener('error', onError);
    try { document.head.appendChild(script); }
    finally { window.removeEventListener('error', onError); }
    if (failure) throw failure;
    if (group.id === 'telegram-sdk' && typeof window.Telegram?.WebApp?.ready !== 'function') {
      throw new Error('Telegram SDK');
    }
  }

  Promise.all(release.groups.map(loadGroup)).then((texts) => {
    const style = document.createElement('style');
    style.textContent = texts.filter((_, i) => release.groups[i].kind === 'style').join('');
    document.head.appendChild(style);
    release.groups.forEach((group, i) => { if (group.kind === 'script') execute(group, texts[i]); });
    document.documentElement.classList.remove('rm-booting');
    shell.hidden = true;
  }).catch(() => {
    message.textContent = 'Не удалось загрузить приложение. Попробуйте ещё раз.';
    retry.textContent = 'Перезагрузить';
    retry.hidden = false;
    shell.hidden = false;
  });
})();
