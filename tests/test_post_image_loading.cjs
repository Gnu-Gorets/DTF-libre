const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("    const prioritizePostImages =");
const end = source.indexOf("    const setQuality =", start);
assert(start > 0 && end > start);
const selector =
  ".block-wrapper--media .andropov-image img, .block-wrapper--gallery .andropov-image img";
const mediaImage = { loading: "lazy", decoding: "sync" };
const galleryImage = { loading: "lazy", decoding: "sync" };
const avatar = { loading: "lazy", decoding: "sync" };
const addedMediaImage = { loading: "lazy", decoding: "sync" };
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
const context = { document };
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
console.log("OK: post media and dynamically added galleries load eagerly; avatars stay lazy");
