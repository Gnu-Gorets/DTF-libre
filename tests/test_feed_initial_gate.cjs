const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let initialFeedPending =");
const end = source.indexOf("  let feedInitialPostCount =", start);
assert(start > 0 && end > start);
assert.match(source, /const primeLayout =[\s\S]*?syncInitialFeedGate\(\)/);
assert(!source.includes("prepareInitialFeed"), "no extra layout pass before showing cards");

function makeGate(enabled = true) {
  const classes = new Set();
  const timers = new Map();
  const listeners = {};
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
  };
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.sync = syncInitialFeedGate;
    globalThis.finish = releaseInitialFeed;`, context);
  context.sync();
  return {
    context, feed, timers, listeners,
    pending: () => classes.has("dtf-vm-feed-pending"),
    disable() { enabled = false; context.sync(); },
  };
}

const gate = makeGate();
assert(gate.pending(), "scrollbar suppression begins before cards arrive");
gate.context.finish();
assert(!gate.pending(), "completion restores scrollbar immediately");
assert.equal(gate.timers.size, 0);
gate.context.sync();
assert(!gate.pending(), "does not suppress scrollbar during later pagination");

const disabled = makeGate(false);
assert(!disabled.pending(), "disabled mode stays native");
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
assert(restoredPage.pending(), "normal pageshow keeps pending scrollbar transparent");
restoredPage.listeners.pageshow({ persisted: true });
assert(!restoredPage.pending(), "restored page cannot retain suppression");
console.log("OK: scrollbar-only lifecycle, immediate release, timeout, disable, route change, and BFCache cleanup");
