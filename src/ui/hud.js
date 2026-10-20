// HUD: speedometer, stolen-car card, contextual prompt, toasts, condition bar and a
// north-up minimap drawn from the road grid.
import { CAR_TYPES } from '../vehicles/carModels.js';
import { clamp } from '../util/math.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(city) {
    this.city = city;
    this.el = {
      hud: $('hud'), carcard: $('carcard'), carname: $('carname'), carstats: $('carstats'), toast: $('toast'), prompt: $('prompt'),
      speedo: $('speedo'), speed: $('speed'), gear: $('gear'), arc: $('arcfill'), damage: $('damage'), damagefill: $('damagefill'), help: $('help'), minimap: $('minimap'),
    };
    this.toastT = 0;
    this.helpT = 14;
    this.promptText = null;
    this.lastSpeed = -1;
    this._buildMinimapLayer();
    this.ctx = this.el.minimap.getContext('2d');
  }

  showCar(v) {
    const s = v.spec;
    this.el.carname.textContent = s.name;
    this.el.carstats.textContent = `${s.cls.toUpperCase()} · ${Math.round(s.top * 3.6)} KM/H · ${Math.round(s.mass)} KG`;
    this.el.carcard.classList.add('show');
    this.el.speedo.classList.add('show');
    this.el.damage.classList.add('show');
  }
  hideCar() {
    this.el.carcard.classList.remove('show');
    this.el.speedo.classList.remove('show');
    this.el.damage.classList.remove('show');
  }
  setSpeed(kmh, gear) {
    const k = Math.round(kmh);
    if (k !== this.lastSpeed) { this.el.speed.textContent = String(k); this.lastSpeed = k; }
    this.el.gear.textContent = gear;
    const f = clamp(kmh / 220, 0, 1);
    this.el.arc.style.strokeDashoffset = String(157 - 157 * f);
    this.el.arc.style.stroke = f > 0.75 ? '#ff5a4e' : f > 0.45 ? '#ffb347' : '#ff8a3d';
  }
  setDamage(health, wrecked) {
    const f = clamp(health / 100, 0, 1);
    this.el.damagefill.style.width = (f * 100).toFixed(0) + '%';
    this.el.damagefill.style.backgroundColor = wrecked ? '#ff5a4e' : f > 0.6 ? '#7fd36a' : f > 0.3 ? '#ffb347' : '#ff5a4e';
    this.el.hud.classList.toggle('wrecked', !!wrecked);
  }
  setPrompt(text, key = 'E') {
    if (text === this.promptText) return;
    this.promptText = text;
    if (!text) { this.el.prompt.classList.remove('show'); return; }
    this.el.prompt.innerHTML = `<kbd>${key}</kbd><span>${text}</span>`;
    this.el.prompt.classList.add('show');
  }
  toast(text, sub = '', kind = '', duration = 2.4) {
    this.el.toast.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
    this.el.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    this.toastT = duration;
  }

  update(dt, game) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('show'); }
    if (this.helpT > 0) { this.helpT -= dt; if (this.helpT <= 0) this.el.help.classList.add('fade'); }
    this._drawMinimap(game);
  }

  _buildMinimapLayer() {
    const city = this.city, net = city.net;
    const pad = 60;
    const size = Math.ceil((city.bound + pad) * 2);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    this.mmSize = size; this.mmOffset = size / 2;
    g.fillStyle = '#2b2740';
    g.fillRect(0, 0, size, size);
    // land
    g.fillStyle = '#3e5a3a';
    g.fillRect(0, 0, size, this.mmOffset + city.waterLine);
    g.fillStyle = '#2a7f9c';
    g.fillRect(0, this.mmOffset + city.waterLine, size, size);
    // blocks
    for (const lot of city.lots) {
      g.fillStyle = lot.theme === 'park' ? '#4f8a3f' : lot.theme === 'plaza' ? '#8d8470' : lot.theme === 'parking' ? '#5a5666' : '#6a6478';
      g.fillRect(this.mmOffset + lot.cx - lot.size / 2 + 1, this.mmOffset + lot.cz - lot.size / 2 + 1, lot.size - 2, lot.size - 2);
    }
    // roads
    g.strokeStyle = '#d9cdb8';
    g.lineWidth = net.road - 2;
    g.lineCap = 'butt';
    for (const seg of net.segments) {
      g.beginPath();
      g.moveTo(this.mmOffset + seg.x0, this.mmOffset + seg.z0);
      g.lineTo(this.mmOffset + seg.x1, this.mmOffset + seg.z1);
      g.stroke();
    }
    this.mmLayer = c;
  }

  _drawMinimap(game) {
    const ctx = this.ctx, W = this.el.minimap.width, H = this.el.minimap.height;
    const p = game.player;
    const cx = p.x, cz = p.z;
    const scale = 0.9;   // px per meter
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cz);
    ctx.drawImage(this.mmLayer, -this.mmOffset, -this.mmOffset);
    // cars
    for (const v of game.vehicles.vehicles) {
      if (Math.abs(v.x - cx) > 120 || Math.abs(v.z - cz) > 120) continue;
      ctx.save();
      ctx.translate(v.x, v.z);
      ctx.rotate(-v.yaw);
      ctx.fillStyle = v === p.car ? '#ff8a3d' : v.wrecked ? '#2b2735' : v.controller === 'ai' ? '#fff4e3' : '#9a93a8';
      ctx.fillRect(-v.hw, -v.hl, v.hw * 2, v.hl * 2);
      ctx.restore();
    }
    ctx.restore();
    // player marker (always at center) with heading
    const yaw = p.inCar && p.car ? p.car.yaw : p.yaw;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-yaw + Math.PI);
    ctx.fillStyle = '#ff8a3d';
    ctx.strokeStyle = '#1b1727';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // north tick
    ctx.fillStyle = 'rgba(255,244,227,.8)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 14);
  }
}
