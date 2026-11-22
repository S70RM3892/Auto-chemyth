// ============================================================
//  やりこみ要素：研究記録（端末に保存）
//  研究ポイント(RP)、発見した物質・反応、クイズの正誤、実績、スキン
// ============================================================
import { UNIT_IDS } from './data.js';
import { REACTIONS } from './reactions.js';

const KEY = 'autochemyth.profile.v1';
const blank = () => ({ rp: 0, total: 0, units: {}, rx: {}, quiz: {}, ach: {}, own: { 'b:lab': 1, 'm:stick': 1 }, eq: { b: 'lab', m: 'stick' }, st: { games: 0, wins: 0, top4: 0, best: 9, right: 0, star3: 0 }, opt: { quiz: true } });
export const P = Object.assign(blank(), (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
for (const k of ['own', 'eq', 'st', 'opt']) P[k] = Object.assign(blank()[k], P[k]);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* 保存できなくても遊べる */ } };

/** 反応台スキン（色は 0xRRGGBB） */
export const BOARDS = [
  { id: 'lab', n: 'CHEMYTH LAB', d: '標準の反応場。燐青と深紅。', cost: 0, ally: 0x39d9ff, enemy: 0xff3d6e, tA: 0x0a2638, tE: 0x2e0f1c, bg: 0x05080e, ring: 0x39d9ff },
  { id: 'abyss', n: '深海ラボ', d: '海底熱水噴出孔の観測基地。翡翠と琥珀。', cost: 300, ally: 0x39ffb0, enemy: 0xff9a3d, tA: 0x08302a, tE: 0x33200a, bg: 0x02100f, ring: 0x39ffb0 },
  { id: 'solar', n: '太陽炉', d: '集光炉の制御室。金色と緋色。', cost: 600, ally: 0xffc93d, enemy: 0xff4a3d, tA: 0x33280a, tE: 0x330d0a, bg: 0x0d0703, ring: 0xffc93d },
  { id: 'orbit', n: '軌道ステーション', d: '無重力結晶成長モジュール。菫と桃。', cost: 1000, ally: 0xb596ff, enemy: 0xff6fd8, tA: 0x1c1440, tE: 0x3a1033, bg: 0x070512, ring: 0xb596ff },
  { id: 'mono', n: '無塵室', d: 'クリーンルームの白い光。', cost: 1500, ally: 0xeaf6ff, enemy: 0xff5d73, tA: 0x1e2630, tE: 0x30161c, bg: 0x0a0c10, ring: 0xeaf6ff },
];
/** 分子の表示様式 */
export const MOLS = [
  { id: 'stick', n: '球棒モデル', d: '原子を球、結合を棒で表す。結合の向きが分かりやすい。', cost: 0 },
  { id: 'fill', n: '空間充填モデル', d: '原子を実際の大きさの比に近い球で表す。分子の形と大きさが分かる。', cost: 400 },
  { id: 'neon', n: 'ネオン線画', d: '発光する骨格だけを描くホログラム表示。', cost: 800 },
];
export const ACHS = [
  { id: 'first', n: '初めての実験', d: 'ゲームを1回最後まで遊ぶ', rp: 50, ok: () => P.st.games >= 1 },
  { id: 'top4', n: '上位入賞', d: '4位以内に入る', rp: 80, ok: () => P.st.top4 >= 1 },
  { id: 'win', n: '元素盤の覇者', d: '1位になる', rp: 200, ok: () => P.st.wins >= 1 },
  { id: 'win5', n: '常勝の研究室', d: '1位を5回とる', rp: 500, ok: () => P.st.wins >= 5 },
  { id: 'u20', n: '標本収集家', d: '物質を20種発見する', rp: 80, ok: () => Object.keys(P.units).length >= 20 },
  { id: 'u50', n: '試薬棚の主', d: '物質を50種発見する', rp: 200, ok: () => Object.keys(P.units).length >= 50 },
  { id: 'uall', n: '全物質発見', d: 'すべての物質を発見する', rp: 600, ok: () => UNIT_IDS.every(i => P.units[i]) },
  { id: 'r10', n: '反応の手応え', d: '反応を10種発見する', rp: 100, ok: () => Object.keys(P.rx).length >= 10 },
  { id: 'r40', n: '反応経路図', d: '反応を40種発見する', rp: 300, ok: () => Object.keys(P.rx).length >= 40 },
  { id: 'rall', n: '全反応制覇', d: 'すべての反応を発見する', rp: 1000, ok: () => REACTIONS.every(r => P.rx[r.id]) },
  { id: 'q30', n: '口頭試問の常連', d: 'クイズに30問正解する', rp: 100, ok: () => P.st.right >= 30 },
  { id: 'q200', n: '試問官泣かせ', d: 'クイズに200問正解する', rp: 500, ok: () => P.st.right >= 200 },
  { id: 'star3', n: '高純度', d: '★3の物質をつくる', rp: 150, ok: () => P.st.star3 >= 1 },
];
export const RANKS = [[0, '研究生'], [300, '助手'], [900, '研究員'], [2000, '主任研究員'], [4000, '准教授'], [7000, '教授'], [12000, '名誉教授']];
export const rank = () => { let r = RANKS[0], nx = null; for (const x of RANKS) { if (P.total >= x[0]) r = x; else { nx = x; break; } } return { name: r[1], next: nx }; };

const news = []; // 画面に知らせる出来事（ui.js が取り出して表示する）
export const takeNews = () => news.splice(0);
function gain(n, why) { P.rp += n; P.total += n; if (why) news.push(`${why}　研究ポイント +${n}`); }
function checkAch() { for (const a of ACHS) if (!P.ach[a.id] && a.ok()) { P.ach[a.id] = 1; gain(a.rp, `🏅 実績「${a.n}」`); } }

export function seeUnit(id, star = 1) {
  let ch = false;
  if (!P.units[id]) { P.units[id] = 1; gain(5); ch = true; }
  if (star >= 3 && !P.st.star3) { P.st.star3 = 1; ch = true; }
  if (ch) { checkAch(); save(); }
}
/** 反応の発動を記録。初めてなら true */
export function seeRx(id, name) {
  const first = !P.rx[id]; P.rx[id] = (P.rx[id] || 0) + 1;
  if (first) { gain(15, `⚗️ 新しい反応「${name}」を発見`); checkAch(); }
  save(); return first;
}
export function answer(qid, right, practice) {
  const h = P.quiz[qid] || (P.quiz[qid] = [0, 0]); const firstRight = right && h[0] === 0;
  h[right ? 0 : 1]++;
  if (right) { P.st.right++; gain((practice ? 3 : 10) + (firstRight ? 5 : 0)); checkAch(); }
  save();
}
export function endGame(place) {
  P.st.games++; if (place === 1) P.st.wins++; if (place <= 4) P.st.top4++; P.st.best = Math.min(P.st.best, place);
  gain((9 - place) * 15, `実験終了 ${place}位`); checkAch(); save();
}
export const owned = (kind, id) => !!P.own[kind + ':' + id];
export function buy(kind, id, cost) { if (owned(kind, id) || P.rp < cost) return false; P.rp -= cost; P.own[kind + ':' + id] = 1; save(); return true; }
export function equip(kind, id) { if (!owned(kind, id)) return false; P.eq[kind] = id; save(); return true; }
export const boardSkin = () => BOARDS.find(b => b.id === P.eq.b) || BOARDS[0];
export const quizStats = () => { let seen = 0, weak = 0; for (const k in P.quiz) { seen++; if (P.quiz[k][1] > P.quiz[k][0]) weak++; } return { seen, weak }; };
export function setOpt(k, v) { P.opt[k] = v; save(); }
