// ============================================================
//  戦闘シミュレーション（描画に依存しない純粋ロジック）
//  盤面: 7列 x 8行 のヘックス(odd-r)。チーム0が下(行4-7)、チーム1が上(行0-3)
// ============================================================
import { UNITS, TRAITS, ITEMS, STAR_HP, STAR_AD, NEUTRAL, countTraits, traitTier } from './data.js';

export const COLS = 7, ROWS = 8, TICK = 0.05, TIME_LIMIT = 40, MOVE_T = 0.35;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const idx = (c, r) => r * COLS + c;
export function hexDist(a, b) {
  const ax = a.c - ((a.r - (a.r & 1)) >> 1), bx = b.c - ((b.r - (b.r & 1)) >> 1);
  const dx = ax - bx, dz = a.r - b.r;
  return Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dx + dz));
}
const NB = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const o = r & 1;
  const cand = [[c - 1, r], [c + 1, r], [c - 1 + o, r - 1], [c + o, r - 1], [c - 1 + o, r + 1], [c + o, r + 1]];
  NB[idx(c, r)] = cand.filter(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS).map(([x, y]) => idx(x, y));
}
const POS = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) POS[idx(c, r)] = { c, r };

export function teamTiers(units) {
  const cnt = countTraits(units), tl = {};
  for (const k in cnt) tl[k] = traitTier(k, cnt[k]);
  return tl;
}
const tv = (id, i, tier) => (tier ? TRAITS[id].v[i][tier - 1] : 0);

export class Battle {
  // team: { units:[{id,star,items,c,r}], mods:{} }  c,r はローカル座標(r=0が前列)
  constructor(A, B, seed = 1, rec = false) {
    this.rng = mulberry32(seed); this.rec = rec; this.ev = [];
    this.t = 0; this.over = false; this.winner = null;
    this.units = []; this.grid = new Array(COLS * ROWS).fill(null);
    this.tl = [teamTiers(A.units), teamTiers(B.units)];
    this.mods = [A.mods || {}, B.mods || {}];
    const ua = A.units.map(i => this.make(i, 0)), ub = B.units.map(i => this.make(i, 1));
    for (let i = 0; i < Math.max(ua.length, ub.length); i++) { if (ua[i]) this.units.push(ua[i]); if (ub[i]) this.units.push(ub[i]); }
    this.units.forEach((u, i) => { u.uid = i; });
    for (const u of this.units) this.startFx(u);
    this.checkEnd();
  }

  make(inst, team) {
    const def = UNITS[inst.id], sm = inst.star - 1, tl = this.tl[team], md = this.mods[team];
    let c = inst.c, r = inst.r;
    if (team === 0) r = 4 + r; else { r = 3 - r; c = COLS - 1 - c; }
    while (this.grid[idx(c, r)]) { c = (c + 1) % COLS; } // 念のため重複回避
    const u = {
      inst, def, star: inst.star, team, pos: { c, r }, prev: { c, r }, moveT: 0,
      maxHp: def.hp * STAR_HP[sm], ad: def.ad * STAR_AD[sm], as: def.as, armor: def.armor, mr: def.mr, range: def.range,
      ap: 100, mana: def.mana[0], maxMana: def.mana[1], critC: 0.25, critD: 1.4, dodge: 0, dr: 0, flat: 0,
      manaAtk: 10, shields: [], buffs: [], burns: [], fx: {}, cnt: { atk: 0, haber: 0, ramp: 0 },
      st: { stun: 0, taunt: null, hplus: null, oh: null, shA: null, shM: null },
      atkCd: 0.2 + this.rng() * 0.4, acc: this.rng(), alive: true, tgt: null, ccImm: false, items: inst.items || [],
      tr: new Set(def.traits),
    };
    this.grid[idx(c, r)] = u;
    let asM = 0, adM = 0;
    for (const id of u.items) {
      const it = ITEMS[id], s = it.s || {};
      if (s.ad) u.ad += s.ad; if (s.hp) u.maxHp += s.hp; if (s.as) asM += s.as; if (s.ap) u.ap += s.ap;
      if (s.mana) u.mana += s.mana; if (s.armor) u.armor += s.armor; if (s.mr) u.mr += s.mr;
      if (s.crit) u.critC += s.crit; if (s.critD) u.critD += s.critD; if (s.manaAtk) u.manaAtk += s.manaAtk;
      if (it.fx) for (const k in it.fx) u.fx[k] = (u.fx[k] || 0) + it.fx[k];
    }
    const has = t => u.tr.has(t) && tl[t];
    if (has('alkali')) { asM += tv('alkali', 0, tl.alkali) / 100; u.flame = tv('alkali', 1, tl.alkali); }
    if (has('amph')) { const v = tv('amph', 0, tl.amph); u.armor += v; u.mr += v; }
    if (has('metal')) { u.armor += tv('metal', 0, tl.metal); adM += tv('metal', 1, tl.metal) / 100; }
    if (has('organic')) { u.maxHp += tv('organic', 0, tl.organic); u.regen = tv('organic', 1, tl.organic) / 100; }
    if (has('gas')) u.dodge += tv('gas', 0, tl.gas) / 100;
    if (has('coval')) u.dr += tv('coval', 0, tl.coval) / 100;
    if (has('precip')) u.flat += tv('precip', 0, tl.precip);
    if (has('noble')) { u.nobleSh = tv('noble', 0, tl.noble) / 100; if (tl.noble >= 2) u.ccImm = true; }
    if (tl.trans && !def.mob) u.ap += tv('trans', 0, tl.trans) * (u.tr.has('trans') ? 2 : 1);
    if (md.hp) u.maxHp += md.hp; if (md.as) asM += md.as; if (md.adPct) adM += md.adPct; if (md.ap) u.ap += md.ap;
    if (md.mana) u.mana += md.mana;
    if (md.scale) { u.maxHp *= md.scale; u.ad *= md.scale; }
    u.as *= 1 + asM; u.ad *= 1 + adM;
    if (u.maxMana > 0) u.mana = Math.min(u.mana, u.maxMana - 1);
    u.hp = u.maxHp;
    return u;
  }

  startFx(u) {
    const md = this.mods[u.team];
    if (u.nobleSh) this.shield(u, u.maxHp * u.nobleSh, 99);
    if (u.fx.colloid) for (const a of this.around(u.pos, 1, u.team)) this.shield(a, u.fx.colloid, 8);
    if (md.startDr) this.buff(u, 'dr', md.startDr, 8);
  }

  // ---------- 参照ヘルパ ----------
  fx(k, d) { if (this.rec) this.ev.push(Object.assign({ k }, d)); }
  enemies(u) { return this.units.filter(x => x.alive && x.team !== u.team); }
  allies(u, self = true) { return this.units.filter(x => x.alive && x.team === u.team && (self || x !== u)); }
  d(a, b) { return hexDist(a.pos, b.pos); }
  around(pos, r, team) { return this.units.filter(x => x.alive && x.team === team && hexDist(x.pos, pos) <= r); }
  hasAlly(u, id) { return this.units.some(x => x.alive && x.team === u.team && x.def.id === id); }
  bs(u, k) { let s = 0; for (const b of u.buffs) if (b.k === k) s += b.v; return s; }
  asEff(u) { return Math.max(0.2, Math.min(5, u.as * (1 + this.bs(u, 'as')) * (1 - (u.st.oh ? u.st.oh.slow : 0)))); }
  armorEff(u) { return Math.max(0, (u.armor + this.bs(u, 'armor')) * (1 - (u.st.shA ? u.st.shA.pct : 0))); }
  mrEff(u) { return Math.max(0, u.mr * (1 - (u.st.shM ? u.st.shM.pct : 0))); }
  shieldOf(u) { let s = 0; for (const x of u.shields) s += x.a; return s; }

  // ---------- 効果 ----------
  buff(t, k, v, dur) { if (t.alive) t.buffs.push({ k, v, t: dur }); }
  shield(t, a, dur) { if (t.alive && a > 0) { t.shields.push({ a, t: dur }); this.fx('shield', { u: t }); } }
  mana(t, a) { if (t.alive && t.maxMana > 0) t.mana = Math.min(t.maxMana, t.mana + a); }
  heal(src, t, a) { if (!t.alive || a <= 0) return; const h = Math.min(a, t.maxHp - t.hp); t.hp += h; if (h >= 1) this.fx('heal', { u: t, a: h }); }
  stun(src, t, dur) { if (!t.alive) return; if (t.ccImm) { this.fx('text', { u: t, s: '無効', col: '#7fd8ff' }); return; } t.st.stun = Math.max(t.st.stun, dur); this.fx('stun', { u: t }); }
  taunt(src, t, dur) { if (!t.alive || t.ccImm) return; t.st.taunt = { by: src, t: dur }; t.tgt = src; }
  shred(t, pct, dur, which = 'AM') {
    if (!t.alive) return;
    for (const w of which) { const k = w === 'A' ? 'shA' : 'shM'; const c = t.st[k]; if (!c || pct >= c.pct) t.st[k] = { pct, t: dur }; else c.t = Math.max(c.t, 0.01); }
  }
  burn(src, t, dps, dur) { if (t.alive) t.burns.push({ src, dps, t: dur }); }
  cleanse(t) { t.st.hplus = t.st.oh = t.st.shA = t.st.shM = null; t.burns = []; t.buffs = t.buffs.filter(b => b.v > 0); }
  hit(src, t, amt, type = 'magic', o = {}) { o.skill = true; return this.dmg(src, t, amt, type, o); }

  applyIon(src, t, kind) {
    const tl = this.tl[src.team];
    if (kind === 'H') {
      if (t.def.fl.noAcid) return;
      if (t.st.oh) return this.neutral(src, t);
      t.st.hplus = { t: 4, pct: tv('acid', 0, tl.acid) / 100, src };
    } else {
      if (t.st.hplus) return this.neutral(src, t);
      t.st.oh = { t: 4, slow: tv('base', 0, tl.base) / 100 };
    }
  }
  neutral(src, t) {
    t.st.hplus = t.st.oh = null;
    this.fx('text', { u: t, s: '中和!', col: '#fff36b', big: true });
    this.fx('aoe', { pos: t.pos, r: 0, col: '#fff36b' });
    this.dmg(src, t, NEUTRAL.flat + t.maxHp * NEUTRAL.pct / 100, 'magic', { noProc: true });
  }

  dmg(src, t, amt, type, o = {}) {
    if (!t.alive || amt <= 0) return 0;
    if (o.atk && t.dodge + this.bs(t, 'dodge') > 0 && this.rng() < t.dodge + this.bs(t, 'dodge')) { this.fx('text', { u: t, s: 'MISS', col: '#a8f0e0' }); return -1; }
    let a = amt;
    if (type === 'phys') a *= 100 / (100 + this.armorEff(t));
    else if (type === 'magic') a *= 100 / (100 + this.mrEff(t) * (1 - (o.pen || 0)));
    if (!o.pure) {
      a *= 1 - Math.min(0.85, t.dr + this.bs(t, 'dr'));
      if (o.dot) { if (t.fx.dotRes) a *= 1 - t.fx.dotRes; } else if (t.flat) a -= t.flat;
      a = Math.max(1, a);
    }
    const pre = a;
    // シールド
    for (const s of t.shields) { if (a <= 0) break; const x = Math.min(s.a, a); s.a -= x; a -= x; }
    t.shields = t.shields.filter(s => s.a > 0.5);
    t.hp -= a;
    this.fx('dmg', { u: t, a: pre, type, crit: o.crit, dot: o.dot });
    if (!o.dot) this.mana(t, Math.min(15, pre / t.maxHp * 60));
    if (src && src.alive !== undefined && !o.noProc && !o.dot) {
      const tl = this.tl[src.team];
      if (src.tr.has('oxid') && tl.oxid) this.dmg(src, t, pre * tv('oxid', 0, tl.oxid) / 100, 'true', { noProc: true, pure: true });
      if (src.tr.has('halogen') && tl.halogen) this.shred(t, tv('halogen', 0, tl.halogen) / 100, 4);
      if (src.tr.has('acid') && tl.acid) this.applyIon(src, t, 'H');
      if (src.tr.has('base') && tl.base) this.applyIon(src, t, 'O');
      if (o.skill) {
        if (src.fx.burn) this.burn(src, t, t.maxHp * src.fx.burn / 100, 4);
        if (src.fx.svamp) this.heal(src, src, pre * src.fx.svamp);
      }
      if (o.atk) {
        const v = this.bs(src, 'vamp'); if (v) this.heal(src, src, pre * v);
        const th = (t.fx.thorns || 0) + this.bs(t, 'thorns');
        if (th && src.alive) this.dmg(t, src, th, 'magic', { noProc: true });
      }
    }
    if (t.alive && t.fx.buffer && !t.cnt.buf && t.hp > 0 && t.hp < t.maxHp * 0.4) { t.cnt.buf = 1; this.cleanse(t); this.shield(t, t.maxHp * t.fx.buffer, 5); this.fx('text', { u: t, s: '緩衝', col: '#9bf6ff' }); }
    if (t.alive && t.hp <= 0) this.kill(t);
    return pre;
  }
  kill(u) {
    u.alive = false; u.hp = 0; this.grid[idx(u.pos.c, u.pos.r)] = null;
    this.fx('death', { u }); this.checkEnd();
  }
  checkEnd() {
    if (this.over) return;
    const a = this.units.some(u => u.alive && u.team === 0), b = this.units.some(u => u.alive && u.team === 1);
    if (a && b) return;
    this.over = true; this.winner = a ? 0 : b ? 1 : null;
  }
  survivors(team) { return this.units.filter(u => u.alive && u.team === team); }

  // ---------- 進行 ----------
  step(dt = TICK) {
    if (this.over) return;
    this.t += dt;
    for (const u of this.units) { if (u.alive) this.tick(u, dt); if (this.over) return; }
    if (this.t >= TIME_LIMIT) { this.over = true; this.winner = null; }
  }
  run() { let n = 0; while (!this.over && n++ < 5000) this.step(TICK); return this; }

  tick(u, dt) {
    u.atkCd -= dt;
    if (u.buffs.length) { for (const b of u.buffs) b.t -= dt; u.buffs = u.buffs.filter(b => b.t > 0); }
    if (u.shields.length) { for (const s of u.shields) s.t -= dt; u.shields = u.shields.filter(s => s.t > 0); }
    const st = u.st;
    if (st.stun > 0) st.stun -= dt;
    for (const k of ['hplus', 'oh', 'shA', 'shM', 'taunt']) if (st[k] && (st[k].t -= dt) <= 0) st[k] = null;
    u.acc += dt;
    if (u.acc >= 1) { u.acc -= 1; this.second(u); if (!u.alive || this.over) return; }
    if (u.moveT > 0) { u.moveT -= dt; if (u.moveT > 0) return; }
    if (st.stun > 0) return;

    let t = null;
    if (st.taunt && st.taunt.by.alive) t = st.taunt.by;
    else if (u.tgt && u.tgt.alive && this.d(u, u.tgt) <= u.range) t = u.tgt;
    else {
      let bd = 99;
      for (const e of this.units) if (e.alive && e.team !== u.team) { const d = this.d(u, e); if (d < bd) { bd = d; t = e; } }
    }
    if (!t) return;
    u.tgt = t;
    const inR = this.d(u, t) <= u.range, sk = u.def.skill;
    if (sk && u.maxMana > 0 && u.mana >= u.maxMana && (inR || sk.noTgt || sk.global)) return this.cast(u, sk);
    if (inR) { if (u.atkCd <= 0) this.attack(u, t); }
    else this.move(u, t);
  }

  second(u) {
    const st = u.st;
    if (st.hplus) this.dmg(st.hplus.src, u, u.maxHp * st.hplus.pct, 'magic', { dot: true });
    if (!u.alive) return;
    if (u.burns.length) {
      for (const b of u.burns) { this.dmg(b.src, u, b.dps, 'magic', { dot: true }); b.t -= 1; if (!u.alive) return; }
      u.burns = u.burns.filter(b => b.t > 0);
    }
    if (u.regen) this.heal(u, u, u.maxHp * u.regen);
    if (u.fx.regenMiss) this.heal(u, u, (u.maxHp - u.hp) * u.fx.regenMiss);
    if (u.fx.haber && u.cnt.haber < 15) { u.cnt.haber++; this.buff(u, 'adp', u.fx.haber, 999); }
    if (u.def.fl.polymer && (u.cnt.poly = (u.cnt.poly || 0) + 1) % 2 === 0) { const g = u.maxHp * 0.03; u.maxHp += g; u.hp += g; u.ad *= 1.02; }
  }

  attack(u, t) {
    u.atkCd = 1 / this.asEff(u); u.cnt.atk++;
    this.fx('atk', { a: u, b: t, ranged: u.range > 1 });
    let d = u.ad * (1 + this.bs(u, 'adp')); const crit = this.rng() < u.critC; if (crit) d *= u.critD;
    const res = this.dmg(u, t, d, 'phys', { atk: true, crit });
    this.mana(u, u.manaAtk);
    const tl = this.tl[u.team];
    if (u.tr.has('reduc') && tl.reduc) {
      let best = null, br = 2;
      for (const a of this.allies(u, false)) if (a.maxMana > 0) { const r = a.mana / a.maxMana; if (r < br) { br = r; best = a; } }
      if (best) this.mana(best, tv('reduc', 0, tl.reduc));
    }
    if (res < 0) return;
    const on = this.bs(u, 'onhit') + (u.flame || 0);
    if (on && t.alive) this.dmg(u, t, on, 'magic', { noProc: true });
    if (u.fx.splash) for (const e of this.around(t.pos, 1, t.team)) if (e !== t) this.dmg(u, e, d * u.fx.splash, 'phys', { noProc: true });
    if (u.fx.sunder && t.alive) this.shred(t, u.fx.sunder, 3, 'A');
    if (u.fx.ramp && u.cnt.ramp < 15) { u.cnt.ramp++; this.buff(u, 'as', u.fx.ramp, 999); }
    if (u.fx.chain && u.cnt.atk % 3 === 0) {
      const es = this.enemies(u).sort((a, b) => hexDist(a.pos, t.pos) - hexDist(b.pos, t.pos)).slice(0, 3);
      let p = u; for (const e of es) { this.fx('beam', { a: p, b: e, col: '#ffe14d' }); this.dmg(u, e, u.fx.chain * u.ap / 100, 'magic', { noProc: true }); p = e; }
    }
  }

  cast(u, sk) {
    u.mana = 0; u.atkCd = Math.max(u.atkCd, 0.4);
    this.fx('cast', { u, s: sk.n });
    const sm = u.star - 1;
    sk.cast(u, this, i => sk.v[i][sm] * u.ap / 100, i => sk.v[i][sm]);
    if (u.fx.apCast) u.ap += u.fx.apCast;
  }

  move(u, t) {
    const start = idx(u.pos.c, u.pos.r), par = new Int8Array(COLS * ROWS).fill(-1), q = [start];
    par[start] = start;
    let goal = -1, best = start, bd = hexDist(u.pos, t.pos);
    for (let h = 0; h < q.length; h++) {
      const cur = q[h], d = hexDist(POS[cur], t.pos);
      if (d <= u.range) { goal = cur; break; }
      if (d < bd) { bd = d; best = cur; }
      for (const n of NB[cur]) if (par[n] < 0 && !this.grid[n]) { par[n] = cur; q.push(n); }
    }
    let cell = goal >= 0 ? goal : best;
    if (cell === start) return;
    while (par[cell] !== start) cell = par[cell];
    this.grid[start] = null; this.grid[cell] = u;
    u.prev = u.pos; u.pos = POS[cell]; u.moveT = MOVE_T;
  }
}
