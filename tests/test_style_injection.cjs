const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('dtf.user.js', 'utf8');
const start = source.indexOf('  const attachStyles =');
const end = source.indexOf('\n  const primeLayout =', start);
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
vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.attach = attachStyles;`, context);
assert.equal(context.attach(), false, 'wait while head does not exist');
assert.equal(style.parentElement, null, 'do not append stylesheet directly to html');
context.document.head = {
  append(node) {
    node.parentElement = this;
    node.isConnected = true;
  },
};
assert.equal(context.attach(), true);
assert.equal(style.parentElement, context.document.head);
assert.equal(personalizationStyle.parentElement, context.document.head);
console.log('OK: both styles attach to head after it exists');
