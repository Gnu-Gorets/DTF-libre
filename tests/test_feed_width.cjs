const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const feedMetrics =");
const end = source.indexOf("\n  const style =", start);
assert(start >= 0 && end > start);
const context = {};
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.metrics = feedMetrics;`,
  context,
);
const desktop = context.metrics(1600, 80, 220, 320);
assert(Math.abs(desktop.feed - (1600 - 32 - 220 - 320) * 0.8) < 1e-9);
assert.equal(desktop.layout, 220 + 320 + desktop.feed);
assert.equal(
  context.metrics(900, 100).feed,
  868,
  "mobile viewport has no desktop sidebars",
);
assert(
  source.includes('name="width" type="range" min="50" max="100" step="5"'),
  "feed width slider range and step",
);
assert(
  source.includes("Работает при ширине окна от 925 px."),
  "feed width setting explains its minimum viewport",
);
assert(
  source.includes(".layout:has(.view)"),
  "all DTF views receive computed width",
);
assert(
  source.includes("html.dtf-vm-stretch-right .layout:has(.view)"),
  "all views honor right-sidebar stretch",
);
console.log("OK: feed width across desktop/mobile and search layouts");
