// Keyboard + mouse input with named actions, plus a virtual layer so scripts (capture
// harness, demo autopilot) can drive the game exactly like a player would.
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['Space'],
  interact: ['KeyE', 'Enter', 'KeyF'],
  camera: ['KeyC'],
  flip: ['KeyR'],
  horn: ['KeyH'],
  mute: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  help: ['F1', 'Slash'],
};
const GAME_KEYS = new Set(Object.values(BINDINGS).flat());

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.virtual = {};          // action -> number (0..1) or boolean, held
    this.virtualPulse = new Set(); // actions pressed this frame by scripts
    this.mouse = { dx: 0, dy: 0, dragging: false, wheel: 0 };
    this.anyKeyListeners = [];
    this.enabled = true;

    target.addEventListener('keydown', (e) => {
      if (e.repeat) { if (GAME_KEYS.has(e.code)) e.preventDefault(); return; }
      if (GAME_KEYS.has(e.code) && e.code !== 'F1') e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
      for (const fn of this.anyKeyListeners) fn(e);
    });
    target.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    target.addEventListener('blur', () => { this.down.clear(); this.mouse.dragging = false; });
    const canvas = document.getElementById('game');
    const el = canvas || target;
    el.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouse.dragging = true; } });
    target.addEventListener('mouseup', () => { this.mouse.dragging = false; });
    target.addEventListener('mousemove', (e) => { if (this.mouse.dragging) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    el.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onAnyKey(fn) { this.anyKeyListeners.push(fn); }

  isDown(action) {
    if (!this.enabled) return false;
    const v = this.virtual[action];
    if (v) return true;
    for (const code of BINDINGS[action]) if (this.down.has(code)) return true;
    return false;
  }
  /** analog value 0..1 for an action (virtual inputs may be fractional) */
  value(action) {
    if (!this.enabled) return 0;
    const v = this.virtual[action];
    if (typeof v === 'number') return Math.max(0, Math.min(1, v));
    if (v === true) return 1;
    for (const code of BINDINGS[action]) if (this.down.has(code)) return 1;
    return 0;
  }
  justPressed(action) {
    if (!this.enabled) return false;
    if (this.virtualPulse.has(action)) return true;
    for (const code of BINDINGS[action]) if (this.pressed.has(code)) return true;
    return false;
  }
  /** steering/move axis: -1 (left) .. 1 (right) */
  axis(negAction, posAction) { return this.value(posAction) - this.value(negAction); }

  /** Script control: hold actions. Pass numbers for analog (e.g. {forward: 0.6, left: 1}). */
  setVirtual(map) { this.virtual = { ...map }; }
  clearVirtual() { this.virtual = {}; }
  pulse(action) { this.virtualPulse.add(action); }

  endFrame() { this.pressed.clear(); this.virtualPulse.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; }
}
