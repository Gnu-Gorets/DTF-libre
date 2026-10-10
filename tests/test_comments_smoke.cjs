const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "dtf.user.js"),
  "utf8",
);
assert.doesNotMatch(
  source,
  /(?:window\.)?location\.reload\(/,
  "settings must not reload the page",
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtf-comment-smoke-"));
const html = path.join(dir, "test.html");
const values = {
  showCommentEdits: false,
  showHiddenComments: false,
  hideCommentMedia: true,
  hideCommentImages: true,
  hideCommentGifs: true,
  hideCommentVideos: false,
  showMediaRestore: true,
  enableCommentQuote: true,
};
const fixture = `<!doctype html><meta charset="utf-8"><body>
<div class="comment" data-id="1"><div class="comment-media"><img class="andropov-image"></div></div>
<div class="comment" data-id="2"><div class="comment-media"><div class="andropov-external-video"><div class="andropov-image"></div></div></div></div>
<div class="comment" data-id="3"></div>
<div class="comment" data-id="4"><div class="comment-media"><div class="andropov-video" data-loaded="true"><div class="andropov-video-player--with-controls"></div></div></div></div>
<div class="comment comment--hidden"><div class="comment__content">removed text</div></div>
<div id="select">Выделенный текст</div><div class="contenteditable__input" contenteditable="true"></div>
<script>
const values = new Map(Object.entries(${JSON.stringify(values)}));
window.GM_getValue = (key, fallback) => values.has(key) ? values.get(key) : fallback;
window.GM_setValue = (key, value) => values.set(key, value);
window.GM_addValueChangeListener = () => 1;
window.GM_removeValueChangeListener = () => {};
window.GM_registerMenuCommand = (name, callback) => { if (name === 'Настройки') window.__openDtfSettings = callback; };
window.GM_xmlhttpRequest = () => { throw Error('Unexpected request'); };
window.unsafeWindow = window;
window.fetch = async input => new Response(JSON.stringify({result:{items:String(input).includes('/comments?')?[{id:3,media:[{data:{has_audio:false}}]},{id:4,media:[{data:{has_audio:false}}]}]:[{data:{id:77,commentEditor:{enabled:false,text:'Комментарии закрыты'}}}]}}), {headers:{'Content-Type':'application/json'}});
</script><script>${source}</script><script>
(async () => {
  const fail = message => { document.body.dataset.result = 'FAIL: ' + message; };
  await fetch('https://api.dtf.ru/v2.10/feed');
  await new Promise(resolve => setTimeout(resolve, 150));
  const card = document.createElement('div'); card.className = 'content content--short'; card.innerHTML = '<a class="comments-counter" href="/entry/77"><svg class="icon icon--comment"></svg></a>'; document.body.append(card);
  await new Promise(resolve => setTimeout(resolve, 50));
  const media = document.querySelector('.comment-media');
  if (!media.hasAttribute('data-dtf-vm-restore') || getComputedStyle(media).display !== 'inline-flex') return fail('image was not hidden with restore control');
  media.dispatchEvent(new MouseEvent('click', {bubbles:true}));
  if (media.hasAttribute('data-dtf-vm-hidden')) return fail('media restore click failed');
  if (document.querySelector('.comment[data-id="2"] .comment-media').hasAttribute('data-dtf-vm-hidden')) return fail('external-video cover was mistaken for image');
  const loadedImage = document.createElement('div'); loadedImage.className = 'comment-media'; loadedImage.innerHTML = '<img src="loaded.jpg">';
  document.querySelector('.comment[data-id="3"]').append(loadedImage);
  await new Promise(resolve => setTimeout(resolve, 50));
  if (!loadedImage.hasAttribute('data-dtf-vm-hidden')) return fail('loaded image without andropov-image class was not hidden');
  GM_setValue('hideCommentImages', false); GM_setValue('hideCommentGifs', true);
  const stillImage = document.createElement('div'); stillImage.className = 'comment-media'; stillImage.innerHTML = '<div class="andropov-image"></div>';
  document.querySelector('.comment[data-id="3"]').append(stillImage);
  await fetch('https://api.dtf.ru/v2.10/comments?contentId=1');
  await new Promise(resolve => setTimeout(resolve, 100));
  if (stillImage.hasAttribute('data-dtf-vm-hidden')) return fail('still image was mistaken for GIF from has_audio=false');
  const icon = document.querySelector('.icon--comment');
  const badge = document.querySelector('.dtf-vm-nocomment');
  if (!icon.classList.contains('dtf-vm-nocomment-hidden') || !badge || !badge.querySelector('path[fill="#f44336"]') || !badge.querySelector('line[stroke="#f44336"]') || badge.querySelector('path')?.getAttribute('d').slice(0, 12) !== 'M15.815 9.78' || !document.querySelector('.comments-counter').title.includes('закрыты')) return fail('no-comment indicator missing: ' + JSON.stringify({icon: icon.className, badge: !!badge, title: document.querySelector('.comments-counter').title}));
  if (getComputedStyle(document.querySelector('.comment--hidden .comment__content')).display !== 'block') return fail('removed comment styling missing');
  for (const name of ['expandComments', 'showRemovedComments', 'enableCommentQuote']) GM_setValue(name, false);
  window.__openDtfSettings();
  const settingsGrid = document.querySelector('.dtf-vm-settings-grid');
  if (getComputedStyle(settingsGrid).gridTemplateColumns.trim().split(' ').length !== 3) return fail('settings grid has an unused column');
  const sectionCounts = [...settingsGrid.children].map(column => column.children.length).join(',');
  if (sectionCounts !== '3,3,3') return fail('settings columns are unbalanced: ' + sectionCounts);
  const middleSections = [...settingsGrid.children[1].querySelectorAll(':scope > .dtf-vm-section h3')].map(heading => heading.textContent).join(',');
  if (middleSections !== 'Интерфейс,Комментарии,Правая панель') return fail('middle column section order is wrong: ' + middleSections);
  const rightSections = [...settingsGrid.children[2].querySelectorAll(':scope > .dtf-vm-section h3')].map(heading => heading.textContent).join(',');
  if (rightSections !== 'Левая панель,Темы,Разное') return fail('right column section order is wrong: ' + rightSections);
  const gif = document.querySelector('.comment[data-id="4"] .comment-media');
  if (!gif.hasAttribute('data-dtf-vm-hidden')) return fail('GIF fixture was not hidden initially');
  const hideVideos = document.querySelector('.dtf-vm-dialog [name=hideCommentVideos]');
  hideVideos.checked = true; hideVideos.dispatchEvent(new Event('change', {bubbles:true}));
  const hideGifs = document.querySelector('.dtf-vm-dialog [name=hideCommentGifs]');
  hideGifs.checked = false; hideGifs.dispatchEvent(new Event('change', {bubbles:true}));
  if (gif.hasAttribute('data-dtf-vm-hidden')) return fail('GIF remained hidden when hide GIFs was disabled');
  const noCommentToggle = document.querySelector('.dtf-vm-dialog [name=showNoCommentIcon]');
  noCommentToggle.checked = false; noCommentToggle.dispatchEvent(new Event('change', {bubbles:true}));
  if (icon.classList.contains('dtf-vm-nocomment-hidden') || document.querySelector('.dtf-vm-nocomment')) return fail('disabling no-comment indicator did not update in place');
  noCommentToggle.checked = true; noCommentToggle.dispatchEvent(new Event('change', {bubbles:true}));
  if (!icon.classList.contains('dtf-vm-nocomment-hidden') || !document.querySelector('.dtf-vm-nocomment')) return fail('enabling no-comment indicator did not update in place');
  const hideMedia = document.querySelector('.dtf-vm-dialog [name=hideCommentMedia]');  hideMedia.checked = false; hideMedia.dispatchEvent(new Event('change', {bubbles:true}));
  const dependencies = {expandComments:['expandAllBranches','skipHiddenComments'],showRemovedComments:['showCommentEdits','showHiddenComments'],hideCommentMedia:['hideCommentGifs','hideCommentImages','hideCommentVideos','showMediaRestore'],enableCommentQuote:['quoteMoveTo']};
  for (const [parent, children] of Object.entries(dependencies)) for (const name of children) {
    const input = document.querySelector('.dtf-vm-dialog [name=' + name + ']');
    if (!input.disabled || !input.closest('label').classList.contains('dtf-vm-disabled')) return fail('dependent setting ' + name + ' was not disabled with ' + parent);
  }
  const expand = document.querySelector('.dtf-vm-dialog [name=expandComments]'); expand.checked = true; expand.dispatchEvent(new Event('change', {bubbles:true}));
  if (document.querySelector('.dtf-vm-dialog [name=expandAllBranches]').disabled) return fail('dependent settings did not enable with parent');
  document.body.dataset.result = 'PASS';
})().catch(error => { document.body.dataset.result = 'FAIL: ' + error.message; });
</script></body>`;
fs.writeFileSync(html, fixture);
try {
  const result = spawnSync(
    "/usr/bin/chromium",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${path.join(dir, "profile")}`,
      "--dump-dom",
      "--virtual-time-budget=3000",
      `file://${html}`,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const status = result.stdout.match(/data-result="([^"]+)"/);
  assert.equal(status?.[1], "PASS", status?.[1] || result.stderr);
  console.log(
    "OK: media restore, no-comment badge, and removed-comment styling",
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
