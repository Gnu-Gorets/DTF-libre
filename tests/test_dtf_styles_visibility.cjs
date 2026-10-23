const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("dtf.user.js", "utf8");
assert(source.includes('root.style.visibility = "hidden"'), "reload page is hidden immediately");
assert.match(source, /addEventListener\("load", release/, "page is shown after browser load");
const css = source.match(/  style.textContent = `([\s\S]*?)`;/)[1];
const pendingRules = css.split("\n").filter(line => line.includes("dtf-vm-feed-pending")).join("\n");
assert.match(pendingRules, /scrollbar-color: transparent transparent/);
assert(!/visibility:|display:|position:|height:|overflow:|overflow-y:|pointer-events:/.test(pendingRules),
  "scrollbar suppression must not hide content, block scrolling, or change layout");
assert.match(source, /setTimeout\(release, 10000\)/, "page remains hidden only for a bounded time");
console.log("OK: reload stays hidden until browser load; pending rules affect scrollbar colors only");
