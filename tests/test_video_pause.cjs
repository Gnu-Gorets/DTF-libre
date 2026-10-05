const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("    const syncVideos =");
const end = source.indexOf("\n\n    const apply =", start);
assert(start > 0 && end > start);
const settings = {};
const video = (top, bottom, paused = false) => ({
  paused,
  attributes: new Set(),
  pauseCount: 0,
  pause() {
    this.paused = true;
    this.pauseCount++;
  },
  hasAttribute(name) {
    return this.attributes.has(name);
  },
  setAttribute(name) {
    this.attributes.add(name);
  },
  removeAttribute(name) {
    this.attributes.delete(name);
  },
  getBoundingClientRect: () => ({ top, bottom }),
});
const first = video(50, 150);
const offscreen = video(-200, -50);
const videos = [first, offscreen];
const context = {
  get: (key, fallback) => settings[key] ?? fallback,
  document: { querySelectorAll: () => videos },
  window: { innerHeight: 100 },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.test = { syncVideos, pauseVideosOutsideViewport };`,
  context,
);
const { syncVideos, pauseVideosOutsideViewport } = context.test;
settings.pauseVideosByDefault = true;
syncVideos();
assert.equal(first.paused, true);
assert.equal(first.pauseCount, 1);
syncVideos();
assert.equal(
  first.pauseCount,
  1,
  "already handled video is not paused repeatedly",
);
const added = video(10, 80);
videos.push(added);
syncVideos();
assert.equal(added.paused, true, "new video is initially paused");
settings.pauseVideosByDefault = false;
syncVideos();
assert.equal(first.hasAttribute("data-dtf-vm-initial-pause"), false);
settings.pauseVideosOnScroll = true;
const playing = video(120, 200);
videos.push(playing);
pauseVideosOutsideViewport();
assert.equal(
  offscreen.paused,
  true,
  "video outside viewport is paused on scroll",
);
assert.equal(playing.paused, true, "video below viewport is paused on scroll");
assert.equal(first.paused, true, "already paused video is unchanged");
console.log("OK: default pause, new videos, and offscreen scroll pause");
