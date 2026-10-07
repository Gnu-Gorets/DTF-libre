const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("dtf.user.js", "utf8");
for (const [option, path] of Object.entries({
  hidePopular: "/popular",
  hideNew: "/new",
  hideMy: "/my",
  hideMessages: "/m",
  hideRating: "/discovery",
})) {
  assert.ok(
    source.includes(
      `html.dtf-vm-${option.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} a[href="${path}"]`,
    ),
    `${option} selector ignores changing DTF classes`,
  );
}
for (const [option, section] of Object.entries({
  hideGames: "games",
  hideTopics: "topics",
  hideFooter: "footer",
})) {
  assert.ok(
    source.includes(
      `html.dtf-vm-${option.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} :has(> [data-section="${section}"])`,
    ),
    `${option} selector ignores changing DTF classes`,
  );
}
assert.match(
  source,
  /\.dtf-vm-centered \.block-wrapper--media \.block-media \{[^}]*flex-direction: column !important;[^}]*align-items: center !important;/,
  "centered media keeps caption below image",
);
assert.match(source, /\.dtf-vm-topic-extras > a \{ display: flex;/);
assert.match(source, /\.dtf-vm-topic-extras > a img \{ flex: 0 0 32px;/);
const start = source.indexOf("  const attachStyles =");
const end = source.indexOf("\n  const primeLayout =", start);
assert(start >= 0 && end > start);
const makeStyle = () => ({ parentElement: null, isConnected: false });
const style = makeStyle();
const personalizationStyle = makeStyle();
const context = {
  style,
  personalizationStyle,
  document: { head: null },
  get: () => true,
  applyPersonalization() {
    context.document.head.append(personalizationStyle);
  },
};
vm.runInNewContext(
  `${source.slice(start, end)}\nglobalThis.attach = attachStyles;`,
  context,
);
assert.equal(context.attach(), false, "wait while head does not exist");
assert.equal(
  style.parentElement,
  null,
  "do not append stylesheet directly to html",
);
context.document.head = {
  append(node) {
    node.parentElement = this;
    node.isConnected = true;
  },
};
assert.equal(context.attach(), true);
assert.equal(style.parentElement, context.document.head);
assert.equal(personalizationStyle.parentElement, context.document.head);
console.log("OK: both styles attach to head after it exists");
