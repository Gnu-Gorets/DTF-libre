const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let feedInitialPostCount = null;");
const end = source.indexOf("  const postIdForCard =", start);
const css = source.match(/  style.textContent = `([\s\S]*?)`;/)[1];
assert(!source.includes("dtf-vm-feed-pending"), "does not block initial feed display");
assert(!source.includes('content: "Загрузка…"'), "does not add loading text");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtf-feed-layout-"));
const fixture = `<!doctype html><html><head>
<style>${css}</style><style>body{margin:0}.content{height:200px}</style>
</head><body><main class="feed-page"><div class="content-list"><div id="posts"></div><div id="trigger"><div class="content-list__loader" style="display:none"></div></div></div></main>
<script>
setTimeout(() => {
const get = (key, fallback) => ({feedExtraPosts:true, feedPostMultiplier:3})[key] ?? fallback;
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
  heights.push(document.documentElement.scrollHeight);
  if (getComputedStyle(posts).visibility !== 'visible') throw Error('posts hidden while loading');
};
checkGeometry();
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
observer.observe(document.querySelector('#trigger'));
${source.slice(start, end)}
loadExtraFeedPosts().then(() => {
  if (requests !== 4 || feedPosts().length !== 72) throw Error('native pagination failed: ' + requests);
  if (heights.length !== 5 || heights.some((height, index) => index && height <= heights[index - 1])) throw Error('new cards not in document flow');
  if (getComputedStyle(posts).visibility !== 'visible') throw Error('completed posts invisible');
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
    console.log("OK: visible 3x feed with hidden native loader, delayed responses, and no forced scroll");
  } finally {
    socket?.close();
    const exited = new Promise(resolve => browser.once("exit", resolve));
    browser.kill();
    await exited;
    fs.rmSync(dir, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
