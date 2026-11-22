// ============================================================
//  プレイヤー操作（インテント）の検証と適用
//  ソロでもオンラインでも同じ関数を通す。オンラインではホストが
//  各プレイヤーの状態に対して検証・適用し、クライアントは同じ関数で予測表示する。
// ============================================================
import { COLS } from './combat.js';
import { BENCH } from './game.js';

const I = Number.isInteger;
const inR = (v, lo, hi) => I(v) && v >= lo && v <= hi;

/**
 * @param {import('./game.js').Game} G
 * @param {object} p   操作するプレイヤー（呼び出し側が席を確定させること）
 * @param {object} it  { t: 'buy'|'sell'|'roll'|'xp'|'lock'|'move'|'equip'|'aug'|'ready', ... }
 * @returns 失敗時 false。成功時は真値（move/equip はゲーム側の結果文字列）
 */
export function applyIntent(G, p, it) {
  if (!it || typeof it !== 'object' || !p || !p.alive || G.over || G.phase === 'init') return false;
  const plan = G.phase === 'plan';
  const unit = uid => (I(uid) ? G.allUnits(p).find(u => u.uid === uid) : null);
  switch (it.t) {
    case 'buy': return inR(it.slot, 0, 4) && G.buy(p, it.slot);
    case 'sell': {
      const u = unit(it.uid); if (!u || (!plan && p.board.includes(u))) return false;
      return G.sell(p, u);
    }
    case 'roll': return G.reroll(p);
    case 'xp': return G.buyXP(p);
    case 'lock': p.lock = !!it.on; return true;
    case 'move': {
      const u = unit(it.uid), d = it.to; if (!u || !d || typeof d !== 'object') return false;
      if (d.board) {
        if (!plan || !inR(d.c, 0, COLS - 1) || !inR(d.r, 0, 3)) return false;
        const r = G.move(p, u, { board: true, c: d.c, r: d.r }); return r === 'ok' ? r : r === 'full' ? 'full' : false;
      }
      if (!inR(d.bench, 0, BENCH - 1)) return false;
      if (!plan && p.board.includes(u)) return false;
      return G.move(p, u, { bench: d.bench }) === 'ok' ? 'ok' : false;
    }
    case 'equip': {
      const u = unit(it.uid); if (!u || !inR(it.ii, 0, p.items.length - 1)) return false;
      const r = G.equip(p, it.ii, u); return r === 'x' ? false : r;
    }
    case 'aug': return inR(it.i, 0, 2) && G.chooseAug(it.i, p);
    case 'ready': if (!plan) return false; p.ready = !!it.on; return true;
  }
  return false;
}
/** 状態を変えたか（'full' は変化なし） */
export const changed = r => !!r && r !== 'full';
