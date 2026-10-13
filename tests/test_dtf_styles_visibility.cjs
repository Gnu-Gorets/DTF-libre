const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("dtf.user.js", "utf8");
assert(!source.includes("waitForDtfStyles"), "native CSS loading does not block page display");
assert(!source.includes("dtf-vm-waiting-css"), "body is never hidden while waiting for CSS");
const css = source.match(/  style.textContent = `([\s\S]*?)`;/)[1];
const pendingRules = css.split("\n").filter(line => line.includes("dtf-vm-feed-pending")).join("\n");
assert.match(pendingRules, /scrollbar-color: transparent transparent/);
assert(!/visibility:|display:|position:|height:|overflow:|overflow-y:|pointer-events:/.test(pendingRules),
  "scrollbar suppression must not hide content, block scrolling, or change layout");
console.log("OK: no stylesheet display gate; pending rules affect scrollbar colors only");
