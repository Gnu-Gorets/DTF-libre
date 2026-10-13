const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let initialFeedPending =");
const end = source.indexOf("  const postIdForCard =", start);
const css = source.match(/  style.textContent = `([\s\S]*?)`;/)[1];
assert(start > 0, "initial gate implementation exists");
assert(!source.includes('content: "Загрузка…"'), "does not add loading text");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtf-feed-layout-"));
const fixture = `<!doctype html><html><head>
<style>${css}</style><style>html{overflow-y:scroll}body{margin:0}.content,.content-skeleton{height:200px}header{height:60px}</style>
</head><body><header id="header"><button>Write</button></header><main class="feed-page"><div id="feed-header">New</div><div class="content-list"><div id="skeleton"><div class="content-skeleton"></div><div class="content-skeleton"></div><div class="content-skeleton"></div><div class="content-skeleton"></div><div class="content-skeleton"></div></div><div id="posts"></div><div id="trigger"><div class="content-list__loader" style="display:none"></div></div></div></main>
<script>
const get = (key, fallback) => ({feedExtraPosts:true, feedPostMultiplier:3})[key] ?? fallback;
let wakeRestore = null;
const posts = document.querySelector('#posts');
const addPosts = count => {
  for (let i = 0; i < count; i++) {
    const card = document.createElement('article');
    card.className = 'content'; posts.append(card);
  }
};
const heights = [];
const checkVisible = element => {
  const computed = getComputedStyle(element);
  if (computed.visibility !== 'visible' || computed.display === 'none' || !element.getBoundingClientRect().height) throw Error('hidden page element: ' + element.id);
};
const checkGeometry = () => {
  heights.push(document.documentElement.scrollHeight);
  [document.body, document.querySelector('#header'), document.querySelector('#feed-header'), posts].forEach(checkVisible);
  const rootStyle = getComputedStyle(document.documentElement);
  if (rootStyle.overflowY !== 'scroll' || !rootStyle.scrollbarColor.includes('rgba(0, 0, 0, 0)')) throw Error('scrollbar must be transparent without blocking scrolling');
  if (getComputedStyle(document.querySelector('.feed-page')).position !== 'static' || getComputedStyle(document.querySelector('.content-list')).position !== 'static') throw Error('cards removed from native flow');
};
const loader = document.querySelector('.content-list__loader');
let requests = 0;
let busy = false;
const observer = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting || busy) return;
  busy = true;
  requests++;
  setTimeout(() => {
    busy = false;
    addPosts(12); checkGeometry();
  }, 4000);
}, {rootMargin:'200% 0px'});
${source.slice(start, end)}
syncInitialFeedGate();
const gutter = innerWidth - document.documentElement.clientWidth;
document.documentElement.classList.remove('dtf-vm-feed-pending');
if (innerWidth - document.documentElement.clientWidth !== gutter) throw Error('scrollbar suppression changes gutter');
syncInitialFeedGate();
if (document.readyState !== 'loading') throw Error('fixture missed parser-time startup');
[document.body, document.querySelector('#header'), document.querySelector('#feed-header'), document.querySelector('#skeleton')].forEach(checkVisible);
void loadExtraFeedPosts();
setTimeout(() => {
  try {
    scrollTo(0, 200);
    if (scrollY !== 200) throw Error('scrolling blocked during skeleton display');
    scrollTo(0, 0);
    addPosts(24);
    document.querySelector('#skeleton').remove();
    checkGeometry();
    observer.observe(document.querySelector('#trigger'));
  } catch (error) { document.body.dataset.result = 'FAIL: ' + error.message; }
}, 500);
const completion = setInterval(() => {
  if (feedLoading || feedPosts().length !== 72) return;
  clearInterval(completion);
  try {
    if (requests !== 4) throw Error('native pagination failed: ' + requests);
    if (heights.length !== 5 || heights.some((height, index) => index && height <= heights[index - 1])) throw Error('new cards not in document flow: ' + heights);
    if (document.documentElement.classList.contains('dtf-vm-feed-pending')) throw Error('scrollbar not restored');
    [document.body, document.querySelector('#header'), posts].forEach(checkVisible);
    if (scrollY !== 0) throw Error('viewport moved during pagination');
    document.body.dataset.result = 'PASS';
  } catch (error) { document.body.dataset.result = 'FAIL: ' + error.message; }
}, 50);
addEventListener('error', event => { document.body.dataset.result = 'FAIL: ' + event.message; });
</script></body></html>`;
fs.writeFileSync(path.join(dir, "test.html"), fixture);
(async () => {
  const profile = path.join(dir, "profile");
  const browser = spawn("/usr/bin/chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1280,900", `--user-data-dir=${profile}`,
    "--remote-debugging-port=0", `file://${dir}/test.html`,
  ], {stdio:"ignore"});
  let socket;
  const pause = () => new Promise(resolve => setTimeout(resolve, 50));
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(portFile) && Date.now() < deadline) await pause();
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener("open", resolve, {once:true}));
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    });
    const evaluate = expression => new Promise(resolve => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({id, method:"Runtime.evaluate", params:{expression, returnByValue:true}}));
    });
    let result;
    while (!result && Date.now() < deadline) {
      result = (await evaluate("document.body?.dataset.result")).result?.result?.value;
      await pause();
    }
    assert.equal(result, "PASS", result || "missing browser result");
    console.log("OK: visible skeleton/header/cards, transparent scrollbar with unchanged gutter, manual scrolling, parser-time startup, and native 3x pagination");
  } finally {
    socket?.close();
    const exited = new Promise(resolve => browser.once("exit", resolve));
    browser.kill();
    await exited;
    fs.rmSync(dir, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
