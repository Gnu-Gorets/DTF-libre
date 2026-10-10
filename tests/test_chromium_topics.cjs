const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const script = fs.readFileSync(
  path.join(__dirname, "..", "dtf.user.js"),
  "utf8",
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtf-chromium-"));
const html = path.join(dir, "test.html");
const fixture = `<!doctype html><meta charset="utf-8"><body><div class="layout"></div><aside class="random-nav"><section class="random-group"><div class="random-heading" data-section="topics">Темы</div><div class="random-links"><a class="random-link" href="https://dtf.ru/games"><span>Игры</span></a><a class="random-link" href="https://dtf.ru/cinema"><span>Кино</span></a><a class="random-link" href="https://edu.vc.ru" target="_blank"><div><span>Обучение <svg></svg></span></div></a></div></section><section class="random-group"><button class="random-heading" data-section="services"><span>Сервисы</span></button><div class="random-links"><a class="random-link" href="/service">Сервис</a></div></section></aside><script>
const values = new Map([['smallFixes', false], ['hiddenTopics', [{path:'/stored-topic',name:'Saved topic'}]], ['topicCatalogCache', [{url:'https://dtf.ru/games',name:'Игры'}, {url:'https://dtf.ru/cinema',name:'Кино'}]], ['subscribedTopics', [{href:'/games',name:'Игры'}]]]);
window.GM_getValue = (key, fallback) => values.has(key) ? values.get(key) : fallback;
window.GM_setValue = (key, value) => values.set(key, value);
window.GM_addValueChangeListener = () => 1;
window.GM_removeValueChangeListener = () => {};
window.GM_registerMenuCommand = (label, callback) => { window.menuCommand = callback; };
window.GM_xmlhttpRequest = () => { throw Error('Unexpected network request'); };
window.sockets = [];
window.WebSocket = class { constructor() { this.sent = []; window.sockets.push(this); } send(value) { this.sent.push(value); } close() { this.closed = true; } };
window.unsafeWindow = window;
</script><script>${script}</script><script>
setTimeout(() => {
  const fail = message => { document.body.dataset.result = 'FAIL: ' + message; };
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const reconnects = [];
  window.setTimeout = (callback, delay, ...args) => {
    if (delay === 3000) { const timer = { callback, cleared: false }; reconnects.push(timer); return timer; }
    return nativeSetTimeout(callback, delay, ...args);
  };
  window.clearTimeout = timer => {
    if (timer && typeof timer === 'object') timer.cleared = true;
    else nativeClearTimeout(timer);
  };
  if (document.querySelector('.dtf-vm-topic-search')) return fail('enabled by default');
  window.menuCommand();
  const manageTopicsButton = document.querySelector('.dtf-vm-manage-hidden-topics');
  if (!manageTopicsButton) return fail('missing topic manager setting');
  manageTopicsButton.click();
  let manager = document.querySelector('.dtf-vm-topic-manager-overlay');
  let managerSearch = manager.querySelector('.dtf-vm-topic-manager-search');
  if (!managerSearch) return fail('missing topic search in manager');
  managerSearch.value = 'SAVED'; managerSearch.dispatchEvent(new Event('input', {bubbles:true}));
  if (manager.querySelectorAll('.dtf-vm-topic-manager-list label').length !== 1 || !manager.textContent.includes('Saved topic')) return fail('case-insensitive topic manager search');
  managerSearch.value = ''; managerSearch.dispatchEvent(new Event('input', {bubbles:true}));
  let storedTopic = [...manager.querySelectorAll('label')].find(label => label.textContent.trim() === 'Saved topic')?.querySelector('input');
  if (!storedTopic || storedTopic.checked) return fail('load saved hidden topics on startup');
  storedTopic.checked = true; storedTopic.onchange();
  if (values.get('hiddenTopics')?.length) return fail('restore saved hidden topic');
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  if (document.querySelector('.dtf-vm-topic-manager-overlay')) return fail('close topic manager with Escape');
  const toggle = document.querySelector('.dtf-vm-dialog [name=topicSearchEnabled]');
  if (!toggle || toggle.checked) return fail('missing disabled-by-default setting');
  const hideAds = document.querySelector('.dtf-vm-dialog [name=hidePlusAds]');
  const educationLink = document.querySelector('a[href="https://edu.vc.ru"]');
  const services = document.querySelector(':has(> [data-section="services"])');
  if (!hideAds || !educationLink || !services) return fail('missing ad setting or sidebar items');
  hideAds.checked = true; hideAds.onchange({target: hideAds});
  if (getComputedStyle(educationLink).display !== 'none' || getComputedStyle(services).display !== 'none') return fail('hide education and services with ads');
  hideAds.checked = false; hideAds.onchange({target: hideAds});
  if (getComputedStyle(educationLink).display === 'none' || getComputedStyle(services).display === 'none') return fail('show education and services with ads');
  const links = [...document.querySelector('[data-section="topics"]').parentElement.querySelectorAll('a[href]')];
  toggle.checked = true; toggle.onchange({target: toggle});
  let input = document.querySelector('.dtf-vm-topic-search');
  if (!input) return fail('enable');
  input.value = 'КИНО'; input.dispatchEvent(new Event('input', {bubbles:true}));
  if (!links[0].classList.contains('dtf-vm-topic-search-hidden') || links[1].classList.contains('dtf-vm-topic-search-hidden')) return fail('case-insensitive filtering');
  input.value = ' '; input.dispatchEvent(new Event('input', {bubbles:true}));
  if (links.some(link => link.classList.contains('dtf-vm-topic-search-hidden'))) return fail('clear query');
  toggle.checked = false; toggle.onchange({target: toggle});
  if (document.querySelector('.dtf-vm-topic-search') || links.some(link => link.classList.contains('dtf-vm-topic-search-hidden'))) return fail('disable and clear filter');
  toggle.checked = true; toggle.onchange({target: toggle});
  if (!document.querySelector('.dtf-vm-topic-search')) return fail('re-enable');
  const topic = document.querySelector('a[href="https://dtf.ru/games"]');
  if (document.querySelector('.dtf-vm-topic-hide')) return fail('obsolete per-topic hide control remains');
  manageTopicsButton.click();
  manager = document.querySelector('.dtf-vm-topic-manager-overlay');
  managerSearch = manager.querySelector('.dtf-vm-topic-manager-search');
  managerSearch.value = 'КИНО'; managerSearch.dispatchEvent(new Event('input', {bubbles:true}));
  if (manager.querySelectorAll('.dtf-vm-topic-manager-list label').length !== 1) return fail('filter topic list by query');
  managerSearch.value = ''; managerSearch.dispatchEvent(new Event('input', {bubbles:true}));
  let gamesToggle = [...manager.querySelectorAll('label')].find(label => label.textContent.trim() === 'Игры')?.querySelector('input');
  if (!gamesToggle?.checked) return fail('topic is not initially visible');
  gamesToggle.checked = false; gamesToggle.onchange();
  if (!topic.classList.contains('dtf-vm-topic-hidden') || values.get('hiddenTopics')?.[0]?.path !== '/games') return fail('hide topic from manager');
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  manageTopicsButton.click();
  manager = document.querySelector('.dtf-vm-topic-manager-overlay');
  gamesToggle = [...manager.querySelectorAll('label')].find(label => label.textContent.trim() === 'Игры')?.querySelector('input');
  if (gamesToggle?.checked) return fail('hidden topic toggle did not persist');
  gamesToggle.checked = true; gamesToggle.onchange();
  if (topic.classList.contains('dtf-vm-topic-hidden') || values.get('hiddenTopics')?.length) return fail('show topic from manager');
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  const smallFixes = document.querySelector('.dtf-vm-dialog [name=smallFixes]');
  smallFixes.checked = true; smallFixes.onchange({target: smallFixes});
  manageTopicsButton.click();
  manager = document.querySelector('.dtf-vm-topic-manager-overlay');
  gamesToggle = [...manager.querySelectorAll('label')].find(label => label.textContent.trim() === 'Игры')?.querySelector('input');
  gamesToggle.checked = false; gamesToggle.onchange();
  if (document.querySelector('.dtf-vm-topic-extras a[href="/games"]')) return fail('hide topic from full catalog');
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  const subscribed = document.querySelector('.dtf-vm-dialog [name=onlySubscribedTopics]');
  subscribed.checked = true; subscribed.onchange({target: subscribed});
  if (document.querySelector('.dtf-vm-topic-extras a[href="/games"]')) return fail('hide topic from subscriptions');
  manageTopicsButton.click();
  manager = document.querySelector('.dtf-vm-topic-manager-overlay');
  gamesToggle = [...manager.querySelectorAll('label')].find(label => label.textContent.trim() === 'Игры')?.querySelector('input');
  if (gamesToggle.checked) return fail('hidden topic toggle missing in subscriptions');
  gamesToggle.checked = true; gamesToggle.onchange();
  if (!document.querySelector('.dtf-vm-topic-extras a[href="/games"]')) return fail('show topic from subscriptions');
  const right = document.querySelector('.dtf-vm-dialog [name=hideRightSidebar]');
  const live = document.querySelector('.dtf-vm-dialog [name=livePanel]');
  right.checked = true; right.onchange({target: right});
  live.checked = true; live.onchange({target: live});
  const oldSocket = window.sockets[0];
  if (!oldSocket) return fail('live socket not created');
  const oldMessage = oldSocket.onmessage;
  const oldClose = oldSocket.onclose;
  live.checked = false; live.onchange({target: live});
  live.checked = true; live.onchange({target: live});
  const currentSocket = window.sockets[1];
  if (!currentSocket) return fail('live socket not recreated');
  oldMessage({data: '2'});
  oldClose();
  if (currentSocket.sent.length || reconnects.length) return fail('stale socket callback affected current connection');
  currentSocket.onclose();
  currentSocket.onclose();
  if (reconnects.length !== 1) return fail('duplicate close scheduled multiple reconnects');
  live.checked = false; live.onchange({target: live});
  if (!reconnects[0].cleared) return fail('disabling panel did not cancel reconnect');
  reconnects[0].callback();
  if (window.sockets.length !== 2) return fail('cancelled reconnect opened a socket');
  live.checked = true; live.onchange({target: live});
  const reconnectSocket = window.sockets[2];
  reconnectSocket.onclose();
  if (reconnects.length !== 2) return fail('close did not schedule reconnect');
  reconnects[1].callback();
  if (window.sockets.length !== 4) return fail('reconnect did not create exactly one socket');
  live.checked = false; live.onchange({target: live});
  document.body.dataset.result = 'PASS';
}, 300);
</script>`;
fs.writeFileSync(html, fixture);
try {
  const result = spawnSync(
    "/usr/bin/chromium",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
      `--user-data-dir=${path.join(dir, "profile")}`,
      "--dump-dom",
      "--virtual-time-budget=1000",
      `file://${html}`,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /data-result="PASS"/,
    result.stdout.slice(-500) + result.stderr,
  );
  console.log(
    "OK: topic search, visibility manager, and Live reconnect lifecycle in clean Chromium profile",
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
