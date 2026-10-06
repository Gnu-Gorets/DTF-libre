const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("    const setQuality =");
const end = source.indexOf("\n\n    const syncVideos =", start);
assert(start > 0 && end > start);
let writes = 0;
const makeNode = (attrs) => ({
  dataset: {},
  attrs: { ...attrs },
  getAttribute(name) {
    return this.attrs[name] ?? null;
  },
  setAttribute(name, value) {
    writes++;
    this.attrs[name] = value;
  },
  removeAttribute(name) {
    delete this.attrs[name];
  },
});
const originalSrc = "https://img.test/-/scale_crop/800x450/";
const originalSrcset = `${originalSrc}, https://img.test/-/scale_crop/1600x900/ 2x`;
const image = makeNode({ src: originalSrc, srcset: originalSrcset });
const pictureSource = makeNode({ srcset: originalSrcset });
const originalStyle = "aspect-ratio: 16/9";
let inGallery = false;
const media = {
  closest: () => (inGallery ? {} : null),
  style: { aspectRatio: "16/9", setProperty() {} },
  dataset: {},
  parentElement: { clientWidth: 1000 },
  attrs: { style: originalStyle },
  getAttribute(name) {
    return this.attrs[name] ?? null;
  },
  setAttribute(name, value) {
    this.attrs[name] = value;
  },
  getBoundingClientRect: () => ({ width: 1000, height: 562 }),
  querySelectorAll: () => [pictureSource, image],
};
const context = { document: { querySelectorAll: () => [media] }, Math };
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.setQuality = setQuality;`,
  context,
);
const { setQuality } = context;
setQuality(true);
assert.equal(image.attrs.src, "https://img.test/-/scale_crop/1000x563/");
assert.equal(
  image.attrs.srcset,
  "https://img.test/-/scale_crop/1000x563/, https://img.test/-/scale_crop/2000x1125/ 2x",
);
assert.equal(pictureSource.attrs.srcset, image.attrs.srcset);
const loadedUrl = image.attrs.src;
const initialWrites = writes;
setQuality(true);
assert.equal(
  image.attrs.src,
  loadedUrl,
  "repeated apply preserves selected image URL",
);
assert.equal(
  writes,
  initialWrites,
  "repeated apply does not rewrite image URLs",
);
media.parentElement.clientWidth = 900;
setQuality(true);
assert.equal(
  image.attrs.src,
  "https://img.test/-/scale_crop/900x506/",
  "resize recomputes URL from original",
);
setQuality(false);
assert.equal(image.attrs.src, originalSrc);
assert.equal(image.attrs.srcset, originalSrcset);
assert.equal(pictureSource.attrs.srcset, originalSrcset);
assert.equal(media.attrs.style, originalStyle);
assert.equal(image.dataset.dtfQualitySrc, undefined);
const writesBeforeHidden = writes;
media.parentElement.clientWidth = 0;
setQuality(true);
assert.equal(
  writes,
  writesBeforeHidden,
  "hidden post does not request scale_crop/0x",
);

const uuid = "350de268-0468-54e4-8878-ef8c570a7fef";
const gallerySrc = `https://img.test/${uuid}/-/scale_crop/280x280/`;
const gallerySrcset = `https://img.test/${uuid}/-/scale_crop/280x280/-/format/webp/, https://img.test/${uuid}/-/scale_crop/560x560/-/format/webp/ 2x`;
image.attrs.src = gallerySrc;
image.attrs.srcset = gallerySrcset;
pictureSource.attrs.srcset = gallerySrcset;
inGallery = true;
media.parentElement.clientWidth = 0;
setQuality(false, true);
assert.equal(image.attrs.src, `https://img.test/${uuid}/`);
assert.equal(
  image.attrs.srcset,
  `https://img.test/${uuid}/-/format/webp/, https://img.test/${uuid}/-/format/webp/ 2x`,
);
assert.equal(pictureSource.attrs.srcset, image.attrs.srcset);
setQuality(false, false);
assert.equal(image.attrs.src, gallerySrc);
assert.equal(image.attrs.srcset, gallerySrcset);
assert.equal(pictureSource.attrs.srcset, gallerySrcset);
console.log("OK: high-resolution gallery originals, srcset, quality transforms, restoration");
