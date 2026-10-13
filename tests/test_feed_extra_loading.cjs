const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  let feedInitialPostCount = null;");
const end = source.indexOf("  const postIdForCard =", start);
assert(start > 0 && end > start);
assert.match(
  source,
  /page\.addEventListener\(\s*"DOMContentLoaded",\s*\(\)\s*=>\s*void loadExtraFeedPosts\(\),/,
  "ignore the DOMContentLoaded event instead of using it as the target",
);
assert.match(
  source,
  /\.feed-page\.dtf-vm-feed-loading \.content-list__loader/,
  "keep the native loader observable while visually hiding it",
);

async function createFeed({
  enabled,
  multiplier,
  initialCount = 24,
  triggerDelay = 150,
  loaderHideDelay = 300,
  responseDelay = 0,
  showLoader = true,
  succeeds = true,
  initialScrollTop = 0,
  lateInitialCount = 0,
  lateInitialAt = 150,
  changeMultiplierAfterPage = null,
}) {
  const cards = [];
  const mutationObservers = [];
  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      mutationObservers.push(this);
    }
    observe() {
      this.active = true;
    }
    disconnect() {
      this.active = false;
    }
  }
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
  let initialFinishes = 0;
  let scrollTop = initialScrollTop;
  let scrollWrites = 0;
  let now = 0;
  let triggerWaits = 0;
  let requestStarted = false;
  let requestStartedAt = 0;
  let responseDone = false;
  let loaderHiddenAt = 0;
  let scrolledWhileLoaderVisible = false;
  let lateInitialAdded = false;
  let wasLoaderTranslated = false;
  let loaderTakenOutOfFlow = false;
  const scrollListeners = {};
  const wrapperProperties = new Map([
    ["position", { value: "absolute", priority: "" }],
  ]);
  const loaderWrapper = {
    getBoundingClientRect: () => ({ top: 2000, bottom: 2001 }),
    style: {
      getPropertyValue: (name) => wrapperProperties.get(name)?.value || "",
      getPropertyPriority: (name) => wrapperProperties.get(name)?.priority || "",
      setProperty(name, value, priority = "") {
        wrapperProperties.set(name, { value, priority });
      },
      removeProperty(name) {
        wrapperProperties.delete(name);
      },
    },
  };
  const loader = { style: { display: "none" }, parentElement: loaderWrapper };
  const feedClasses = new Set();
  const feed = {
    isConnected: true,
    classList: {
      add: (name) => feedClasses.add(name),
      remove: (name) => feedClasses.delete(name),
      contains: (name) => feedClasses.has(name),
    },
    querySelector: () => loader,
  };
  const document = {
    documentElement: { scrollHeight: 10000 },
    scrollingElement: {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value) {
        scrollWrites++;
        scrollTop = value;
        if (value >= document.documentElement.scrollHeight)
          scrolledWhileLoaderVisible ||= loader.style.display !== "none";
      },
    },
    body: {},
    querySelector: (selector) => (selector === ".feed-page" ? feed : null),
    querySelectorAll: () => cards,
  };
  const settings = { feedExtraPosts: enabled, feedPostMultiplier: multiplier };
  const context = {
    document,
    settings,
    wakeRestore: null,
    syncInitialFeedGate: () => {},
    finishInitialFeed: () => { initialFinishes++; },
    window: {
      innerHeight: 1000,
      addEventListener: (name, callback) => {
        scrollListeners[name] = callback;
      },
    },
    MutationObserver: MockMutationObserver,
    clearTimeout: () => {},
    get: (key, fallback) => settings[key] ?? fallback,
    setTimeout: (callback, delay) => {
      now += delay;
      if (!lateInitialAdded && lateInitialCount && now >= lateInitialAt) {
        for (let i = 0; i < lateInitialCount; i++) cards.push(makeCard());
        lateInitialAdded = true;
      }
      if (responseDone && now >= loaderHiddenAt)
        loader.style.display = "none";
      const loaderTranslated =
        loaderWrapper.style.getPropertyValue("translate") !== "";
      loaderTakenOutOfFlow ||=
        loaderWrapper.style.getPropertyValue("position") === "fixed";
      if (loaderTranslated && !wasLoaderTranslated && responseDone) {
        triggerWaits = 0;
        requestStarted = false;
        responseDone = false;
      }
      wasLoaderTranslated = loaderTranslated;
      if (loaderTranslated && !requestStarted) {
        triggerWaits += delay;
        if (triggerWaits >= triggerDelay) {
          loader.style.display = showLoader ? "block" : "none";
          requestStarted = true;
          requestStartedAt = now;
        }
      } else if (
        scrollTop < document.documentElement.scrollHeight &&
        requestStarted &&
        !responseDone &&
        now - requestStartedAt >= responseDelay
      ) {
        responseDone = true;
        loaderHiddenAt = now + loaderHideDelay;
        if (succeeds) {
          for (let i = 0; i < 12; i++) cards.push(makeCard());
          pagesLoaded++;
          if (changeMultiplierAfterPage?.page === pagesLoaded) {
            settings.feedPostMultiplier = changeMultiplierAfterPage.multiplier;
            context.markSliderChange();
          }
        }
      }
      callback();
      return 1;
    },
    Date: { now: () => now },
  };
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.run = loadExtraFeedPosts; globalThis.sync = syncFeedPostVisibility; globalThis.markSliderChange = () => { feedVisibilityNeedsSync = true; syncFeedPostVisibility(); };`,
    context,
  );
  return {
    cards,
    settings,
    context,
    pagesLoaded: () => pagesLoaded,
    initialFinishes: () => initialFinishes,
    scrollTop: () => scrollTop,
    triggerWaits: () => triggerWaits,
    scrolledWhileLoaderVisible: () => scrolledWhileLoaderVisible,
    scrollWrites: () => scrollWrites,
    loaderPosition: () => loaderWrapper.style.getPropertyValue("position"),
    loaderTranslate: () => loaderWrapper.style.getPropertyValue("translate"),
    loaderTakenOutOfFlow: () => loaderTakenOutOfFlow,
    feedLoading: () => feedClasses.has("dtf-vm-feed-loading"),
    elapsed: () => now,
    reachEnd() {
      scrollTop = document.documentElement.scrollHeight - 500;
      scrollListeners.scroll?.();
    },
    scrollAway() {
      scrollTop = 0;
      scrollListeners.scroll?.();
    },
    addInitialPosts(count) {
      for (let i = 0; i < count; i++) cards.push(makeCard());
      mutationObservers
        .filter((observer) => observer.active)
        .forEach((observer) => observer.callback());
    },
  };
}

(async () => {
  const feed = await createFeed({ enabled: true, multiplier: 2 });
  await feed.context.run();
  assert.equal(feed.cards.length, 48, "loads to 2x baseline");
  assert.equal(feed.pagesLoaded(), 2);
  assert.equal(feed.initialFinishes(), 1, "reveals completed initial batch");
  assert.ok(feed.triggerWaits() >= 150, "waits for delayed loader trigger");
  assert.equal(
    feed.scrolledWhileLoaderVisible(),
    false,
    "waits for previous loader to hide before retriggering",
  );
  assert.equal(feed.scrollTop(), 0, "keeps initial top position");
  assert.equal(feed.scrollWrites(), 0, "never scrolls page to trigger native loader");
  assert.equal(feed.loaderPosition(), "absolute", "keeps loader in document flow");
  assert.equal(feed.loaderTranslate(), "", "restores temporary loader translation");
  assert.equal(feed.loaderTakenOutOfFlow(), false, "never removes loader from flow");
  assert.equal(feed.feedLoading(), false, "removes temporary feed loading class");
  assert.equal(feed.elapsed(), 950, "detects each response within 50 ms instead of 100 ms");

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
  assert.equal(feed.initialFinishes(), 1, "later slider changes do not repeat gate");

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

  const lateBaselineFeed = await createFeed({
    enabled: true,
    multiplier: 2,
    lateInitialCount: 12,
  });
  await lateBaselineFeed.context.run();
  assert.equal(
    lateBaselineFeed.cards.length,
    72,
    "late initial posts are included in the baseline before applying 2x",
  );
  assert.equal(lateBaselineFeed.pagesLoaded(), 3);

  const lateAfterBaselineFeed = await createFeed({
    enabled: true,
    multiplier: 2,
    lateInitialCount: 36,
    lateInitialAt: 500,
  });
  await lateAfterBaselineFeed.context.run();
  assert.equal(lateAfterBaselineFeed.cards.length, 72);
  assert.equal(
    lateAfterBaselineFeed.cards.filter((card) =>
      card.classList.contains("dtf-vm-feed-post-hidden"),
    ).length,
    0,
    "does not hide late DTF posts when selected multiplier is unchanged",
  );

  const lateFeed = await createFeed({
    enabled: true,
    multiplier: 3,
    initialCount: 0,
  });
  await lateFeed.context.run();
  assert.equal(lateFeed.cards.length, 0, "waits for initial feed response");
  lateFeed.addInitialPosts(24);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateFeed.cards.length, 72, "loads after initial cards arrive");
  assert.equal(lateFeed.pagesLoaded(), 4);
  assert.equal(lateFeed.elapsed(), 1950,
    "starts baseline stabilization immediately when initial cards arrive");

  const increasedWhileLoading = await createFeed({
    enabled: true,
    multiplier: 2,
    changeMultiplierAfterPage: { page: 1, multiplier: 3 },
  });
  await increasedWhileLoading.context.run();
  assert.equal(increasedWhileLoading.cards.length, 72);
  assert.equal(increasedWhileLoading.pagesLoaded(), 4);

  const decreasedWhileLoading = await createFeed({
    enabled: true,
    multiplier: 3,
    changeMultiplierAfterPage: { page: 2, multiplier: 2 },
  });
  await decreasedWhileLoading.context.run();
  assert.equal(decreasedWhileLoading.cards.length, 48);
  assert.equal(decreasedWhileLoading.pagesLoaded(), 2);
  assert.equal(
    decreasedWhileLoading.cards.filter((card) =>
      card.classList.contains("dtf-vm-feed-post-hidden"),
    ).length,
    0,
    "does not load then hide a page beyond the current slider target",
  );

  const bottomFeed = await createFeed({ enabled: true, multiplier: 2 });
  await bottomFeed.context.run();
  const beforeBottom = bottomFeed.cards.length;
  bottomFeed.reachEnd();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    bottomFeed.cards.length,
    beforeBottom + 24,
    "loads two pages when reaching the end",
  );
  assert.equal(bottomFeed.pagesLoaded(), 4);
  assert.equal(
    bottomFeed.cards.filter((card) =>
      card.classList.contains("dtf-vm-feed-post-hidden"),
    ).length,
    0,
    "keeps posts from doubled bottom load visible",
  );
  bottomFeed.scrollAway();
  bottomFeed.reachEnd();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bottomFeed.pagesLoaded(), 6, "rearms after leaving the end");

  const disabledFeed = await createFeed({ enabled: false, multiplier: 2 });
  await disabledFeed.context.run();
  disabledFeed.reachEnd();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disabledFeed.pagesLoaded(), 0, "disabled setting stays native");
  assert.equal(disabledFeed.initialFinishes(), 0);

  const stableFeed = await createFeed({
    enabled: true,
    multiplier: 2,
    initialScrollTop: 1800,
  });
  await stableFeed.context.run();
  assert.equal(
    stableFeed.scrollTop(),
    1800,
    "extra loading preserves the user's current scroll",
  );
  assert.equal(stableFeed.scrollWrites(), 0, "loading never moves the viewport");

  const failedFeed = await createFeed({
    enabled: true,
    multiplier: 2,
    succeeds: false,
  });
  await failedFeed.context.run();
  assert.equal(failedFeed.scrollTop(), 0, "restores scroll when request fails");

  const hiddenLoaderFeed = await createFeed({
    enabled: true,
    multiplier: 3,
    responseDelay: 4000,
    showLoader: false,
  });
  await hiddenLoaderFeed.context.run();
  assert.equal(hiddenLoaderFeed.cards.length, 72,
    "reaches 3x even when loader stays hidden and responses arrive after trigger timeout");
  assert.equal(hiddenLoaderFeed.pagesLoaded(), 4);
  assert.equal(hiddenLoaderFeed.feedLoading(), false);
  assert.equal(hiddenLoaderFeed.scrollWrites(), 0);
  assert.equal(hiddenLoaderFeed.loaderTranslate(), "");

  const stalledTrigger = await createFeed({
    enabled: true,
    multiplier: 2,
    triggerDelay: Infinity,
  });
  await stalledTrigger.context.run();
  assert.equal(stalledTrigger.elapsed(), 18250,
    "bounds waiting even when loader state cannot confirm request start");
  assert.equal(stalledTrigger.feedLoading(), false);
  assert.equal(stalledTrigger.loaderTranslate(), "");
  assert.equal(failedFeed.pagesLoaded(), 0, "stops after failed pagination");
  assert.equal(failedFeed.initialFinishes(), 1, "reveals available cards after failed pagination");
  assert.equal(stalledTrigger.initialFinishes(), 1, "reveals after bounded request wait");
  console.log("OK: live multiplier, native loading, and late-feed stability");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
