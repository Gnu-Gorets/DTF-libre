const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const waitForDtfStyles =");
const end = source.indexOf("\n  waitForDtfStyles();", start);
assert(start >= 0 && end > start);
const classes = new Set();
const listeners = {};
let timer;
let timerCleared = false;
let observerCallback;
let observerDisconnected = false;
let link = null;
let extraPosts = false;
let feedTimer;
const context = {
  get: () => extraPosts,
  revealInitialFeed: () => classes.delete("dtf-vm-feed-pending"),
  document: {
    readyState: "loading",
    documentElement: {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
    },
    querySelector: (selector) => {
      assert.equal(selector, 'link[rel="stylesheet"][href*="/assets/index-"]');
      return link;
    },
  },
  MutationObserver: class {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {
      observerDisconnected = true;
    }
  },
  window: {
    addEventListener(type, callback) {
      assert.equal(type, "load");
      listeners.windowLoad = callback;
    },
  },
  setTimeout: (callback, ms) => {
    if (ms === 20000) {
      feedTimer = callback;
      return 2;
    }
    assert.equal(ms, 5000);
    timer = callback;
    return 1;
  },
  clearTimeout: () => {
    timerCleared = true;
  },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.startGate = waitForDtfStyles;`,
  context,
);
context.startGate();
assert(
  classes.has("dtf-vm-waiting-css"),
  "content is hidden before stylesheet",
);
link = {
  sheet: null,
  addEventListener(type, callback) {
    listeners[type] = callback;
  },
};
observerCallback();
assert.equal(
  typeof listeners.load,
  "function",
  "wait for stylesheet load event",
);
listeners.load();
assert(!classes.has("dtf-vm-waiting-css"), "loaded stylesheet reveals content");
assert(timerCleared);
assert(observerDisconnected);

classes.clear();
link = null;
context.startGate();
assert(classes.has("dtf-vm-waiting-css"));
timer();
assert(
  !classes.has("dtf-vm-waiting-css"),
  "fallback reveals content after timeout",
);
extraPosts = true;
context.startGate();
assert(classes.has("dtf-vm-feed-pending"), "holds feed before initial rendering");
timer();
assert(classes.has("dtf-vm-feed-pending"), "stylesheet fallback does not reveal partial batch");
feedTimer();
assert(!classes.has("dtf-vm-feed-pending"), "feed timeout unblocks stalled initial loading");
console.log("OK: stylesheet and initial feed gates, with timeout fallbacks");
