const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('dtf.user.js', 'utf8');
const start = source.indexOf('  const personalizationColors =');
const end = source.indexOf('  const waitForDtfStyles =', start);
assert(start > 0 && end > start);
const values = new Map();
const style = { id: '', textContent: '', isConnected: false, remove() { this.isConnected = false; } };
const context = {
  document: { createElement: () => style, documentElement: { append: node => { node.isConnected = true; } } },
  get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
  set: (key, value) => values.set(key, value),
  URL,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  btoa,
  atob,
};
vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.apply = applyPersonalization; globalThis.encode = encodeTheme; globalThis.decode = decodeTheme; globalThis.applyTheme = applyTheme;`, context);
assert.equal(style.isConnected, false, 'disabled by default');
values.set('personalizationEnabled', true);
values.set('personalization:accent', '#123abc');
values.set('personalizationBackground', 'https://images.example/bg.jpg');
context.apply();
assert.match(style.textContent, /--theme-color-accent:#123abc !important/);
assert.match(style.textContent, /background-image:url\("https:\/\/images.example\/bg.jpg"\)/);
values.set('personalizationBackground', 'javascript:alert(1)');
context.apply();
assert.doesNotMatch(style.textContent, /background-image/);
values.set('personalizationEnabled', false);
context.apply();
assert.equal(style.isConnected, false, 'disabled removes overrides');
values.set('personalization:accent', '#123abc');
values.set('personalizationBackground', 'https://images.example/bg.jpg');
const encoded = context.encode();
const decoded = context.decode(encoded);
assert.equal(decoded.c[0], '123abc');
assert.equal(decoded.b, 'https://images.example/bg.jpg');
assert.equal(context.decode('not a theme'), null);
const unsafe = btoa(JSON.stringify({ v: 1, c: Array(6).fill('123abc'), b: 'javascript:alert(1)' }));
assert.equal(context.decode(unsafe), null, 'reject unsafe image URLs');
context.applyTheme(decoded);
assert.equal(values.get('personalizationEnabled'), true);
assert.equal(values.get('personalization:accent'), '#123abc');
console.log('OK: personalization and theme code import/export');
