const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let feedInitialPostCount = null;");
const end = source.indexOf("  const postIdForCard =", start);
assert(start > 0 && end > start);

async function createFeed({
  enabled,
  multiplier,
  initialCount = 24,
  triggerDelay = 150,
  succeeds = true,
}) {
  const cards = [];
  const makeCard = () => {
    const classes = new Set();
    return {
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        contains: (name) => classes.has(name),
      },
    };
  };
  for (let i = 0; i < initialCount; i++) cards.push(makeCard());
  let pagesLoaded = 0;
  let scrollTop = 0;
  let now = 0;
  let triggerWaits = 0;
  let requestStarted = false;
  let responseDone = false;
  const loader = { style: { display: "none" } };
  const feed = {
    isConnected: true,
    querySelector: () => loader,
  };
  const document = {
    documentElement: { scrollHeight: 10000 },
    scrollingElement: {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value) {
        scrollTop = value;
        if (value > 0) {
          triggerWaits = 0;
          requestStarted = false;
          responseDone = false;
          loader.style.display = "none";
        }
      },
    },
    querySelector: (selector) => (selector === ".feed-page" ? feed : null),
    querySelectorAll: () => cards,
  };
  const settings = { feedExtraPosts: enabled, feedPostMultiplier: multiplier };
  const context = {
    document,
    settings,
    get: (key, fallback) => settings[key] ?? fallback,
    setTimeout: (callback, delay) => {
      now += delay;
      if (scrollTop > 0 && !requestStarted) {
        triggerWaits += delay;
        if (triggerWaits >= triggerDelay) {
          loader.style.display = "block";
          requestStarted = true;
        }
      } else if (scrollTop === 0 && requestStarted && !responseDone) {
        responseDone = true;
        loader.style.display = "none";
        if (succeeds) {
          for (let i = 0; i < 12; i++) cards.push(makeCard());
          pagesLoaded++;
        }
      }
      callback();
      return 1;
    },
    Date: { now: () => now },
  };
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.run = loadExtraFeedPosts; globalThis.sync = syncFeedPostVisibility;`,
    context,
  );
  return {
    cards,
    settings,
    context,
    pagesLoaded: () => pagesLoaded,
    scrollTop: () => scrollTop,
    triggerWaits: () => triggerWaits,
  };
}

(async () => {
  const feed = await createFeed({ enabled: true, multiplier: 2 });
  await feed.context.run();
  assert.equal(feed.cards.length, 48, "loads to 2x baseline");
  assert.equal(feed.pagesLoaded(), 2);
  assert.ok(feed.triggerWaits() >= 150, "waits for delayed loader trigger");
  assert.equal(feed.scrollTop(), 0, "restores page scroll");

  feed.settings.feedPostMultiplier = 3;
  feed.context.sync();
  await feed.context.run();
  assert.equal(feed.cards.length, 72, "slider increase loads to 3x baseline");
  assert.equal(feed.pagesLoaded(), 4);

  feed.settings.feedPostMultiplier = 2;
  feed.context.sync();
  assert.equal(
    feed.cards.filter((card) =>
      card.classList.contains("dtf-vm-feed-post-hidden"),
    ).length,
    24,
    "slider decrease hides excess loaded posts",
  );
  await feed.context.run();
  assert.equal(feed.pagesLoaded(), 4, "does not fetch more when decreasing");

  feed.settings.feedPostMultiplier = 3;
  feed.context.sync();
  assert.equal(
    feed.cards.filter((card) =>
      card.classList.contains("dtf-vm-feed-post-hidden"),
    ).length,
    0,
    "slider increase reveals previously hidden posts",
  );

  feed.settings.feedExtraPosts = false;
  feed.context.sync();
  assert.equal(
    feed.cards.filter((card) =>
      card.classList.contains("dtf-vm-feed-post-hidden"),
    ).length,
    0,
    "disabling extra loading shows all loaded posts",
  );

  const failedFeed = await createFeed({
    enabled: true,
    multiplier: 2,
    succeeds: false,
  });
  await failedFeed.context.run();
  assert.equal(failedFeed.scrollTop(), 0, "restores scroll when request fails");
  assert.equal(failedFeed.pagesLoaded(), 0, "stops after failed pagination");
  console.log("OK: delayed feed trigger, live multiplier, and timeout restoration");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
