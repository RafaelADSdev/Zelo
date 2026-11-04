import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../public/ai-keys.js', import.meta.url), 'utf8')).replaceAll('export ', '');
function fixture(allowed = true) {
  const events = new Map(), commits = [], announcements = [];
  let active = false;
  const classes = () => ({ add() {}, remove() {} });
  const list = { rows: [], addEventListener: (name, fn) => events.set(name, fn), contains: handle => list.rows.includes(handle.row),
    querySelectorAll: () => list.rows, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => true,
    insertBefore(row, target) { this.rows = this.rows.filter(item => item !== row); const at = target ? this.rows.indexOf(target) : this.rows.length; this.rows.splice(at, 0, row); },
    append(...rows) { this.rows = rows; } };
  for (const id of ['a', 'b', 'c']) {
    const handle = { dataset: {}, setAttribute() {}, focus() {}, closest: selector => selector === '.ai-key-drag' ? handle : row };
    const position = { textContent: '' };
    const row = { dataset: { keyId: id }, classList: classes(), querySelector: selector => selector === '.ai-key-position' ? position : handle,
      getBoundingClientRect: () => ({ top: 100 + list.rows.indexOf(row) * 100, left: 0, width: 600, height: 100 }),
      cloneNode: () => ({ style: {}, classList: classes(), setAttribute() {}, remove() {} }), scrollIntoView() {} };
    handle.row = row; list.rows.push(row);
  }
  const document = { querySelector() {}, addEventListener() {}, body: { append() {} }, hidden: false };
  const context = { document, window: { innerHeight: 900, scrollBy() {}, addEventListener() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  runInNewContext(source, context);
  context.installAiKeyReorder(list, { canStart: () => allowed, start: () => { active = true; }, finish: (order, id) => { active = false; if (order) commits.push({ order: Array.from(order), id }); }, announce: text => announcements.push(text) });
  function emit(name, keyOrValues = {}) {
    const values = typeof keyOrValues === 'string' ? { key: keyOrValues } : keyOrValues;
    events.get(name)({ target: list.rows.find(row => row.dataset.keyId === 'a').querySelector('.ai-key-drag'), preventDefault() {}, button: 0, isPrimary: true, pointerId: 1, clientY: 140, ...values });
  }
  return { list, emit, commits, announcements, active: () => active, order: () => list.rows.map(row => row.dataset.keyId) };
}

test('prioridade: arrastar pelo toque salva a nova ordem uma vez ao soltar', () => {
  const f = fixture();
  f.emit('pointerdown', { pointerType: 'touch' });
  f.emit('pointermove', { clientY: 360 });
  assert.deepEqual(f.order(), ['b', 'c', 'a']);
  assert.equal(f.commits.length, 0);
  f.emit('pointerup', { clientY: 360 });
  assert.deepEqual(f.commits, [{ order: ['b', 'c', 'a'], id: 'a' }]);
  assert.equal(f.active(), false);
});

test('prioridade: cancelar o arraste restaura a lista e não salva; um toque não reordena', () => {
  const f = fixture();
  f.emit('pointerdown'); f.emit('pointermove', { clientY: 360 }); f.emit('pointercancel');
  assert.deepEqual(f.order(), ['a', 'b', 'c']);
  assert.equal(f.commits.length, 0);
  f.emit('pointerdown'); f.emit('pointerup');
  assert.equal(f.commits.length, 0);
});

test('prioridade: teclado move até o fim, cancela com Escape e confirma com Enter', () => {
  const f = fixture();
  f.emit('keydown', ' '); f.emit('keydown', 'End');
  assert.deepEqual(f.order(), ['b', 'c', 'a']);
  f.emit('keydown', 'Escape');
  assert.deepEqual(f.order(), ['a', 'b', 'c']);
  f.emit('keydown', 'Enter'); f.emit('keydown', 'ArrowDown'); f.emit('keydown', 'Enter');
  assert.deepEqual(f.commits, [{ order: ['b', 'a', 'c'], id: 'a' }]);
  assert.ok(f.announcements.length > 0);
});

test('prioridade: bloqueio durante edição ou salvamento impede iniciar uma reordenação', () => {
  const f = fixture(false);
  f.emit('pointerdown'); f.emit('pointermove', { clientY: 360 }); f.emit('pointerup');
  f.emit('keydown', 'Enter'); f.emit('keydown', 'End');
  assert.deepEqual(f.order(), ['a', 'b', 'c']);
  assert.equal(f.commits.length, 0);
  assert.equal(f.active(), false);
});
