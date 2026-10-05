const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "dtf.user.js"),
  "utf8",
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtf-comments-"));
const html = path.join(dir, "test.html");
const fixture = `<!doctype html><meta charset="utf-8"><body>
<div class="comments"><div class="comment"><button class="link-button link-button--small comment__expand">4 ответа</button></div></div>
<div class="comment comment--hidden"><button class="link-button link-button--small comment__expand">Свернуть</button></div>
<div class="comments-limit comments-limit--bottom"></div>
<script>
const values = new Map();
window.GM_getValue = (key, fallback) => values.has(key) ? values.get(key) : fallback;
window.GM_setValue = (key, value) => values.set(key, value);
window.GM_addValueChangeListener = () => 1;
window.GM_removeValueChangeListener = () => {};
window.GM_registerMenuCommand = (_, callback) => { window.menuCommand = callback; };
window.GM_xmlhttpRequest = () => { throw Error('Unexpected request'); };
window.unsafeWindow = window;
let limitClicks = 0, branchClicks = 0, hiddenCollapseClicks = 0;
const limit = document.querySelector('.comments-limit');
const addLimitButton = () => {
  const button = document.createElement('button');
  button.className = 'link-button link-button--default comments-limit__expand';
  button.textContent = 'Показать ещё';
  button.onclick = () => { limitClicks++; if (limitClicks === 4) button.remove(); else setTimeout(addLimitButton, 900); };
  limit.replaceChildren(button);
};
setTimeout(addLimitButton, 1100);
document.querySelector('.comments .comment__expand').onclick = event => { branchClicks++; event.currentTarget.textContent = 'Свернуть'; };
document.querySelector('.comment--hidden .comment__expand').onclick = event => { hiddenCollapseClicks++; event.currentTarget.textContent = '4 ответа'; };
</script><script>${source}</script><script>
setTimeout(() => {
  const fail = message => { document.body.dataset.result = 'FAIL: ' + message; };
  if (limitClicks !== 4) return fail('comment menu was not fully expanded');
  if (branchClicks !== 0) return fail('branches expanded while option disabled');
  if (hiddenCollapseClicks !== 1) return fail('hidden thread was not collapsed');
  window.menuCommand();
  const group = document.querySelector('[name=expandAllBranches]').closest('details');
  if (!group || group.open || group.querySelectorAll('label').length !== 2) return fail('comment subsettings are not collapsed together');
  group.open = true;
  if (group.querySelectorAll('label').length !== 2) return fail('comment subsettings did not expand');
  if (!document.querySelector('.dtf-vm-section h3 .dtf-vm-section-icon svg')) return fail('section SVG icon is missing');
  const all = document.querySelector('[name=expandAllBranches]');
  const skip = document.querySelector('[name=skipHiddenComments]');
  if (!all || all.checked || !skip || !skip.checked) return fail('defaults differ from ReReDesign export');
  all.checked = true; all.onchange({target: all});
  setTimeout(() => {
    if (branchClicks !== 1) return fail('enabled branch expansion did not click');
    document.body.dataset.result = 'PASS';
  }, 400);
}, 8000);
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
      "--virtual-time-budget=9500",
      `file://${html}`,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /data-result="PASS"/,
    result.stdout.slice(-700) + result.stderr,
  );
  console.log(
    "OK: full expansion, branch default/toggle, and hidden-thread skipping",
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
