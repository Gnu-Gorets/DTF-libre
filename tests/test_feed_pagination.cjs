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
let cleared = 0;
const target = {
  style: {
    transform: "",
    getPropertyValue: () => "",
    getPropertyPriority: () => "",
    setProperty(name, value) {
      this[name] = value;
    },
  },
  getBoundingClientRect: () => ({ top, bottom: top + 1 }),
};
const list = {
  querySelector: () => (collapsed ? {} : null),
  querySelectorAll: () => Array(postCount).fill(null),
};
const loader = {
  style: { display: "none" },
  parentElement: target,
  closest: () => list,
};
const context = {
  document: { querySelector: () => loader },
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
    observe() {}
    disconnect() {}
  },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nfeedLoaderObserver = { observe() {}, disconnect() {} }; globalThis.wake = wakeCollapsedFeed;`,
  context,
);
context.wake();
assert.equal(target.style.transform, "translateY(600vh)");
exitObserver.callback([{ isIntersecting: true }]);
assert.equal(
  target.style.transform,
  "translateY(600vh)",
  "stay outside until exit",
);
exitObserver.callback([{ isIntersecting: false }]);
assert.equal(
  target.style.transform,
  "",
  "restore as soon as observer confirms exit",
);
assert.equal(cleared, 1, "cancel fallback after observer callback");
context.wake();
assert.equal(target.style.transform, "", "only once per batch");
postCount = 24;
context.wake();
assert.equal(
  target.style.transform,
  "translateY(600vh)",
  "retry when new posts arrive",
);
pending();
assert.equal(
  target.style.transform,
  "",
  "fallback restores when callback is missing",
);
postCount = 36;
loader.style.display = "block";
context.wake();
assert.equal(target.style.transform, "", "never wake during loading");
loader.style.display = "none";
top = 7000;
context.wake();
assert.equal(target.style.transform, "", "never wake outside observer range");
top = 1100;
collapsed = false;
context.wake();
assert.equal(target.style.transform, "", "never wake without collapsed posts");
console.log("OK: collapsed feed intersection retry");
