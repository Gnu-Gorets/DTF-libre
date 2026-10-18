const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("    const prioritizePostImages =");
const end = source.indexOf("    const setQuality =", start);
assert(start > 0 && end > start);
const applyStart = source.indexOf("    const apply = () => {");
const applyEnd = source.indexOf("    const openSettings =", applyStart);
assert(applyStart > 0 && applyEnd > applyStart);
assert.doesNotMatch(
  source.slice(applyStart, applyEnd),
  /prioritizePostImages\(/,
  "global image scan must not run on every apply",
);
assert.match(
  source,
  /prioritizePostImages\(\);\s*syncVideoPosters\(\);\s*if \(document\.readyState === "loading"\)[\s\S]*?else rememberInitialVideoPosters\(\);\s*apply\(\);/,
);
const selector =
  ".block-wrapper--media .andropov-image img, .block-wrapper--gallery .andropov-image img";
const makeImage = () => ({
  loading: "lazy",
  decoding: "sync",
  dataset: {},
  src: "https://leonardo.osnova.io/image/-/scale_crop/1200x/",
  currentSrc: "https://leonardo.osnova.io/image/-/scale_crop/1200x/",
  addEventListener(name, callback) {
    if (name === "error") this.onerror = callback;
  },
  closest: () => ({ querySelectorAll: () => [] }),
  removeAttribute(name) {
    if (name === "srcset") this.srcset = "";
  },
});
const mediaImage = makeImage();
const galleryImage = makeImage();
const avatar = { loading: "lazy", decoding: "sync" };
const addedMediaImage = makeImage();
const document = {
  querySelectorAll(value) {
    assert.equal(value, selector);
    return [mediaImage, galleryImage];
  },
};
const addedPost = {
  querySelectorAll(value) {
    assert.equal(value, selector);
    return [addedMediaImage];
  },
};
const context = { document, URL };
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.prioritizePostImages = prioritizePostImages;`,
  context,
);
context.prioritizePostImages();
context.prioritizePostImages(addedPost);
for (const image of [mediaImage, galleryImage, addedMediaImage]) {
  assert.equal(image.loading, "eager");
  assert.equal(image.decoding, "async");
}
assert.equal(avatar.loading, "lazy", "avatars must stay lazy");
assert.equal(avatar.decoding, "sync", "unrelated images remain untouched");
mediaImage.onerror();
assert.equal(mediaImage.src, "https://leonardo.osnova.io/image");
assert.equal(mediaImage.srcset, "");
console.log("OK: failed transformed images fall back to original; avatars stay lazy");
