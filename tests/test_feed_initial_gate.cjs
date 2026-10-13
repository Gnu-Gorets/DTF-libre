const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let initialFeedPending =");
const end = source.indexOf("  let feedInitialPostCount =", start);
assert(start > 0 && end > start);
assert.match(source, /const primeLayout =[\s\S]*?syncInitialFeedGate\(\)/);

function makeGate(enabled = true) {
  const classes = new Set();
  const timers = new Map();
  const listeners = {};
  const frames = [];
  const feed = { isConnected: true };
  const context = {
    location: { pathname: "/my" },
    document: {
      documentElement: { classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
      } },
      querySelector: () => feed,
    },
    window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
    get: () => enabled,
    setTimeout(callback, delay) { timers.set(delay, callback); return delay; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => frames.push(callback),
  };
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.sync = syncInitialFeedGate;
    globalThis.finish = finishInitialFeed;
    globalThis.prepare = callback => { prepareInitialFeed = callback; };`, context);
  context.sync();
  return {
    context, feed, timers, listeners, frames,
    pending: () => classes.has("dtf-vm-feed-pending"),
    disable() { enabled = false; context.sync(); },
  };
}

const gate = makeGate();
assert(gate.pending(), "gate begins before cards arrive");
let prepared = false;
gate.context.prepare(() => { assert(gate.pending()); prepared = true; });
gate.context.finish();
assert(gate.pending(), "waits for layout frame");
gate.frames.shift()();
assert(prepared);
assert(!gate.pending());
assert.equal(gate.timers.size, 0);
gate.context.sync();
assert(!gate.pending(), "does not gate later pagination");

const disabled = makeGate(false);
assert(!disabled.pending(), "disabled mode stays visible");
const toggled = makeGate();
toggled.disable();
assert(!toggled.pending(), "disabling releases immediately");
const timedOut = makeGate();
timedOut.timers.get(60000)();
assert(!timedOut.pending(), "bounded timeout releases even before first cards");
const changedRoute = makeGate();
changedRoute.context.location.pathname = "/new";
changedRoute.context.sync();
assert(!changedRoute.pending());
const disconnected = makeGate();
disconnected.feed.isConnected = false;
disconnected.context.sync();
assert(!disconnected.pending());
const restoredPage = makeGate();
restoredPage.listeners.pageshow({ persisted: false });
assert(restoredPage.pending(), "normal pageshow does not reveal partial batch");
restoredPage.listeners.pageshow({ persisted: true });
assert(!restoredPage.pending(), "restored page cannot remain gated");
const failedLayout = makeGate();
failedLayout.context.prepare(() => { throw Error("layout failed"); });
failedLayout.context.finish();
assert.throws(() => failedLayout.frames.shift()(), /layout failed/);
assert(!failedLayout.pending(), "layout exception cannot leave feed hidden");
console.log("OK: early one-shot gate, layout preparation, timeout, disable, route change, and exception cleanup");
