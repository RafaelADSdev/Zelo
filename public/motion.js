// Motion is progressive enhancement: content and controls never wait for it.
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const running = new Map();
const easing = 'cubic-bezier(0.16, 1, 0.3, 1)';
let keyboard = false, reorder;
let broadcastStepIndex = 0;
const canMove = () => !preference.matches && !keyboard && document.visibilityState === 'visible';
function play(element, frames, options = {}) {
  if (!element || !canMove() || !element.getClientRects().length || !element.animate) return;
  running.get(element)?.cancel();
  const animation = element.animate(frames, { duration: 240, easing, ...options });
  running.set(element, animation);
  const clear = () => { if (running.get(element) === animation) running.delete(element); };
  animation.finished.then(clear, clear);
}
function reveal(element, delay = 0) {
  play(element, [{ opacity: .4, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { delay });
}
function stop() {
  for (const animation of running.values()) animation.cancel();
  running.clear(); reorder = undefined;
  document.querySelectorAll('#broadcast-refresh[data-motion-busy]').forEach(button => delete button.dataset.motionBusy);
}
document.addEventListener('keydown', () => { keyboard = true; document.documentElement.dataset.motionInput = 'keyboard'; stop(); }, true);
document.addEventListener('pointerdown', event => {
  keyboard = false; delete document.documentElement.dataset.motionInput;
  if (event.target.closest('.ai-key-movers') && canMove()) {
    reorder = { at: performance.now(), rows: new Map([...document.querySelectorAll('.ai-key-row')].map(row => [row.dataset.keyId, row.getBoundingClientRect().top])) };
  }
}, true);
preference.addEventListener('change', () => { if (preference.matches) stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
document.addEventListener('toggle', event => {
  if (!(event.target instanceof HTMLDetailsElement) || !event.target.open) return;
  if (event.target.matches('#view-broadcasts .broadcast-history-group')) {
    play(event.target.lastElementChild, [{ clipPath: 'inset(0 0 100% 0)', opacity: .6 }, { clipPath: 'inset(0 0 0% 0)', opacity: 1 }], { duration: 260 });
    return;
  }
  const children = [...event.target.children].filter(child => child.tagName !== 'SUMMARY');
  children.slice(0, 3).forEach((child, index) => reveal(child, index * 25));
}, true);

// Native details remain responsible for focus and expansion. Nearby product
// headers follow their new positions so closing a long group keeps continuity.
document.addEventListener('click', event => {
  const refresh = event.target.closest('#broadcast-refresh');
  if (refresh && !refresh.disabled && event.detail > 0 && canMove()) refresh.dataset.motionBusy = 'true';
  const summary = event.target.closest('#view-broadcasts .broadcast-history-group > summary');
  if (!summary || event.detail === 0 || !canMove()) return;
  const section = summary.parentElement;
  const siblings = [...section.parentElement.children].filter(item => item !== section && item.matches('.broadcast-history-group'));
  const before = new Map(siblings.map(item => [item, item.getBoundingClientRect().top]));
  for (const item of siblings) running.get(item)?.cancel();
  requestAnimationFrame(() => {
    if (!section.isConnected || !canMove()) return;
    for (const item of siblings) {
      const offset = before.get(item) - item.getBoundingClientRect().top;
      if (Math.abs(offset) > 1 && Math.abs(offset) < 600) play(item, [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: section.open ? 240 : 180 });
    }
  });
}, true);

const panels = '.view,[role="tabpanel"],#product-editor,#ai-key-editor,#reply-program-form,#login-error,#global-error';
new MutationObserver(records => {
  const revealed = new Set();
  for (const record of records) {
    if (record.type === 'attributes') {
      const target = record.target;
      if (target.id === 'view-broadcasts' && target.hidden) document.querySelectorAll('#broadcast-refresh[data-motion-busy]').forEach(button => delete button.dataset.motionBusy);
      if (target.id === 'broadcast-refresh' && !target.disabled) delete target.dataset.motionBusy;
      if (!target.hidden && (target.matches(panels) || target.matches('#view-broadcasts .broadcast-step, #broadcast-review'))) revealed.add(target);
    } else if (record.target.id === 'ai-key-list' && reorder) {
      const previous = reorder; reorder = undefined;
      if (performance.now() - previous.at > 1800) continue;
      for (const row of record.target.children) {
        const old = previous.rows.get(row.dataset.keyId);
        if (old === undefined) continue;
        const offset = old - row.getBoundingClientRect().top;
        if (Math.abs(offset) > 1 && Math.abs(offset) < 400) play(row, [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 280 });
      }
    }
  }
  // Parent transitions already carry their descendants; never stack reveals.
  for (const target of revealed) if (![...revealed].some(parent => parent !== target && parent.contains(target))) {
    if (target.matches('#view-broadcasts .broadcast-step')) {
      const index = [...target.parentElement.querySelectorAll(':scope > .broadcast-step')].indexOf(target);
      const direction = index >= broadcastStepIndex ? 1 : -1; broadcastStepIndex = index;
      play(target, [{ opacity: .5, transform: `translateX(${direction * 12}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 190 });
    } else reveal(target);
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'], childList: true });

if (document.querySelector('.login-shell')) {
  play(document.querySelector('.identity h1'), [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], { duration: 460 });
  play(document.querySelector('.conversation-symbol'), [{ opacity: .5, transform: 'scale(.94)', filter: 'blur(2px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }], { duration: 380 });
  reveal(document.querySelector('.login-card'), 50);
} else {
  reveal(document.querySelector('.page-heading'));
}
