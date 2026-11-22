// ============================================================
//  ゲーム進行（経済・ショップ・ラウンド・ライバルAI）
// ============================================================
import { UNITS, BY_COST, TRAITS, ITEMS, COMPS, FULL_ITEMS, AUGS, BOT_NAMES, combine, countTraits, traitTier } from './data.js';
import { Battle, COLS } from './combat.js';

export const BENCH = 9, MAX_LEVEL = 9;
export const XP_NEED = [0, 2, 4, 6, 10, 20, 36, 56, 84]; // XP_NEED[L] : L→L+1
export const ODDS = [null,
  [100, 0, 0, 0, 0], [100, 0, 0, 0, 0], [75, 25, 0, 0, 0], [55, 30, 15, 0, 0], [45, 33, 20, 2, 0],
  [30, 40, 25, 5, 0], [19, 30, 35, 15, 1], [15, 20, 32, 28, 5], [10, 15, 25, 35, 15]];
const POOL_N = [0, 22, 18, 15, 10, 8];
const STAGE_DMG = [0, 1, 2, 4, 6, 9, 13, 18, 25];
export const DIFFS = { easy: { n: 'やさしい', g: -1 }, normal: { n: 'ふつう', g: 0 }, hard: { n: 'むずかしい', g: 2 } };

let UID = 1;
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const sellValue = u => { const c = UNITS[u.id].cost, n = 3 ** (u.star - 1); return c * n - (u.star > 1 && c > 1 ? 1 : 0); };
export const unitPower = u => (UNITS[u.id].cost ** 1.15) * [1, 2.1, 4.8][u.star - 1] * 10 + u.items.length * 9;

export class Game {
  // opts.seats: 人間の席 [{name}, ...]（先頭から順に席0,1,…）。省略時はソロ（席0のみ人間）
  // opts.online: true のとき全戦闘を開始時に解決し（ホスト権威）、最後の1人まで続ける
  constructor(opts = {}) {
    this.opts = Object.assign({ diff: 'normal', timer: true, online: false, seats: null }, opts);
    this.pool = {};
    for (let c = 1; c <= 5; c++) for (const id of BY_COST[c - 1]) this.pool[id] = POOL_N[c];
    const names = shuffle(BOT_NAMES.slice());
    this.players = [];
    const seats = this.opts.seats || [{ name: 'あなた' }];
    for (let i = 0; i < 8; i++) this.players.push(this.newPlayer(i, seats[i] ? seats[i].name : names[i], !seats[i]));
    this.me = this.players[0];
    this.stage = 1; this.round = 0; this.phase = 'init'; this.fights = []; this.battle = null;
    this.log = []; this.over = false; this.place = 0;
    for (const p of this.players) { this.addUnit(p, this.draw(1)); p.gold = 3; }
    this.nextRound();
  }

  newPlayer(id, name, bot) {
    const p = { id, name, bot, hp: 100, gold: 0, level: 1, xp: 0, board: [], bench: new Array(BENCH).fill(null), items: [],
      shop: [null, null, null, null, null], lock: false, streak: 0, alive: true, augs: [], mods: {}, intCap: 5, rerollCost: 2,
      extraSlot: 0, dmgCut: 0, lastOpp: -1, place: 0, fav: [],
      human: !bot, away: false, ready: false, pendingAug: null, opp: null, lastResult: null };
    if (bot) { const ks = shuffle(Object.keys(TRAITS)); p.fav = ks.slice(0, 3); }
    return p;
  }

  // ---------- 人間の席（ソロでは席0のみ） ----------
  get pendingAug() { return this.me.pendingAug; }
  set pendingAug(v) { this.me.pendingAug = v; }
  get lastResult() { return this.me.lastResult; }
  get opponent() { return this.oppOf(this.me); }
  oppOf(p) { return p && p.opp != null ? this.players[p.opp] : null; }
  humans() { return this.players.filter(p => p.human); }
  // 切断した人間はライバルAIが代行する（次の準備フェーズから）
  takeover(p) {
    p.bot = true;
    if (!p.fav.length) p.fav = shuffle(Object.keys(TRAITS)).slice(0, 3);
    if (p.pendingAug) { this.takeAug(p, pick(p.pendingAug)); p.pendingAug = null; }
  }
  resume(p) { p.away = false; p.bot = false; }

  // ---------- ラウンド構成 ----------
  roundsIn(stage) { return stage === 1 ? 3 : 6; }
  isPvE(stage = this.stage, round = this.round) { return stage === 1 || round === 6; }
  get label() { return `${this.stage}-${this.round}`; }
  planTime() { return this.stage === 1 ? 25 : 40; }

  nextRound() {
    if (this.over) return;
    const first = this.round === 0;
    this.round++;
    if (this.round > this.roundsIn(this.stage)) { this.stage++; this.round = 1; }
    for (const p of this.players) { p.lastResult = null; p.ready = false; }
    for (const p of this.alive()) if (p.human && p.away && !p.bot) this.takeover(p);
    for (const p of this.alive()) {
      if (!first) { this.income(p); this.addXP(p, 2); }
      if (!p.lock || first) this.rollShop(p); p.lock = false;
    }
    if (this.round === 1 && this.stage >= 2 && this.stage <= 4) {
      for (const p of this.alive()) if (p.bot) this.takeAug(p, pick(AUGS.filter(a => !p.augs.includes(a.id))));
      for (const p of this.alive()) if (!p.bot) p.pendingAug = shuffle(AUGS.filter(a => !p.augs.includes(a.id))).slice(0, 3);
    }
    for (const p of this.alive()) if (p.bot) this.botTurn(p);
    this.makeFights();
    this.phase = 'plan';
  }

  alive() { return this.players.filter(p => p.alive); }
  maxUnits(p) { return p.level + p.extraSlot; }

  income(p) {
    const base = this.stage === 1 ? 3 : 5;
    const interest = Math.min(p.intCap, Math.floor(p.gold / 10));
    const s = Math.abs(p.streak), streak = s >= 5 ? 3 : s >= 4 ? 2 : s >= 2 ? 1 : 0;
    const bonus = !p.human ? Math.max(0, DIFFS[this.opts.diff].g) : 0;
    const pen = !p.human && DIFFS[this.opts.diff].g < 0 && this.stage > 1 ? 1 : 0;
    p.lastIncome = { base, interest, streak };
    p.gold += base + interest + streak + bonus - pen;
  }
  addXP(p, n) {
    p.xp += n;
    while (p.level < MAX_LEVEL && p.xp >= XP_NEED[p.level]) { p.xp -= XP_NEED[p.level]; p.level++; }
    if (p.level >= MAX_LEVEL) p.xp = 0;
  }
  buyXP(p) { if (p.gold < 4 || p.level >= MAX_LEVEL) return false; p.gold -= 4; this.addXP(p, 4); return true; }
  takeAug(p, a) {
    if (!a) return; p.augs.push(a.id);
    if (a.mods) for (const k in a.mods) p.mods[k] = (p.mods[k] || 0) + a.mods[k];
    if (a.now) a.now(p, this);
  }
  chooseAug(i, p = this.me) { const a = p.pendingAug && p.pendingAug[i]; if (!a) return false; this.takeAug(p, a); p.pendingAug = null; return true; }
  randComp() { return pick(COMPS); }

  // ---------- ショップ ----------
  draw(cost) {
    const ids = BY_COST[cost - 1].filter(id => this.pool[id] > 0);
    if (!ids.length) return null;
    let tot = 0; for (const id of ids) tot += this.pool[id];
    let x = Math.random() * tot;
    for (const id of ids) { x -= this.pool[id]; if (x < 0) { this.pool[id]--; return id; } }
    this.pool[ids[0]]--; return ids[0];
  }
  rollShop(p) {
    for (const id of p.shop) if (id) this.pool[id]++;
    const odds = ODDS[p.level];
    p.shop = p.shop.map(() => {
      let x = Math.random() * 100, c = 1;
      for (let i = 0; i < 5; i++) { x -= odds[i]; if (x < 0) { c = i + 1; break; } }
      let id = null; for (let k = c; k >= 1 && !id; k--) id = this.draw(k);
      return id;
    });
  }
  reroll(p) { if (p.gold < p.rerollCost) return false; p.gold -= p.rerollCost; this.rollShop(p); return true; }

  allUnits(p) { return p.board.concat(p.bench.filter(Boolean)); }
  benchFree(p) { return p.bench.indexOf(null); }
  canBuy(p, slot) {
    const id = p.shop[slot]; if (!id) return false;
    if (p.gold < UNITS[id].cost) return false;
    if (this.benchFree(p) >= 0) return true;
    return this.allUnits(p).filter(u => u.id === id && u.star === 1).length >= 2; // 合成で枠が空く
  }
  buy(p, slot) {
    if (!this.canBuy(p, slot)) return false;
    const id = p.shop[slot]; p.gold -= UNITS[id].cost; p.shop[slot] = null;
    this.addUnit(p, id); return true;
  }
  addUnit(p, id, star = 1) {
    if (!id) return null;
    const u = { uid: UID++, id, star, items: [] };
    const i = this.benchFree(p);
    if (i >= 0) p.bench[i] = u; else p.overflow = u;
    this.merge(p);
    if (p.overflow) { // 合成されなかった場合は売却扱い
      const o = p.overflow; p.overflow = null;
      if (this.allUnits(p).indexOf(o) < 0 && !o.merged) { p.gold += sellValue(o); this.pool[o.id] += 3 ** (o.star - 1); }
    }
    return u;
  }
  merge(p) {
    for (let again = true; again;) {
      again = false;
      const all = this.allUnits(p).concat(p.overflow ? [p.overflow] : []), g = {};
      for (const u of all) if (u.star < 3) (g[u.id + ':' + u.star] ||= []).push(u);
      for (const k in g) {
        if (g[k].length < 3) continue;
        const grp = g[k].sort((a, b) => (p.board.includes(b) ? 1 : 0) - (p.board.includes(a) ? 1 : 0)).slice(0, 3);
        const keep = grp[0];
        for (const x of grp.slice(1)) {
          for (const it of x.items) { if (keep.items.length < 3) keep.items.push(it); else p.items.push(it); }
          this.removeUnit(p, x); x.merged = true;
        }
        if (p.overflow === keep) { p.overflow = null; const i = this.benchFree(p); p.bench[i] = keep; }
        keep.star++; keep.justMerged = Date.now(); again = true; this.fixItems(p, keep); break;
      }
    }
  }
  fixItems(p, u) { // 合成で素材が2つ重なったら完成品にする
    for (let ch = true; ch;) {
      ch = false; const cs = u.items.filter(i => ITEMS[i].comp);
      if (cs.length >= 2) { const a = cs[0], b = cs[1]; u.items.splice(u.items.indexOf(a), 1); u.items.splice(u.items.indexOf(b), 1); u.items.push(combine(a, b)); ch = true; }
    }
  }
  removeUnit(p, u) {
    if (p.overflow === u) { p.overflow = null; return; }
    let i = p.board.indexOf(u); if (i >= 0) { p.board.splice(i, 1); return; }
    i = p.bench.indexOf(u); if (i >= 0) p.bench[i] = null;
  }
  sell(p, u) {
    if (this.allUnits(p).indexOf(u) < 0) return false;
    p.gold += sellValue(u); this.pool[u.id] += 3 ** (u.star - 1);
    for (const it of u.items) p.items.push(it);
    this.removeUnit(p, u); return true;
  }

  // ---------- 配置 ----------
  at(p, c, r) { return p.board.find(u => u.c === c && u.r === r); }
  // dest: {board:true,c,r} or {bench:i}
  move(p, u, dest) {
    const fromBoard = p.board.includes(u), fromBench = p.bench.indexOf(u);
    if (dest.board) {
      if (dest.r < 0 || dest.r > 3 || dest.c < 0 || dest.c >= COLS) return 'x';
      const o = this.at(p, dest.c, dest.r);
      if (o === u) return 'ok';
      if (fromBoard) { if (o) { o.c = u.c; o.r = u.r; } u.c = dest.c; u.r = dest.r; return 'ok'; }
      if (o) { p.board.splice(p.board.indexOf(o), 1); p.bench[fromBench] = o; delete o.c; delete o.r; }
      else { if (p.board.length >= this.maxUnits(p)) return 'full'; p.bench[fromBench] = null; }
      u.c = dest.c; u.r = dest.r; p.board.push(u); return 'ok';
    }
    const o = p.bench[dest.bench];
    if (o === u) return 'ok';
    if (fromBoard) {
      p.board.splice(p.board.indexOf(u), 1);
      if (o) { o.c = u.c; o.r = u.r; p.board.push(o); }
      delete u.c; delete u.r; p.bench[dest.bench] = u; return 'ok';
    }
    p.bench[fromBench] = o; p.bench[dest.bench] = u; return 'ok';
  }
  equip(p, itemIdx, u) {
    const it = p.items[itemIdx]; if (!it || UNITS[u.id].mob) return 'x';
    if (ITEMS[it].comp) {
      const ci = u.items.findIndex(x => ITEMS[x].comp);
      if (ci >= 0) { u.items[ci] = combine(u.items[ci], it); p.items.splice(itemIdx, 1); return 'combined'; }
    }
    if (u.items.length >= 3) return 'full';
    u.items.push(it); p.items.splice(itemIdx, 1); return 'ok';
  }
  autoFill(p) {
    const cells = [];
    for (const r of [3, 2, 1, 0]) for (const c of [3, 2, 4, 1, 5, 0, 6]) cells.push([c, r]);
    while (p.board.length < this.maxUnits(p)) {
      const cand = p.bench.filter(Boolean).sort((a, b) => unitPower(b) - unitPower(a))[0];
      if (!cand) break;
      const melee = UNITS[cand.id].range === 1;
      const order = melee ? cells.slice().reverse() : cells;
      const cell = order.find(([c, r]) => !this.at(p, c, r)); if (!cell) break;
      this.move(p, cand, { board: true, c: cell[0], r: cell[1] });
    }
  }
  traits(p) { return countTraits(p.board); }

  // ---------- 対戦カード ----------
  pveTeam() {
    const s = this.stage, r = this.round, units = [];
    const add = (id, c, rr) => units.push({ id, star: 1, items: [], c, r: rr });
    if (s === 1) {
      if (r === 1) { add('m_dust', 2, 0); add('m_dust', 4, 0); }
      else if (r === 2) { add('m_dust', 1, 0); add('m_dust', 3, 0); add('m_dust', 5, 0); }
      else { add('m_rust', 2, 0); add('m_rust', 4, 0); add('m_dust', 3, 1); add('m_rain', 3, 3); }
      return { units, mods: {} };
    }
    add('m_smog', 3, 0); add('m_rust', 1, 0); add('m_rust', 5, 0); add('m_rain', 2, 3); add('m_rain', 4, 3);
    if (s >= 4) { add('m_smog', 3, 1); }
    return { units, mods: { scale: 1 + (s - 2) * 0.85 } };
  }
  teamOf(p) { return { units: p.board.map(u => ({ id: u.id, star: u.star, items: u.items.slice(), c: u.c, r: u.r })), mods: p.mods }; }

  makeFights() {
    this.fights = [];
    const al = this.alive();
    if (this.isPvE()) { for (const p of al) this.fights.push({ a: p, b: null, pve: true }); }
    else {
      let best = null;
      for (let k = 0; k < 12; k++) { // 直前と同じ相手をなるべく避ける
        const o = shuffle(al.slice()); let bad = 0;
        for (let i = 0; i + 1 < o.length; i += 2) if (o[i].lastOpp === o[i + 1].id) bad++;
        if (!best || bad < best.bad) best = { o, bad }; if (!bad) break;
      }
      const o = best.o;
      for (let i = 0; i + 1 < o.length; i += 2) this.fights.push({ a: o[i], b: o[i + 1] });
      if (o.length % 2) { const last = o[o.length - 1]; this.fights.push({ a: last, b: pick(o.filter(x => x !== last)), ghost: true }); }
    }
    for (const p of this.players) p.opp = null;
    for (const f of this.fights) if (!f.pve) { f.a.opp = f.b.id; if (!f.ghost) f.b.opp = f.a.id; }
  }
  fightOf(p) { return this.fights.find(f => f.a === p || (f.b === p && !f.ghost)); }
  myFight() { return this.fightOf(this.me); }

  startCombat() {
    if (this.phase !== 'plan') return;
    for (const p of this.alive()) if (!p.bot) this.autoFill(p);
    this.phase = 'combat';
    const mf = this.myFight();
    for (const f of this.fights) {
      const mine = f === mf;
      // 自分の戦闘は常に自分がチーム0(下側)になるようにする
      if (mine && f.b === this.me) { const t = f.a; f.a = f.b; f.b = t; }
      const A = this.teamOf(f.a), B = f.pve ? this.pveTeam() : this.teamOf(f.b);
      f.seed = rnd(1e9);
      if (this.opts.online) { // ホスト権威：全戦闘をここで確定させる（各端末は同じ A,B,seed で再生する）
        f.A = JSON.parse(JSON.stringify(A)); f.B = JSON.parse(JSON.stringify(B));
        f.battle = new Battle(f.A, f.B, f.seed, false).run();
        continue;
      }
      f.battle = new Battle(A, B, f.seed, mine);
      if (mine) this.battle = f.battle; else f.battle.run();
    }
  }

  dmgTo(loser, survivors) {
    let d = STAGE_DMG[Math.min(this.stage, STAGE_DMG.length - 1)];
    for (const u of survivors) d += u.def.mob ? 1 : [1, 2, 4][u.star - 1] + (u.def.cost >= 4 ? 1 : 0);
    return Math.max(1, d - loser.dmgCut);
  }

  finishCombat() {
    if (this.phase !== 'combat') return;
    const before = this.alive().map(p => ({ p, hp: p.hp }));
    for (const f of this.fights) {
      const b = f.battle, w = b.winner;
      const res = (p, team, real) => {
        if (!p || !real) return;
        const win = w === team, lose = w === 1 - team || w === null;
        let dmg = 0;
        if (lose) { dmg = this.dmgTo(p, b.survivors(1 - team)); if (w === null) dmg = Math.ceil(dmg / 2); p.hp -= dmg; }
        if (!f.pve) {
          p.streak = win ? Math.max(1, p.streak + 1) : Math.min(-1, p.streak - 1);
          if (win) p.gold += 1;
          const o = team === 0 ? f.b : f.a; p.lastOpp = o.id;
        }
        p.lastResult = { win, draw: w === null, dmg, opp: f.pve ? '実験' : (team === 0 ? f.b : f.a).name, loot: [] };
      };
      res(f.a, 0, true); res(f.b, 1, !f.ghost && !f.pve);
    }
    if (this.isPvE()) {
      for (const p of this.alive()) {
        const loot = this.loot();
        for (const it of loot.items) p.items.push(it);
        p.gold += loot.gold;
        if (p.lastResult) p.lastResult.loot = loot;
        if (p.bot) this.botItems(p);
      }
    }
    // 脱落処理(同時脱落はHPが高かった方が上位)
    const dead = before.filter(x => x.p.hp <= 0).sort((a, b) => a.hp - b.hp || (a.p.human ? 1 : -1));
    let n = this.alive().length;
    for (const { p } of dead) {
      p.alive = false; p.hp = 0; p.place = n--;
      for (const u of this.allUnits(p)) this.pool[u.id] += 3 ** (u.star - 1);
      for (const id of p.shop) if (id) this.pool[id]++;
      p.shop = p.shop.map(() => null);
    }
    this.battle = null; this.phase = 'result';
    if (this.opts.online) { // オンライン：最後の1人まで順位を決める
      const al = this.alive();
      if (al.length <= 1) { this.over = true; if (al[0]) al[0].place = 1; this.place = this.me.place; }
    } else if (!this.me.alive) { this.over = true; this.place = this.me.place; }
    else if (this.alive().length === 1) { this.over = true; this.place = 1; this.me.place = 1; }
  }
  loot() {
    const s = this.stage, r = this.round, items = [];
    if (s === 1) { items.push(this.randComp()); return { items, gold: r === 2 ? 2 : r === 3 ? 3 : 0 }; }
    items.push(this.randComp(), this.randComp());
    if (s >= 4) items.push(pick(FULL_ITEMS));
    return { items, gold: 2 };
  }

  // ---------- ライバルAI ----------
  botScore(p, id) {
    const d = UNITS[id], own = this.allUnits(p).filter(u => u.id === id && u.star < 3);
    let s = d.cost * 0.6;
    const n1 = own.filter(u => u.star === 1).length;
    if (own.length) s += 3.5; if (n1 % 3 === 2) s += 3;
    for (const t of d.traits) { if (p.fav.includes(t)) s += 2.2; }
    const cnt = this.traits(p);
    for (const t of d.traits) { const c = cnt[t] || 0; if (!own.length && traitTier(t, c + 1) > traitTier(t, c)) s += 2; }
    return s;
  }
  botTurn(p) {
    const st = this.stage;
    const want = st === 1 ? 3 : st === 2 ? (this.round >= 4 ? 5 : 4) : st === 3 ? (this.round >= 3 ? 6 : 5) : st === 4 ? 7 : st === 5 ? 8 : 9;
    const reserve = p.hp < 35 ? 0 : st <= 1 ? 0 : st === 2 ? 10 : st === 3 ? 20 : 30;
    const shopPass = () => {
      const order = [0, 1, 2, 3, 4].filter(i => p.shop[i]).sort((a, b) => this.botScore(p, p.shop[b]) - this.botScore(p, p.shop[a]));
      for (const i of order) {
        const id = p.shop[i], sc = this.botScore(p, id), cost = UNITS[id].cost;
        const need = this.allUnits(p).length < this.maxUnits(p) + 1;
        if (!(sc >= 4 || need)) continue;
        if (p.gold < cost) continue;
        if (sc < 6.5 && !need && p.gold - cost < reserve) continue;
        if (this.benchFree(p) < 0 && !this.canBuy(p, i)) this.botSellWorst(p);
        this.buy(p, i);
      }
    };
    shopPass();
    while (p.level < want && p.level < MAX_LEVEL && p.gold >= 4 + Math.min(reserve, 10)) this.buyXP(p);
    let n = 0;
    while (p.gold >= reserve + p.rerollCost + 3 && n++ < 8) { this.reroll(p); shopPass(); }
    if (p.gold > 60) while (p.level < MAX_LEVEL && p.gold >= 54) this.buyXP(p);
    this.botArrange(p);
    this.botItems(p);
  }
  botSellWorst(p) {
    const b = p.bench.filter(Boolean).sort((x, y) => (unitPower(x) + this.botScore(p, x.id) * 3) - (unitPower(y) + this.botScore(p, y.id) * 3))[0];
    if (b) this.sell(p, b);
  }
  botArrange(p) {
    const all = this.allUnits(p), N = this.maxUnits(p), sel = [], cnt = {}, ids = new Set();
    const pool = all.slice();
    while (sel.length < N && pool.length) {
      let best = null, bs = -1e9;
      for (const u of pool) {
        let s = unitPower(u);
        if (ids.has(u.id)) s -= 12;
        else for (const t of UNITS[u.id].traits) { const c = cnt[t] || 0; s += traitTier(t, c + 1) > traitTier(t, c) ? 26 : 5; }
        if (s > bs) { bs = s; best = u; }
      }
      pool.splice(pool.indexOf(best), 1); sel.push(best);
      if (!ids.has(best.id)) { ids.add(best.id); for (const t of UNITS[best.id].traits) cnt[t] = (cnt[t] || 0) + 1; }
    }
    // いったん全員ベンチへ → 配置し直し
    const rest = all.filter(u => !sel.includes(u));
    p.board = []; p.bench = new Array(BENCH).fill(null);
    rest.slice(0, BENCH).forEach((u, i) => { delete u.c; delete u.r; p.bench[i] = u; });
    for (const u of rest.slice(BENCH)) { p.gold += sellValue(u); this.pool[u.id] += 3 ** (u.star - 1); }
    const colsF = [3, 2, 4, 1, 5, 0, 6], side = Math.random() < 0.5 ? [6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6];
    const front = sel.filter(u => UNITS[u.id].range === 1).sort((a, b) => UNITS[b.id].hp * b.star - UNITS[a.id].hp * a.star);
    const back = sel.filter(u => UNITS[u.id].range > 1);
    const slots = (rows, cols) => { const o = []; for (const r of rows) for (const c of cols) o.push([c, r]); return o; };
    const fs = slots([0, 1, 2, 3], colsF), bk = slots([3, 2, 1, 0], side);
    const used = new Set();
    const put = (u, list) => { const s = list.find(([c, r]) => !used.has(c + ',' + r)); used.add(s[0] + ',' + s[1]); u.c = s[0]; u.r = s[1]; p.board.push(u); };
    front.forEach(u => put(u, fs)); back.forEach(u => put(u, bk));
  }
  botItems(p) {
    for (let guard = 0; guard < 20 && p.items.length; guard++) {
      const us = p.board.slice().sort((a, b) => unitPower(b) - unitPower(a));
      const comps = p.items.filter(i => ITEMS[i].comp);
      let it;
      if (comps.length >= 2) { const a = comps[0], b = comps[1]; p.items.splice(p.items.indexOf(a), 1); p.items.splice(p.items.indexOf(b), 1); it = combine(a, b); }
      else { const fi = p.items.findIndex(i => !ITEMS[i].comp); if (fi < 0) break; it = p.items.splice(fi, 1)[0]; }
      const u = us.find(x => x.items.length < 3);
      if (!u) { p.items.push(it); break; }
      u.items.push(it);
    }
  }
}
