const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const videoPosterForMedia =");
const end = source.indexOf("  const originalFetch = page.fetch;", start);
assert(start >= 0 && end > start);
const createdImages = [];
class Image {
  constructor() {
    createdImages.push(this);
  }
}
const context = {
  Image,
  document: {},
  syncVideoPosters() {},
};
const vmContext = vm.createContext(context);
vm.runInContext(
  `${source.slice(start, end)}\nglobalThis.posterHelpers = { videoPostersFromEntry, rememberVideoPosters, videoPostersById };`,
  vmContext,
);

const uuid = "350de268-0468-54e4-8878-ef8c570a7fef";
const entry = {
  type: "entry",
  data: {
    id: 123,
    blocks: [
      {
        type: "media",
        data: {
          items: [
            { image: { data: { uuid, width: 640, isVideo: true } } },
            { image: { data: { uuid, width: 640, isVideo: false } } },
            {
              image: {
                data: {
                  uuid: "abcdefab-cdef-abcd-efab-cdefabcdefab",
                  width: 4096,
                  isVideo: true,
                },
              },
            },
          ],
        },
      },
      {
        type: "media",
        data: { items: [{ image: { data: { uuid: "bad-id", isVideo: true } } }] },
      },
    ],
  },
};
const posters = context.posterHelpers.videoPostersFromEntry(entry);
assert.deepEqual(JSON.parse(JSON.stringify(posters)), {
  id: "123",
  posters: [
    `https://leonardo.osnova.io/${uuid}/-/scale_crop/640x/`,
    "https://leonardo.osnova.io/abcdefab-cdef-abcd-efab-cdefabcdefab/-/scale_crop/1280x/",
  ],
});
assert.equal(context.posterHelpers.videoPostersFromEntry({ ...entry, type: "comment" }), null);

context.posterHelpers.rememberVideoPosters([entry]);
assert.equal(context.posterHelpers.videoPostersById.get("123").length, 2);
assert.equal(createdImages.length, 2, "preload each distinct poster URL once");
assert.deepEqual(
  createdImages.map((image) => image.src),
  posters.posters,
);

const video = { poster: "" };
const secondVideo = { poster: "" };
const media = { querySelector: (selector) => (selector === "video" ? video : null) };
const secondMedia = {
  querySelector: (selector) => (selector === "video" ? secondVideo : null),
};
let card;
const link = {
  href: "https://dtf.ru/topic/123-test",
  closest: (selector) => (selector === ".content" ? card : null),
};
card = {
  matches: (selector) => selector === ".content",
  closest: () => null,
  querySelectorAll(selector) {
    if (selector === ".content-header a[href]") return [link];
    if (selector === ".andropov-video") return [media, secondMedia];
    return [];
  },
};
const addedVideo = {
  matches: () => false,
  closest: (selector) => (selector === ".content" ? card : null),
  querySelectorAll: () => [],
};
const mappingStart = source.indexOf("  const postIdForCard =");
const mappingEnd = source.indexOf("  const saveViewedPosts =", mappingStart);
assert(mappingStart >= 0 && mappingEnd > mappingStart);
vmContext.postIdFromUrl = (value) =>
  String(value).match(/\/[^/]+\/(\d+)/)?.[1] || null;
vm.runInContext(
  `${source.slice(mappingStart, mappingEnd)}
    globalThis.sync = syncVideoPosters;
    globalThis.rememberInitial = rememberInitialVideoPosters;`,
  vmContext,
);
vmContext.sync(addedVideo);
assert.equal(video.poster, posters.posters[0]);
assert.equal(secondVideo.poster, posters.posters[1]);
assert.equal(context.posterHelpers.videoPostersById.has("123"), true);
video.poster = "";
vmContext.sync(addedVideo);
assert.equal(video.poster, posters.posters[0], "poster recovers after media rerender");

const initialEntry = {
  type: "entry",
  data: {
    id: 456,
    blocks: [
      {
        type: "media",
        data: {
          items: [
            {
              image: {
                data: {
                  uuid: "12345678-1234-5678-9abc-123456789abc",
                  width: 480,
                  isVideo: true,
                },
              },
            },
          ],
        },
      },
    ],
  },
};
const unrenderedEntry = { ...initialEntry, data: { ...initialEntry.data, id: 999 } };
let initialCard;
const initialLink = {
  href: "https://dtf.ru/topic/456-test",
  closest: () => initialCard,
};
initialCard = {
  querySelectorAll: (selector) =>
    selector === ".content-header a[href]" ? [initialLink] : [],
};
context.page = {
  __INITIAL_STATE__: {
    "feed@popular": { items: [initialEntry, unrenderedEntry] },
  },
};
context.document.querySelectorAll = (selector) =>
  selector === ".content" || selector === ".feed-page .content"
    ? [initialCard]
    : [];
vmContext.rememberInitial();
assert.equal(context.posterHelpers.videoPostersById.has("456"), true);
assert.equal(context.posterHelpers.videoPostersById.has("999"), false);
assert.match(
  source,
  /addEventListener\("DOMContentLoaded", rememberInitialVideoPosters/,
);
console.log("OK: posters preload from API and SSR feed for rendered video cards");
