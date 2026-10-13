const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let feedLoaderObserver = null;");
const end = source.indexOf("  const postIdForCard =", start);
assert(start > 0 && end > start);
let postCount = 12;
let collapsed = true;
let top = 1100;
let pending;
let exitObserver;
let observedTarget;
let cleared = 0;
const parent = {
  style: { transform: "" },
};
const list = {
  querySelector: () => (collapsed ? {} : null),
  querySelectorAll: () => Array(postCount).fill(null),
};
const loader = {
  style: {
    display: "none",
    transform: "translateY(10px)",
    getPropertyValue(name) {
      return this[name] || "";
    },
    getPropertyPriority: () => "",
    setProperty(name, value) {
      this[name] = value;
    },
  },
  parentElement: parent,
  getBoundingClientRect: () => ({ top, bottom: top + 1 }),
  closest: () => list,
};
const context = {
  document: { querySelector: () => loader },
  window: { addEventListener() {} },
  innerHeight: 1133,
  setTimeout: (callback) => {
    pending = callback;
    return 1;
  },
  clearTimeout: () => {
    cleared++;
  },
  IntersectionObserver: class {
    constructor(callback) {
      this.callback = callback;
      exitObserver = this;
    }
    observe(target) {
      observedTarget = target;
    }
    disconnect() {}
  },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nfeedLoaderObserver = { observe() {}, disconnect() {} }; globalThis.wake = wakeCollapsedFeed;`,
  context,
);
context.wake();
assert.equal(loader.style.transform, "translateY(600vh)");
assert.equal(parent.style.transform, "", "never move visible feed parent");
assert.equal(observedTarget, loader, "observe only invisible loader sentinel");
exitObserver.callback([{ isIntersecting: true }]);
assert.equal(
  loader.style.transform,
  "translateY(600vh)",
  "stay outside until observer confirms exit",
);
exitObserver.callback([{ isIntersecting: false }]);
assert.equal(
  loader.style.transform,
  "translateY(10px)",
  "restore previous loader transform when observer confirms exit",
);
assert.equal(cleared, 1, "cancel fallback after observer callback");
context.wake();
assert.equal(loader.style.transform, "translateY(10px)", "only once per batch");
postCount = 24;
context.wake();
assert.equal(loader.style.transform, "translateY(600vh)", "retry for new posts");
pending();
assert.equal(
  loader.style.transform,
  "translateY(10px)",
  "fallback restores when callback is missing",
);
assert.equal(parent.style.transform, "", "parent stays in place through restore");
postCount = 36;
loader.style.display = "block";
context.wake();
assert.equal(loader.style.transform, "translateY(10px)", "never wake during loading");
loader.style.display = "none";
top = 7000;
context.wake();
assert.equal(loader.style.transform, "translateY(10px)", "never wake outside observer range");
top = 1100;
collapsed = false;
context.wake();
assert.equal(loader.style.transform, "translateY(10px)", "never wake without collapsed posts");
console.log("OK: collapsed feed retries pagination without moving visible posts");
