const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let feedInitialRevealTimer = null;");
const end = source.indexOf("  const postIdForCard =", start);
const css = source.match(/  style.textContent = `([\s\S]*?)`;/)[1];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtf-feed-layout-"));
const fixture = `<!doctype html><html class="dtf-vm-feed-pending"><head>
<style>${css}</style><style>body{margin:0}.content{height:200px}</style>
</head><body><main class="feed-page"><div class="content-list"><div id="posts"></div><div id="trigger"><div class="content-list__loader" style="display:none"></div></div></div></main>
<script>
setTimeout(() => {
const get = (key, fallback) => ({feedExtraPosts:true, feedPostMultiplier:2})[key] ?? fallback;
let wakeRestore = null;
const posts = document.querySelector('#posts');
const addPosts = count => {
  for (let i = 0; i < count; i++) {
    const card = document.createElement('article');
    card.className = 'content'; posts.append(card);
  }
};
addPosts(24);
const heights = [];
const checkGeometry = () => {
  if (document.documentElement.classList.contains('dtf-vm-feed-pending')) {
    heights.push(document.documentElement.scrollHeight);
    if (getComputedStyle(posts).visibility !== 'hidden') throw Error('partial posts visible');
  }
};
checkGeometry();
const loader = document.querySelector('.content-list__loader');
let requests = 0;
const observer = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting || loader.style.display !== 'none') return;
  requests++;
  loader.style.display = 'block';
  setTimeout(() => {
    addPosts(12); checkGeometry();
    setTimeout(() => { loader.style.display = 'none'; }, 120);
  }, 100);
}, {rootMargin:'200% 0px'});
observer.observe(document.querySelector('#trigger'));
${source.slice(start, end)}
loadExtraFeedPosts().then(() => {
  if (requests !== 2 || feedPosts().length !== 48) throw Error('native pagination failed: ' + requests);
  if (new Set(heights).size !== 1) throw Error('initial scroll height changed: ' + heights);
  if (document.documentElement.classList.contains('dtf-vm-feed-pending')) throw Error('batch not revealed');
  if (getComputedStyle(posts).visibility !== 'visible') throw Error('completed posts invisible');
  if (document.documentElement.scrollHeight <= heights[0]) throw Error('completed feed still clipped');
  if (scrollY !== 0) throw Error('viewport moved');
  document.body.dataset.result = 'PASS';
}).catch(error => { document.body.dataset.result = 'FAIL: ' + error.message; });
}, 200);
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
    const deadline = Date.now() + 20000;
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
    console.log("OK: fixed initial scroll height, native IntersectionObserver pagination, atomic reveal");
  } finally {
    socket?.close();
    const exited = new Promise(resolve => browser.once("exit", resolve));
    browser.kill();
    await exited;
    fs.rmSync(dir, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
