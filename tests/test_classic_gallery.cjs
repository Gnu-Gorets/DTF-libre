const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("    const syncClassicGalleries =");
const end = source.indexOf("\n\n    const syncVideos =", start);
assert(start > 0 && end > start);
const gallery = (count) => ({
  children: Array.from({ length: count }, () => ({ dataset: {} })),
});
const galleries = [gallery(4), gallery(5), gallery(7), gallery(10)];
const context = {
  document: {
    querySelectorAll: () => galleries,
  },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.syncClassicGalleries = syncClassicGalleries;`,
  context,
);
context.syncClassicGalleries(true, 4);
assert.equal(galleries[0].children[3].dataset.dtfGalleryMore, undefined);
assert.equal(galleries[1].children[4].dataset.dtfGalleryMore, "+1");
assert.equal(galleries[2].children[4].dataset.dtfGalleryMore, "+3");
assert.equal(galleries[2].children[5].dataset.dtfGalleryHidden, "");
context.syncClassicGalleries(true, 8);
assert.equal(galleries[2].children[6].dataset.dtfGalleryMore, undefined);
assert.equal(galleries[3].children[8].dataset.dtfGalleryMore, "+2");
assert.equal(galleries[3].children[9].dataset.dtfGalleryHidden, "");
context.syncClassicGalleries(false, 8);
assert.equal(galleries[3].children[8].dataset.dtfGalleryMore, undefined);
assert.equal(galleries[3].children[9].dataset.dtfGalleryHidden, undefined);
assert.match(
  source,
  /name="galleryPreviewCount" type="range" min="4" max="8" step="1"/,
);
assert.match(
  source,
  /display: flex !important; flex-wrap: wrap; justify-content: center; gap: 2px/,
);
assert.match(source, /flex: 0 0 calc\(\(100% - 4px\) \/ 3\)/);
assert.match(source, /height: 100% !important; object-fit: cover/);
assert.match(source, /classicGallery: \["galleryPreviewCount"\]/);
console.log("OK: classic gallery limits, overflow tile, and disabled cleanup");
