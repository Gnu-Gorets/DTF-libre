const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const setPhotoSwipeZoomLevels =");
const end = source.indexOf("  let plusWasEnabled =", start);
assert(start > 0 && end > start);

const rafCallbacks = [];
const page = {
  innerWidth: 1920,
  innerHeight: 1080,
  requestAnimationFrame: (callback) => rafCallbacks.push(callback),
};
const context = { page };
vm.runInNewContext(source.slice(start, end), context);
assert.equal(typeof Object.getOwnPropertyDescriptor(page, "pswp").set, "function");

const events = {};
let zoomAtInit;
const pswp = {
  on(name, callback) {
    events[name] = callback;
  },
  init() {
    zoomAtInit = levels.initial;
  },
};
page.pswp = pswp;
assert.equal(Object.getOwnPropertyDescriptor(page, "pswp").value, pswp);
const levels = { initial: 1, secondary: 1, max: 4 };
events.zoomLevelsUpdate({
  zoomLevels: levels,
  slideData: { width: 672, height: 523 },
});
const expected = Math.min(4, (1920 * 0.9) / 672, (1080 * 0.9) / 523);
assert.ok(Math.abs(levels.initial - expected) < 0.001);
pswp.init();
assert.equal(zoomAtInit, expected, "native open starts at final zoom");
assert.ok(levels.secondary > levels.initial);

const largeLevels = { initial: 0.6, secondary: 1, max: 4 };
events.zoomLevelsUpdate({
  zoomLevels: largeLevels,
  slideData: { width: 3000, height: 2000 },
});
assert.equal(largeLevels.initial, 1, "large images open at least at 1:1");

events.destroy();
delete page.pswp;
assert.equal(rafCallbacks.length, 1);
rafCallbacks.shift()();
assert.equal(typeof Object.getOwnPropertyDescriptor(page, "pswp").set, "function");
console.log("OK: PhotoSwipe uses final zoom during its native opening animation");
