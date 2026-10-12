const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const loadExtraFeedPosts = async () => {");
const end = source.indexOf("  const postIdForCard =", start);
assert(start > 0 && end > start);

async function run({ enabled, multiplier, initialCount = 24 }) {
  let count = initialCount;
  let scrollY = 0;
  let pagesLoaded = 0;
  const page = {
    innerHeight: 800,
    get scrollY() {
      return scrollY;
    },
    scrollTo(x, y) {
      const target = typeof x === "object" ? x.top : y;
      scrollY = target === 0 ? 0 : 10000;
    },
  };
  const context = {
    page,
    get: (key, fallback) =>
      ({ feedExtraPosts: enabled, feedPostMultiplier: multiplier })[key] ??
      fallback,
    document: {
      documentElement: { scrollHeight: 10000 },
      querySelector: (selector) =>
        selector === ".feed-page" ? {} : null,
      querySelectorAll: () => ({ length: count }),
    },
    Date,
    setTimeout: (callback) => {
      if (scrollY === 10000) {
        count += 12;
        pagesLoaded++;
      }
      callback();
      return 1;
    },
  };
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.run = loadExtraFeedPosts;`,
    context,
  );
  await context.run();
  return { count, pagesLoaded, scrollY };
}

(async () => {
  assert.deepEqual(await run({ enabled: false, multiplier: 2 }), {
    count: 24,
    pagesLoaded: 0,
    scrollY: 0,
  });
  assert.deepEqual(await run({ enabled: true, multiplier: 2 }), {
    count: 48,
    pagesLoaded: 2,
    scrollY: 0,
  });
  assert.deepEqual(await run({ enabled: true, multiplier: 3 }), {
    count: 72,
    pagesLoaded: 4,
    scrollY: 0,
  });
  assert.deepEqual(await run({ enabled: true, multiplier: 99 }), {
    count: 72,
    pagesLoaded: 4,
    scrollY: 0,
  });
  console.log("OK: optional feed auto-loading multiplier");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
