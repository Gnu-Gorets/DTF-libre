const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
const start = source.indexOf("  const hashtagModes =");
const end = source.indexOf("  const page = unsafeWindow;", start);
assert(start > 0 && end > start);
const values = {
  hashtagModes: { игры: "include", кино: "include", реклама: "exclude" },
};
const cards = [];
const context = {
  get: (key, fallback) => values[key] ?? fallback,
  document: { querySelectorAll: () => cards },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.syncCard = syncHashtagCard; globalThis.syncCards = syncHashtagCards;`,
  context,
);
const card = (text, { connected = true, entry = false } = {}) => {
  const classes = new Set();
  const item = {
    isConnected: connected,
    textContent: text,
    closest: () => (entry ? {} : null),
    classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); } },
    hidden: () => classes.has("dtf-vm-hashtag-hidden"),
  };
  cards.push(item);
  return item;
};
const game = card("Пост про #Игры");
const movie = card("Пост про #кино и #сериалы");
const other = card("Пост про #музыка");
const untagged = card("Пост без тегов");
const advert = card("Пост #игры и #реклама");
context.syncCards();
assert.equal(game.hidden(), false, "keep a selected hashtag");
assert.equal(movie.hidden(), false, "include any selected hashtag");
assert.equal(other.hidden(), true, "hide other tagged posts when include mode is set");
assert.equal(untagged.hidden(), false, "keep posts without hashtags");
assert.equal(advert.hidden(), true, "exclude mode takes precedence");
values.hashtagModes = { реклама: "exclude" };
context.syncCard(other);
assert.equal(other.hidden(), false, "exclude-only mode leaves unrelated tags visible");
console.log("OK: per-hashtag include/exclude modes and untagged posts");
