const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("    const prioritizePostImages =");
const end = source.indexOf("    const setQuality =", start);
assert(start > 0 && end > start);
const images = [{ loading: "lazy", decoding: "sync" }, {}];
let selector;
const context = {
  document: {
    querySelectorAll(value) {
      selector = value;
      return images;
    },
  },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.prioritizePostImages = prioritizePostImages;`,
  context,
);
context.prioritizePostImages();
assert.equal(selector, ".content img, .entry img");
for (const image of images) {
  assert.equal(image.loading, "eager");
  assert.equal(image.decoding, "async");
}
console.log("OK: feed and article images load eagerly with async decoding");
