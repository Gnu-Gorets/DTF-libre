const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const resetFeedScrollOnReload =");
const end = source.indexOf("  const setPhotoSwipeZoomLevels =", start);
assert(start > 0 && end > start);

const makePage = (pathname, navigationType) => {
  const listeners = {};
  const scrollCalls = [];
  const page = {
    location: { pathname },
    performance: {
      getEntriesByType: () => [{ type: navigationType }],
    },
    history: { scrollRestoration: "auto" },
    addEventListener(name, callback, options) {
      listeners[name] = { callback, options };
    },
    scrollTo(...args) {
      scrollCalls.push(args);
    },
  };
  vm.runInNewContext(source.slice(start, end), { page });
  return { page, listeners, scrollCalls };
};

const reloadedFeed = makePage("/", "reload");
assert.equal(reloadedFeed.page.history.scrollRestoration, "manual");
assert.equal(reloadedFeed.listeners.pageshow.options.once, true);
reloadedFeed.listeners.pageshow.callback();
assert.deepEqual(reloadedFeed.scrollCalls, [[0, 0]]);
assert.equal(reloadedFeed.page.history.scrollRestoration, "manual");
assert.equal(reloadedFeed.listeners.pagehide.options.once, true);
reloadedFeed.listeners.pagehide.callback();
assert.equal(reloadedFeed.page.history.scrollRestoration, "auto");

const reloadedNewFeed = makePage("/new/", "reload");
assert.equal(reloadedNewFeed.page.history.scrollRestoration, "manual");
assert.equal(reloadedNewFeed.listeners.pageshow.options.once, true);

const navigatedFeed = makePage("/", "navigate");
assert.equal(navigatedFeed.page.history.scrollRestoration, "auto");
assert.equal(navigatedFeed.listeners.pageshow, undefined);
assert.deepEqual(navigatedFeed.scrollCalls, []);

const reloadedMyFeed = makePage("/my", "reload");
assert.equal(reloadedMyFeed.page.history.scrollRestoration, "auto");
assert.equal(reloadedMyFeed.listeners.pageshow, undefined);

const reloadedPost = makePage("/post/123", "reload");
assert.equal(reloadedPost.page.history.scrollRestoration, "auto");
assert.equal(reloadedPost.listeners.pageshow, undefined);
console.log("OK: refresh resets public feed scroll; other navigation is untouched");
