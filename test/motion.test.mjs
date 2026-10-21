import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/motion.js', import.meta.url), 'utf8');
function fixture(reduced = false) {
  const events = new Map(), preferences = new Map(), animations = [];
  let observe;
  const document = { body: {}, documentElement: { dataset: {} }, visibilityState: 'visible', hidden: false,
    addEventListener: (name, callback) => events.set(name, callback), querySelector: () => null, querySelectorAll: () => [] };
  const preference = { matches: reduced, addEventListener: (name, callback) => preferences.set(name, callback) };
  function element() { return { hidden: false, matches: () => true, contains: () => false, getClientRects: () => [{}],
    animate(frames, timing) { const animation = { frames, timing, cancelled: false, cancel() { this.cancelled = true; }, finished: new Promise(() => {}) }; animations.push(animation); return animation; } }; }
  runInNewContext(source, { document, matchMedia: () => preference, performance: { now: () => 100 }, HTMLDetailsElement: class {}, MutationObserver: class { constructor(callback) { observe = callback; } observe() {} } });
  return { document, preference, events, preferences, animations, element,
    reveal: target => observe([{ type: 'attributes', target }]),
    emit: (name, event = {}) => events.get(name)(event),
    rowsChanged: target => observe([{ type: 'childList', target }]) };
}
test('motion: reduced preference and keyboard preserve instant usable states', () => {
  const f = fixture(true), panel = f.element(); f.reveal(panel); assert.equal(f.animations.length, 0);
  f.preference.matches = false; f.reveal(panel); assert.equal(f.animations.length, 1);
  f.emit('keydown'); assert.equal(f.animations[0].cancelled, true); f.reveal(panel); assert.equal(f.animations.length, 1);
  f.emit('pointerdown', { target: { closest: () => null } }); f.reveal(panel); assert.equal(f.animations.length, 2);
  f.preference.matches = true; f.preferences.get('change')(); assert.equal(f.animations[1].cancelled, true);
  assert.equal(panel.hidden, false);
});
test('motion: rapid navigation cancels previous reveal and hidden tabs stop motion', () => {
  const f = fixture(), panel = f.element(); f.reveal(panel); f.reveal(panel);
  assert.equal(f.animations[0].cancelled, true); assert.equal(f.animations[1].timing.duration, 240);
  f.document.hidden = true; f.document.visibilityState = 'hidden'; f.emit('visibilitychange');
  assert.equal(f.animations[1].cancelled, true); f.reveal(panel); assert.equal(f.animations.length, 2);
});
test('motion: reordering moves stable row identities once without replay on polling', () => {
  const f = fixture(), a = f.element(), b = f.element();
  Object.assign(a, { dataset: { keyId: 'a' }, getBoundingClientRect: () => ({ top: 100 }) });
  Object.assign(b, { dataset: { keyId: 'b' }, getBoundingClientRect: () => ({ top: 200 }) });
  f.document.querySelectorAll = () => [a, b];
  f.emit('pointerdown', { target: { closest: () => ({}) } });
  a.getBoundingClientRect = () => ({ top: 200 }); b.getBoundingClientRect = () => ({ top: 100 });
  const list = { id: 'ai-key-list', children: [b, a] }; f.rowsChanged(list);
  assert.equal(f.animations.length, 2); assert.equal(f.animations[0].frames[0].transform, 'translateY(100px)');
  f.rowsChanged(list); assert.equal(f.animations.length, 2);
});
