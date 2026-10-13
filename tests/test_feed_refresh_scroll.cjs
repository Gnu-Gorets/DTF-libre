const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const resetScrollOnReload =");
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
  vm.runInNewContext(source.slice(start, end), { page, get: () => true });
  return { page, listeners, scrollCalls };
};

const reloadedFeed = makePage("/", "reload");
assert.equal(reloadedFeed.page.history.scrollRestoration, "manual");
assert.equal(reloadedFeed.listeners.pageshow, undefined);
assert.deepEqual(reloadedFeed.scrollCalls, []);
assert.equal(reloadedFeed.listeners.pagehide.options.once, true);
reloadedFeed.listeners.pagehide.callback();
assert.equal(reloadedFeed.page.history.scrollRestoration, "auto");

const reloadedNewFeed = makePage("/new/", "reload");
assert.equal(reloadedNewFeed.page.history.scrollRestoration, "manual");
assert.equal(reloadedNewFeed.listeners.pageshow, undefined);

const navigatedFeed = makePage("/", "navigate");
assert.equal(navigatedFeed.page.history.scrollRestoration, "auto");
assert.equal(navigatedFeed.listeners.pageshow, undefined);
assert.deepEqual(navigatedFeed.scrollCalls, []);

const reloadedMyFeed = makePage("/my", "reload");
assert.equal(reloadedMyFeed.page.history.scrollRestoration, "manual");
assert.equal(reloadedMyFeed.listeners.pageshow, undefined);

const reloadedPost = makePage("/post/123", "reload");
assert.equal(reloadedPost.page.history.scrollRestoration, "manual");
assert.equal(reloadedPost.listeners.pageshow, undefined);
assert.deepEqual(reloadedPost.scrollCalls, []);

const reloadedProfile = makePage("/user/123", "reload");
assert.equal(reloadedProfile.page.history.scrollRestoration, "manual");
assert.equal(reloadedProfile.listeners.pageshow, undefined);

const backNavigation = makePage("/", "back_forward");
assert.equal(backNavigation.page.history.scrollRestoration, "auto");
assert.equal(backNavigation.listeners.pageshow, undefined);
console.log("OK: reload disables late scroll restoration without forced scroll; other navigation is untouched");
