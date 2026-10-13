const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const placeLoaderInViewport =");
const end = source.indexOf("  const loadExtraFeedPosts =", start);
assert(start > 0 && end > start);

function makeTrigger({ empty = false, error = "" } = {}) {
  const properties = new Map(empty ? [] : [
    ["translate", ["0 17px", "important"]],
    ["transition", ["all 0.2s", "important"]],
    ["transform", ["scale(1)", ""]],
    ["position", ["relative", ""]],
  ]);
  const original = [...properties];
  const timers = new Map();
  let observer;
  let top = 2000;
  const target = {
    getBoundingClientRect() {
      if (error === "geometry" && observer?.disconnected) throw Error("geometry failed");
      const offset = Number.parseFloat(properties.get("translate")?.[0].split(" ")[1]) || 0;
      return { top: top + offset, bottom: top + offset + 1 };
    },
    style: {
      getPropertyValue: name => properties.get(name)?.[0] || "",
      getPropertyPriority: name => properties.get(name)?.[1] || "",
      setProperty: (name, value, priority = "") => properties.set(name, [value, priority]),
      removeProperty: name => properties.delete(name),
    },
  };
  const context = {
    window: { innerHeight: 1000 },
    IntersectionObserver: class {
      constructor(callback, options) {
        if (error === "constructor") throw Error("constructor failed");
        assert.equal(options.rootMargin, "200% 0px");
        this.callback = callback;
        observer = this;
      }
      observe(element) {
        assert.equal(element, target);
        assert.ok(element.getBoundingClientRect().bottom < -2000);
        if (error === "observe") throw Error("observe failed");
      }
      disconnect() { this.disconnected = true; }
    },
    setTimeout(callback, delay) { assert.equal(delay, 500); timers.set(1, callback); return 1; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.run = placeLoaderInViewport;`, context);
  return {
    run: () => context.run({ parentElement: target }),
    runWithoutLoader: () => context.run(null),
    target, timers,
    exit: () => observer.callback([{ isIntersecting: false }]),
    stayInside: () => observer.callback([{ isIntersecting: true }]),
    moveLayout: () => { top += 500; },
    assertRestored() { assert.deepEqual([...properties], original); },
    assertCleaned() { assert(observer.disconnected); assert.equal(timers.size, 0); },
  };
}

(async () => {
  for (const empty of [false, true]) {
    const trigger = makeTrigger({ empty });
    const pending = trigger.run();
    let finished = false;
    pending.then(() => { finished = true; });
    trigger.stayInside();
    await Promise.resolve();
    assert.equal(finished, false, "waits for confirmed exit, not any observer callback");
    trigger.moveLayout();
    trigger.exit();
    const restore = await pending;
    const rect = trigger.target.getBoundingClientRect();
    assert.ok(Math.abs((rect.top + rect.bottom) / 2 - 500) <= 0.5,
      "recomputes geometry after exit before placing loader inside");
    trigger.assertCleaned();
    restore();
    trigger.assertRestored();
  }

  const timedOut = makeTrigger();
  const pendingTimeout = timedOut.run();
  timedOut.timers.get(1)();
  const timeoutRestore = await pendingTimeout;
  timedOut.assertRestored();
  timedOut.assertCleaned();
  timeoutRestore();
  timedOut.assertRestored();

  for (const error of ["constructor", "observe", "geometry"]) {
    const trigger = makeTrigger({ error });
    const pending = trigger.run();
    if (error === "geometry") trigger.exit();
    await assert.rejects(pending, new RegExp(`${error} failed`));
    trigger.assertRestored();
    assert.equal(trigger.timers.size, 0, "exception cannot leave watchdog active");
    if (error !== "constructor") trigger.assertCleaned();
  }

  const missing = makeTrigger();
  (await missing.runWithoutLoader())();
  missing.assertRestored();
  assert.equal(missing.timers.size, 0);
  console.log("OK: loader exit confirmation, fresh geometry, styles/priorities, timeout, missing loader, and exception cleanup");
})().catch(error => { console.error(error); process.exitCode = 1; });
