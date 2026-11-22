// ============================================================
//  UI（描画・ドラッグ操作・戦闘演出）
// ============================================================
import { Game, sellValue, XP_NEED, ODDS, DIFFS, MAX_LEVEL } from './game.js';
import { UNITS, TRAITS, ITEMS, COMPS, FULL_ITEMS, BY_COST, STAR_HP, STAR_AD, NEUTRAL, AUGS, traitTier, fmt, combine } from './data.js';
import { COLS, ROWS, TICK, MOVE_T, TIME_LIMIT, Battle } from './combat.js';
import { installFigures, figure, auraOf, TRAIT_ICON } from './figures.js';
import { LORE, titleOf } from './lore.js';
import { applyIntent } from './intents.js';
import { Session, savedName, saveName } from './net/session.js';
import { normCode, cleanName, NAME_MAX } from './net/proto.js';
import { sfx, musicMode, snd, setSound } from './audio.js';
import { REACTIONS, RX, RX_KIND, activeReactions, completes, possibleReactions } from './reactions.js';
import { pickQuestion, choices, allQuestions } from './quiz.js';
import * as meta from './meta.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// 通信で届く文字列（とくにプレイヤー名）は必ずエスケープしてから innerHTML に入れる
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC[c]);
const SHORT = { NG: 'ﾆﾄﾛ', AcOH: 'CH₃COOH' };
const COSTCOL = ['#8a6a5a', '#9aa5b8', '#3fcf7a', '#4a95ff', '#b968ff', '#ffc23d'];
const TOK_VB = '16 7 68 68', CARD_VB = '6 2 88 88';
const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const seen = new Set(); let seenOn = false; // 購入演出用：既に表示したユニット
installFigures();
// 3Dステージ（WebGL が使えない環境では従来の平面表示のまま）。起動を待たせないよう、タイトルを出してから読み込む
let stage = null, PIC = {}, cellWorld = null;
async function initStage() {
  try {
    const gfx = await import('./gfx/stage.js');
    const st = new gfx.Stage(document.querySelector('#boardWrap'));
    if (!st.ok) return;
    cellWorld = gfx.cellWorld; stage = st; window.__stage = st; document.querySelector('#app').classList.add('g3');
    if (G) { layout(); render(); } else if (!net && !document.querySelector('#modal').hidden && document.querySelector('#mSolo')) showStart();
    stage.setTheme(meta.boardSkin()); stage.setMol(meta.P.eq.m);
    pumpPics();
  } catch (e) { console.warn('[gfx] 3D表示を使えないため平面表示に切り替えます', e); stage = null; }
}
// 肖像は数体ずつ作り、できた順に画面へ差し込む（表示様式を変えたら作り直す）
let picGen = 0;
function pumpPics() {
  const gen = ++picGen, queue = Object.keys(UNITS);
  const pump = () => {
    if (gen !== picGen || !stage) return; const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 14) { const id = queue.shift(); PIC[id] = stage.portrait(id); document.querySelectorAll(`img[data-pic="${id}"]`).forEach(im => { im.src = PIC[id]; }); }
    if (queue.length) setTimeout(pump, 24);
  };
  pump();
}
const hexInt = c => parseInt(String(c).replace('#', ''), 16) || 0xffffff;
/** 物質の絵：3Dモデルの肖像（なければ従来のSVG） */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const pic = (id, cls = 'fig', vb) => (stage ? `<img class="${cls}" data-pic="${id}" src="${PIC[id] || BLANK}" alt="" draggable="false">` : figure(id, cls, vb));
const TOKEN_Y = .8; // 駒のDOM（当たり判定・HPバー）を重ねる高さ

let G = null, me = null, hexW = 60, hexH = 69, speed = 1, bt = null /*表示中の戦闘*/, btEls = new Map(), raf = 0;
let planEnd = 0, planDur = 0, timerId = 0, drag = null, opts = { diff: 'normal', timer: true };
// オンライン: net=Session。G は影のGame（表示・予測用）、me はその中の自分の席。flip=自分がチーム1の戦闘を180°回して描く
let mode = 'solo', net = null, flip = false, deferred = false, augOpen = false, keys = {}, replay = null;
const online = () => mode === 'online';
const AUG_N = Object.fromEntries(AUGS.map(a => [a.id, a.n]));
/** プレイヤー操作。ソロは直接適用、オンラインは予測＋ホストへ送信 */
function act(it) {
  const lv = me.level, r = online() ? net.act(it) : applyIntent(G, me, it);
  if (!r) { if (it.t !== 'ready' && it.t !== 'lock') sfx('error'); return r; }
  switch (it.t) {
    case 'buy': { const m = G.allUnits(me).find(u => u.justMerged && Date.now() - u.justMerged < 80); sfx(m ? (m.star >= 3 ? 'merge3' : 'merge2') : 'buy'); break; }
    case 'sell': sfx('sell'); break;
    case 'roll': sfx('roll'); break;
    case 'xp': sfx(me.level > lv ? 'levelup' : 'xp'); break;
    case 'lock': sfx('lock'); break;
    case 'move': sfx(r === 'full' ? 'error' : 'place'); break;
    case 'equip': sfx(r === 'full' ? 'error' : r === 'combined' ? 'craft' : 'equip'); break;
    case 'aug': sfx('aug'); break;
  }
  return r;
}
// 準備時間の残り5秒を1秒ごとに知らせる
let tickSec = -1;
function tickSnd(left) { const s = Math.ceil(left / 1000); if (s !== tickSec) { tickSec = s; if (s >= 1 && s <= 5 && G && G.phase === 'plan') sfx('tick'); } }

// ---------- 座標 ----------
const cellXY = (c, r) => { if (stage) { const [x, z] = cellWorld(c, r); return stage.project(x, TOKEN_Y, z); } return [c * hexW + (r & 1 ? hexW / 2 : 0) + hexW / 2, r * hexH * 0.75 + hexH / 2]; };
// 3D表示：盤面は透視投影なので、マスごとに画面上の大きさが違う
const cellPx = (c, r) => { const [x, z] = cellWorld(c, r); return Math.max(20, Math.min(90, stage.cellSize(x, z)[0])); };
function layout3() {
  const w = $('#boardWrap'); w.style.flex = '';
  const W = w.clientWidth, H = w.clientHeight; if (W < 2 || H < 2) return;
  stage.resize(W, H);
  const b = $('#board'); b.style.width = W + 'px'; b.style.height = H + 'px';
  hexW = cellPx(3, 5); hexH = hexW * 1.1547;
  document.documentElement.style.setProperty('--hw', Math.min(hexW, 66) + 'px');
  const cells = $('#cells'); cells.innerHTML = '';
  for (let r = 4; r < ROWS; r++) for (let c = 0; c < COLS; c++) { // 当たり判定用の透明なマス（自陣のみ）
    const [x, z] = cellWorld(c, r), [px, py] = stage.project(x, 0, z), [cw, ch] = stage.cellSize(x, z), d = el('div', 'cell me');
    d.style.cssText = `left:${px - cw / 2}px;top:${py - ch / 2}px;width:${cw}px;height:${ch}px`;
    d.dataset.drop = 'hex'; d.dataset.c = c; d.dataset.r = r - 4; cells.appendChild(d);
  }
  if (G) { renderBoard(true); if (bt) updateTokens(); }
}
const NARROW = window.matchMedia ? matchMedia('(max-width: 860px)') : { matches: false };
function layout() {
  if (stage) return layout3();
  const b0 = $('#board'); b0.style.width = b0.style.height = '0px';
  const w = $('#boardWrap'); w.style.flex = '';
  const W = w.clientWidth, H = w.clientHeight;
  hexW = Math.max(22, Math.min(W / 7.8, H / 7.5, 88)); hexH = hexW * 1.1547;
  // スマホで縦に余裕があれば、六角を少しだけ縦長にして盤面を大きく使う（最大8%）
  if (NARROW.matches) hexH = Math.max(hexH, Math.min(hexH * 1.08, (H - hexW * .2 - 12) / 6.25));
  document.documentElement.style.setProperty('--hw', hexW + 'px');
  const b = $('#board'); b.style.width = hexW * 7.5 + 'px'; b.style.height = hexH * 6.25 + 'px';
  // スマホ（幅で盤面サイズが決まる）では、盤面の枠を盤面の高さに縮めて余白を下の器具棚に回す
  if (NARROW.matches) { const need = Math.ceil(hexH * 6.25 + hexW * .2 + 12); if (H - need > 4) w.style.flex = `0 0 ${need}px`; }
  const cells = $('#cells'); cells.innerHTML = '';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const [x, y] = cellXY(c, r), d = el('div', 'cell ' + (r >= 4 ? 'me' : 'en'));
    d.style.cssText = `left:${x - hexW / 2 + 1.5}px;top:${y - hexH / 2 + 1.5}px;width:${hexW - 3}px;height:${hexH - 3}px`;
    if (r >= 4) { d.dataset.drop = 'hex'; d.dataset.c = c; d.dataset.r = r - 4; }
    cells.appendChild(d);
  }
  if (G) { renderBoard(true); if (bt) updateTokens(); }
}

// ---------- トークン ----------
function fsize(s) { const n = [...s].length; return n <= 2 ? .22 : n <= 4 ? .2 : n === 5 ? .18 : n <= 7 ? .165 : .15; }
function mkToken(id, star, items, team, bars, on3d) {
  const d = UNITS[id], f = SHORT[id] || d.f;
  const t = el('div', `token c${d.cost} t${team}`);
  t.innerHTML = (bars ? '<div class="bars"><div class="bar hp"><i class="h"></i><i class="s"></i></div><div class="bar mp"><i></i></div></div>' : '') +
    `<div class="body">${on3d ? '' : pic(id, 'fig', TOK_VB)}</div><div class="np" style="--fs:${fsize(f)}">${f}</div>` +
    (d.mob ? '' : `<div class="stars s${star}">${'★'.repeat(star)}</div>`) +
    `<div class="its">${(items || []).map(i => `<span>${ITEMS[i].ic}</span>`).join('')}</div>` + (bars ? '<div class="tag"></div>' : '');
  return t;
}
function place(t, c, r) { const [x, y] = cellXY(c, r); t.style.transform = `translate(${x}px,${y}px)`; if (stage) t.style.setProperty('--hw', cellPx(c, r) + 'px'); }
// 戦闘座標 → 画面座標。flip 時は盤面を180°回転（odd-r の六角格子では (c,r)→(6-c,7-r) がちょうど点対称）
const bxy = (c, r) => (flip ? cellXY(COLS - 1 - c, ROWS - 1 - r) : cellXY(c, r));
// 名札が構造体より横に広いときは横方向に縮めて収める
function fitPlates(root) {
  const m = [...root.querySelectorAll('.token .np')].map(n => [n, n.offsetWidth, n.parentElement.offsetWidth]);
  for (const [n, w, tw] of m) n.style.setProperty('--sx', w > tw && tw > 0 ? (tw / w).toFixed(3) : '1');
}

// ---------- 描画 ----------
const isNew = u => { const n = !seen.has(u.uid); seen.add(u.uid); return n && seenOn; };
function render() { renderTop(); renderTraits(); renderBoard(); renderBench(); renderItems(); renderShop(); renderScore(); if (me) { for (const u of G.allUnits(me)) meta.seeUnit(u.id, u.star); flushNews(); } }

function renderTop() {
  $('#stageLbl').textContent = G.label;
  const pve = G.isPvE(); $('#roundKind').textContent = pve ? '実験' : '対戦'; $('#roundKind').className = pve ? 'pve' : 'pvp';
  const ph = G.phase;
  $('#phaseLbl').textContent = !me.alive ? `脱落（${me.place}位）｜ 観戦中` : ph === 'plan' ? (pve ? '投影準備 ｜ 実験：不純物を取り除け' : `投影準備 ｜ 次の相手: ${G.opponent ? G.opponent.name : '?'}`) : ph === 'combat' ? '反応中' : '判定';
  const bg = $('#btnGo');
  if (online()) { // 準備完了：生存中で接続中の人間が全員押したらホストが戦闘を始める
    const hs = G.players.filter(p => p.human && p.alive && !p.away), rd = hs.filter(p => p.ready).length;
    bg.disabled = ph !== 'plan' || !me.alive; bg.classList.toggle('ready', !!me.ready && ph === 'plan');
    bg.textContent = ph !== 'plan' ? '反応中…' : (me.ready ? '準備完了 ✓ ' : '準備完了 ') + `${rd}/${hs.length}`;
  } else { bg.disabled = ph !== 'plan'; bg.classList.remove('ready'); bg.textContent = ph === 'plan' ? '反応開始' : '反応中…'; }
  $('#app').classList.toggle('plan', ph === 'plan');
  $('#app').classList.toggle('spectate', !me.alive);
  $('#oppTag').textContent = ph === 'plan' ? '' : (bt && bt.oppName ? '▲ ' + bt.oppName : '');
  const n = me.board.length, mx = G.maxUnits(me), cap = $('#capTag');
  cap.textContent = `${n}/${mx}`; cap.title = '盤面に配置している数 / 配置上限（レベルで増える）'; cap.className = n > mx ? 'over' : n < mx && me.bench.some(Boolean) ? 'under' : '';
}

function renderTraits() {
  const box = $('#traits'), cnt = G.traits(me); box.innerHTML = '';
  const list = Object.keys(cnt).map(k => ({ k, c: cnt[k], t: traitTier(k, cnt[k]) }))
    .sort((a, b) => (b.t > 0) - (a.t > 0) || b.t - a.t || b.c - a.c);
  if (!list.length) { box.appendChild(el('div', 'traitsEmpty', 'ユニットを盤面に置くと<br>シナジーが表示されます')); return; }
  for (const { k, c, t } of list) {
    const T = TRAITS[k], d = el('div', 'trait' + (t ? ' act' : ''));
    d.style.setProperty('--tc', T.col);
    d.innerHTML = `<div class="ic">${TRAIT_ICON[k]}</div><div><div class="nm">${T.n}</div><div class="bp">${T.bp.map((b, i) => (i === t - 1 ? `<b class="on">${b}</b>` : b)).join(' / ')}</div></div><div class="ct">${c}</div>`;
    d.onclick = e => { e.stopPropagation(); showTraitInfo(k, t); };
    box.appendChild(d);
  }
  for (const r of activeReactions(me.board.map(u => u.id))) { // 盤面で成立している反応
    const K = RX_KIND[r.k], d = el('div', 'trait act rx'); d.style.setProperty('--tc', K.col);
    d.innerHTML = `<div class="ic">⚗</div><div><div class="nm">${r.n}</div><div class="bp">${K.n}</div></div>`;
    d.onclick = e => { e.stopPropagation(); showRxInfo(r.id); }; box.appendChild(d);
  }
}
function rxHtml(r, known = true) {
  const K = RX_KIND[r.k];
  return `<div class="rxc${known ? '' : ' unk'}" style="--tc:${K.col}"><div class="rh"><b>${known ? r.n : '？？？'}</b><span class="chip" style="--tc:${K.col}">${K.n}</span></div>
    <div class="eq">${known ? r.eq : '未発見（下の物質を同時に盤面へ置くと発動）'}</div>
    <div class="minis">${r.need.map(id => `<span class="mini c${UNITS[id].cost}" title="${UNITS[id].n}">${pic(id, 'fig', TOK_VB)}<b>${SHORT[id] || UNITS[id].f}</b></span>`).join('<i>＋</i>')}</div>
    ${known ? `<div class="note">📝 ${r.note}</div>` : ''}</div>`;
}
function showRxInfo(id) { const r = RX[id]; showInfo(`<h3>⚗️ 反応</h3>${rxHtml(r)}<div class="mut" style="margin-top:6px">効果：${RX_KIND[r.k].d}</div>`); }
// 研究記録からのお知らせ（新発見・実績）をトーストで出す
function flushNews() { for (const n of meta.takeNews()) toast(n); }

function renderBoard(force) {
  if (G.phase !== 'plan' && !force) return;
  if (G.phase !== 'plan') { if (bt) buildBattleTokens(); return; }
  const box = $('#tokens'); box.innerHTML = ''; btEls.clear();
  for (const u of me.board) {
    const t = mkToken(u.id, u.star, u.items, 0, false, !!stage); t.dataset.uid = u.uid; t.dataset.c = u.c; t.dataset.r = u.r;
    if (u.justMerged && Date.now() - u.justMerged < 800) t.classList.add('merge'); else if (isNew(u)) t.classList.add('enter');
    seen.add(u.uid); place(t, u.c, 4 + u.r); box.appendChild(t);
  }
  fitPlates(box);
  if (stage) stage.setUnits(me.board.map(u => { const [x, z] = cellWorld(u.c, 4 + u.r), d = UNITS[u.id]; return { key: 'p' + u.uid, id: u.id, team: 0, cost: d.cost, star: u.star, aura: hexInt(auraOf(u.id)), x, z, pop: u.justMerged && Date.now() - u.justMerged < 800 }; }));
}

function renderBench() {
  const row = $('#benchRow'); row.innerHTML = '';
  me.bench.forEach((u, i) => {
    const s = el('div', 'slot'); s.dataset.drop = 'bench'; s.dataset.i = i;
    if (u) { const t = mkToken(u.id, u.star, u.items, 0); t.dataset.uid = u.uid; if (u.justMerged && Date.now() - u.justMerged < 800) t.classList.add('merge'); else if (isNew(u)) t.classList.add('enter'); seen.add(u.uid); s.appendChild(t); }
    row.appendChild(s);
  });
  fitPlates(row);
}

function renderItems() {
  const row = $('#itemsRow'); row.innerHTML = ''; row.classList.toggle('empty', !me.items.length);
  if (!me.items.length) { row.appendChild(el('span', 'lbl', '器具なし（実験ラウンドで入手 → ユニットにドラッグ）')); return; }
  me.items.forEach((id, i) => { const d = el('div', 'item' + (ITEMS[id].comp ? '' : ' full'), ITEMS[id].ic); d.dataset.ii = i; d.title = ITEMS[id].n; row.appendChild(d); });
}

function renderShop() {
  const box = $('#shop'), cnt = G.traits(me); box.innerHTML = '';
  me.shop.forEach((id, i) => {
    if (!id) { box.appendChild(el('div', 'card empty')); return; }
    const d = UNITS[id], own = G.allUnits(me).filter(u => u.id === id), n1 = own.filter(u => u.star === 1).length;
    const c = el('div', `card c${d.cost}` + (own.length ? ' own' : '') + (n1 % 3 === 2 ? ' own3' : '') + (G.canBuy(me, i) ? '' : ' no'));
    c.innerHTML = cardHtml(id, cnt, me.board.map(u => u.id)) + '<div class="i">i</div>';
    c.onclick = e => {
      e.stopPropagation();
      if (e.target.classList.contains('i')) return showUnitInfo(id, 1, []);
      if (act({ t: 'buy', slot: i })) render(); else toast(!me.alive ? '観戦中' : me.gold < d.cost ? 'ゴールドが足りない' : 'ベンチが満員');
    };
    box.appendChild(c);
  });
  $('#gold').textContent = '💰' + me.gold;
  const s = Math.abs(me.streak), inc = (G.stage === 1 ? 3 : 5) + Math.min(me.intCap, Math.floor(me.gold / 10)) + (s >= 5 ? 3 : s >= 4 ? 2 : s >= 2 ? 1 : 0);
  $('#incomeLbl').textContent = `次R +${inc}（利息${Math.min(me.intCap, Math.floor(me.gold / 10))}）`;
  $('#lvLbl').innerHTML = `<b>Lv.${me.level}</b><span>${me.level < MAX_LEVEL ? `XP ${me.xp}/${XP_NEED[me.level]}` : 'MAX'}</span>`;
  $('#xpBar i').style.width = (me.level < MAX_LEVEL ? me.xp / XP_NEED[me.level] * 100 : 100) + '%';
  $('#btnXP').disabled = me.gold < 4 || me.level >= MAX_LEVEL;
  $('#btnRoll').disabled = me.gold < me.rerollCost; $('#rollCost').textContent = me.rerollCost + 'G';
  $('#btnLock').textContent = me.lock ? '🔒' : '🔓'; $('#btnLock').classList.toggle('on', me.lock);
}

function renderScore() {
  const box = $('#score'); box.innerHTML = '';
  const ps = G.players.slice().sort((a, b) => b.alive - a.alive || b.hp - a.hp || a.place - b.place);
  for (const p of ps) {
    const d = el('div', 'pl' + (p === me ? ' me' : '') + (p.alive ? '' : ' dead') + (p === G.opponent && G.phase !== 'result' ? ' opp' : '') + (online() && p.human ? ' hu' : '') + (p.away ? ' away' : ''));
    const s = p.streak;
    d.title = p.name + (online() && p.human ? (p.away ? '（離席中：AIが代行）' : '（プレイヤー）') : '');
    d.innerHTML = `<span class="lv">Lv${p.level}</span><span class="nm">${esc(p.name)}</span>${p.away ? '<span class="aw">AI</span>' : ''}<span class="stk">${s >= 2 ? '🔥' + s : s <= -2 ? '❄️' + -s : ''}</span><span class="hp">${p.alive ? p.hp : p.place + '位'}</span><i class="hpb" style="width:${p.hp}%;background:${p.hp > 50 ? '#3fb96b' : p.hp > 25 ? '#ffb703' : '#ff5d73'}"></i>`;
    d.onclick = e => { e.stopPropagation(); showScout(p); };
    box.appendChild(d);
  }
}

// 標本カード（ショップ・図鑑共通）
function cardHtml(id, cnt = {}, board) {
  const d = UNITS[id], f = SHORT[id] || d.f, n = [...f].length, rx = board ? completes(board, id) : [];
  return `<div class="art" style="--au:${auraOf(id)}">${pic(id, 'fig', CARD_VB)}</div><div class="cost">${d.cost}</div>${rx.length ? `<div class="rxb" title="買って置くと反応：${rx.map(r => r.n).join('、')}">⚗${rx.length > 1 ? rx.length : ''}</div>` : ''}` +
    `<div class="meta"><span class="fm${n > 5 ? ' long' : ''}">${f}</span><span class="nm">${d.n}</span></div>` +
    `<div class="trs">${d.traits.map(t => `<span class="${cnt[t] ? 'act' : ''}" style="--tc:${TRAITS[t].col}" title="${TRAITS[t].n}">${TRAIT_ICON[t]}<em>${TRAITS[t].n}</em></span>`).join('')}</div>`;
}

// ---------- 情報パネル ----------
const chip = t => `<span class="chip" style="--tc:${TRAITS[t].col}">${TRAIT_ICON[t]}${TRAITS[t].n}</span>`;
function showInfo(html) { const i = $('#info'); i.innerHTML = '<span class="x">✕</span>' + html; i.hidden = false; i.querySelector('.x').onclick = hideInfo; }
function hideInfo() { $('#info').hidden = true; }
function skillHtml(d, star) {
  const s = d.skill; if (!s) return '';
  return `<div class="sk"><span class="n">${s.n}</span> <span class="mut">マナ ${d.mana[0]}/${d.mana[1]}</span><div>${fmt(s.d, s.v, star)}</div><div class="eq">${s.eq}</div></div>`;
}
function showUnitInfo(id, star, items, live) {
  const d = UNITS[id], sm = star - 1;
  const st = live ? [Math.ceil(live.hp) + '/' + Math.round(live.maxHp), Math.round(live.ad), bt.asEff(live).toFixed(2), Math.round(bt.armorEff(live)), Math.round(bt.mrEff(live)), live.range, live.ap]
    : [Math.round(d.hp * STAR_HP[sm]), Math.round(d.ad * STAR_AD[sm]), d.as.toFixed(2), d.armor, d.mr, d.range, 100];
  showInfo(`<div class="uhead"><div class="medal c${d.cost}" style="--au:${auraOf(id)}">${pic(id)}</div><div class="uh">
    <h3>${d.n}</h3><div class="fmrow"><span class="fm">${d.f}</span><span class="costc">${d.mob ? '実験試料' : d.cost + 'G ' + '★'.repeat(star)}</span></div>
    <div class="chips">${d.traits.map(chip).join('')}</div></div></div>
    ${LORE[id] ? `<div class="lore">${LORE[id]}</div>` : ''}
    ${(() => { const rs = REACTIONS.filter(r => r.need.includes(id)); return rs.length ? `<div class="rxl"><span class="mut">反応</span>${rs.map(r => `<span class="chip${meta.P.rx[r.id] ? '' : ' unk'}" style="--tc:${RX_KIND[r.k].col}" title="${r.need.map(x => UNITS[x].n).join(' ＋ ')}">${meta.P.rx[r.id] ? r.n : '？ ' + r.need.filter(x => x !== id).map(x => SHORT[x] || UNITS[x].f).join('＋')}</span>`).join('')}</div>` : ''; })()}
    <div class="stats"><span>HP <b>${st[0]}</b></span><span>攻撃力 <b>${st[1]}</b></span><span>攻速 <b>${st[2]}</b></span><span>アーマー <b>${st[3]}</b></span><span>魔法耐性 <b>${st[4]}</b></span><span>射程 <b>${st[5]}</b></span><span>スキル威力 <b>${st[6]}</b></span></div>
    ${skillHtml(d, star)}
    ${(items || []).map(i => `<div class="itl">${ITEMS[i].ic} <b>${ITEMS[i].n}</b>：${ITEMS[i].d}</div>`).join('')}
    ${d.note ? `<div class="note">📝 ${d.note}</div>` : ''}`);
}
function showTraitInfo(k, tier) {
  const T = TRAITS[k], us = Object.values(UNITS).filter(u => u.traits.includes(k)).sort((a, b) => a.cost - b.cost);
  showInfo(`<h3>${chip(k)} <span class="fm">${T.bp.join(' / ')}体</span></h3>
    <div style="margin-top:6px">${fmt(T.d, T.v, tier)}</div>
    ${k === 'acid' || k === 'base' ? `<div class="eq">【中和】H⁺ + OH⁻ → H₂O ：${NEUTRAL.flat}＋最大HPの${NEUTRAL.pct}%の魔法ダメージ（中和熱）</div>` : ''}
    <div class="note">📝 ${T.why}</div>
    <div class="minis">${us.map(u => `<span class="mini c${u.cost}" title="${u.n}">${pic(u.id, 'fig', TOK_VB)}<b>${SHORT[u.id] || u.f}</b></span>`).join('')}</div>`);
}
function showItemInfo(id) {
  const it = ITEMS[id];
  let h = `<h3>${it.ic} ${it.n}</h3><div style="margin-top:6px">${it.d}</div>`;
  if (it.comp) h += '<div class="sk mut">組み合わせ</div>' + COMPS.map(c => { const r = ITEMS[combine(id, c)]; return `<div class="itl">${it.ic}＋${ITEMS[c].ic} → ${r.ic} <b>${r.n}</b></div>`; }).join('');
  else h += `<div class="sk mut">レシピ：${it.r.map(c => ITEMS[c].ic + ITEMS[c].n).join(' ＋ ')}</div>`;
  showInfo(h);
}

function toast(s) { const t = el('div', '', s); $('#toast').appendChild(t); setTimeout(() => t.remove(), 2600); }
function modal(html, cls = '') { const b = $('#modalBox'); b.className = cls; b.innerHTML = html; b.scrollTop = 0; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }

function showScout(p) {
  const cnt = G.traits(p), act = Object.keys(cnt).filter(k => traitTier(k, cnt[k])).sort((a, b) => cnt[b] - cnt[a]);
  modal(`<h2>${esc(p.name)} <small style="color:var(--mut)">Lv.${p.level}　HP ${p.hp}　💰${p === me ? p.gold : '?'}</small></h2>
    ${p === me ? '<div class="rtitle">あなたの実験卓</div>' : !p.human && titleOf(p.name) ? `<div class="rtitle">「${titleOf(p.name)}」</div>` : ''}
    <div class="chips row">${act.map(k => `<span class="chip" style="--tc:${TRAITS[k].col}">${TRAITS[k].n} ${cnt[k]}</span>`).join('') || '<span style="color:var(--mut)">発動中のシナジーなし</span>'}</div>
    <div class="scout" id="scoutBox"></div><div class="row"><button id="mClose">閉じる</button></div>`);
  const box = $('#scoutBox');
  for (const u of p.board.slice().sort((a, b) => UNITS[b.id].cost * b.star - UNITS[a.id].cost * a.star)) {
    const t = mkToken(u.id, u.star, u.items, p === me ? 0 : 1); t.onclick = () => showUnitInfo(u.id, u.star, u.items); box.appendChild(t);
  }
  if (!p.board.length) box.textContent = '盤面は空';
  else requestAnimationFrame(() => fitPlates(box));
  $('#mClose').onclick = closeModal;
}

function showDex(tab = 'how') {
  const tabs = { how: '遊び方', units: '物質', rx: '反応', traits: 'シナジー', items: '器具', odds: '確率' };
  let body = '';
  if (tab === 'how') body = `
    <p><b>Auto-Chemyth</b> は、元素や化合物の<b>構造体</b>を集めて六角の反応場「元素盤」に投影し、7人のライバル化学者と自動で戦わせる化学オートバトラーです。</p>
    <h4>基本の流れ</h4>
    <p>① ショップで物質を買う（同じ物質が3つそろうと ★ が上がる＝精製）<br>② ベンチから盤面の下半分にドラッグして配置（配置数＝レベル）<br>③「反応開始」で自動戦闘。負けると生き残った敵の数に応じてHPが減る<br>④ 最後の1人になれば勝ち</p>
    <h4>化学のルール</h4>
    <p>・同じ<b>族・性質</b>の物質を並べるとシナジー発動（アルカリ金属、ハロゲン、酸、塩基、酸化剤…）<br>
    ・<b>中和</b>：酸が付けた H⁺ と塩基が付けた OH⁻ が同じ敵に重なると中和熱で大ダメージ<br>
    ・<b>イオン化傾向</b>：塩酸は H₂ よりイオン化傾向の大きい金属に特効。Cu・Ag・Au には効きにくい<br>
    ・<b>不動態</b>：Fe・Al は硝酸のスキルを半減。<b>金</b>は H⁺ を受けつけない<br>
    ・<b>脱水・けん化・付加</b>：硫酸・NaOH・臭素は有機化合物に特効<br>
    ・各物質のスキルは実際の反応式に基づく。タップで反応式と受験メモを確認できる</p>
    <h4>経済</h4>
    <p>毎ラウンド5G＋利息（10Gごとに+1、最大5）＋連勝/連敗ボーナス。経験値は4Gで4XP、リロードは2G。ユニットをショップ欄へドラッグで売却。</p>
    <h4>操作</h4><p>ドラッグ：移動・装備・売却　／　タップ：詳細　／　キー：<b>D</b> リロード・<b>F</b> 経験値・<b>Space</b> 反応開始</p>`;
  const inSet = G && G.set && G.set.length ? new Set(G.set) : null;
  if (tab === 'rx') { const kn = REACTIONS.filter(r => meta.P.rx[r.id]).length; body = `<p>特定の物質を<b>同時に盤面へ置く</b>と反応が発動し、反応物が強くなる（1体につき3つまで）。発見 <b class="on">${kn}</b> / ${REACTIONS.length}${inSet ? `　｜　今回の出題範囲で起こせる反応 ${possibleReactions(G.set).length}種` : ''}</p>` + Object.keys(RX_KIND).map(k => `<h4 style="color:${RX_KIND[k].col}">${RX_KIND[k].n} <small class="mut">${RX_KIND[k].d}</small></h4><div class="rxs">${REACTIONS.filter(r => r.k === k).map(r => rxHtml(r, !!meta.P.rx[r.id])).join('')}</div>`).join(''); }
  if (tab === 'units') body = (inSet ? `<p>明るいカードが<b>今回の出題範囲</b>（${G.set.length}種）。全${Object.keys(UNITS).filter(k => !UNITS[k].mob).length}種から毎ゲーム抽選される。</p>` : '') + [1, 2, 3, 4, 5].map(c => `<h4>コスト${c}</h4><div class="dex">${BY_COST[c - 1].map(id => `<div class="card c${c}${inSet && !inSet.has(id) ? ' out' : ''}${meta.P.units[id] ? '' : ' undisc'}" data-id="${id}">${cardHtml(id)}</div>`).join('')}</div>`).join('');
  if (tab === 'traits') body = Object.values(TRAITS).map(T => `<div class="dexT" style="--tc:${T.col}"><b style="color:${T.col}"><span class="dic">${TRAIT_ICON[T.id]}</span>${T.n}</b>（${T.bp.join('/')}）<br>${fmt(T.d, T.v)}<div class="why">📝 ${T.why}</div></div>`).join('') +
    `<div class="dexT" style="--tc:#fff36b"><b style="color:#fff36b">中和</b><br>H⁺ と OH⁻ が同じユニットに重なると両方が消え、${NEUTRAL.flat}＋最大HPの${NEUTRAL.pct}%の魔法ダメージ。<div class="why">📝 H⁺ + OH⁻ → H₂O　ΔH = −56.5 kJ/mol（強酸・強塩基なら種類によらず一定）</div></div>`;
  if (tab === 'items') body = `<h4>素材</h4><div class="recipe">${COMPS.map(c => `<div>${ITEMS[c].ic} <b>${ITEMS[c].n}</b><br>${ITEMS[c].d}</div>`).join('')}</div><h4>完成品（素材2つを同じユニットに装備）</h4><div class="recipe">${FULL_ITEMS.map(k => { const it = ITEMS[k]; return `<div>${it.r.map(c => ITEMS[c].ic).join('＋')} → ${it.ic} <b>${it.n}</b><br>${it.d}</div>`; }).join('')}</div>`;
  if (tab === 'odds') body = `<p>レベルごとのショップ出現率(%)</p><table class="odds"><tr><th>Lv</th>${[1, 2, 3, 4, 5].map(c => `<th style="color:${COSTCOL[c]}">${c}G</th>`).join('')}</tr>${ODDS.slice(1).map((o, i) => `<tr${me && me.level === i + 1 ? ' style="background:#2a5fd055"' : ''}><td>${i + 1}</td>${o.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`;
  modal(`<div class="tabs">${Object.keys(tabs).map(k => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${tabs[k]}</button>`).join('')}<button id="mClose" style="margin-left:auto">閉じる</button></div>${body}`);
  $('#modalBox').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showDex(b.dataset.tab));
  $('#modalBox').querySelectorAll('[data-id]').forEach(c => c.onclick = e => { e.stopPropagation(); showUnitInfo(c.dataset.id, 1, []); });
  $('#mClose').onclick = () => { closeModal(); hideInfo(); };
}

function showStart() {
  if (stage && !G) stage.setUnits([]);
  musicMode('title');
  const parade = ['Li', 'Cl2', 'C6H6', 'Au', 'Aqua', 'Ne', 'KMnO4'];
  const tiles = [['1', 'H', '水素'], ['6', 'C', '炭素'], ['8', 'O', '酸素'], ['79', 'Au', '金']];
  modal(`<div class="ttl">
    <div class="tiles">${tiles.map(([z, s, n]) => `<span class="etile"><i>${z}</i><b>${s}</b><em>${n}</em></span>`).join('')}</div>
    <div class="logo"><div class="pre">CHEMYTH LAB ・ 元素盤</div><h1>Auto<span>-</span>Chemyth</h1><div class="sub">構造体たちの反応場</div></div>
    <div class="parade">${parade.map((id, i) => `<div class="pm c${UNITS[id].cost}" style="--au:${auraOf(id)};--i:${i}">${pic(id, 'fig', TOK_VB)}</div>`).join('')}</div>
    <p class="intro">近未来の研究施設〈CHEMYTH LAB〉の中枢に据えられた六角の反応場「元素盤」。化学者たちは物質の<b>構造体</b>をホログラムとして投影し、族と性質の共鳴を組み上げ、実際の化学反応で相手の実験を崩していく。最後まで盤上に残った反応系だけが勝者となる。</p>
    <p class="intro sm">酸と塩基で<b>中和</b>、塩酸は<b>イオン化傾向</b>で特効、鉄は濃硝酸に<b>不動態</b>、金は<b>王水</b>でしか溶けない——盤面の強さは、そのまま化学の知識になる。</p>
    <div class="modes">
      <button class="mode primary" id="mSolo"><b>ソロ</b><small>7人のライバルAIと対戦</small></button>
      <button class="mode" id="mOnline"><b>オンライン</b><small>友だちとルームで対戦</small></button>
    </div>
    <div class="opts"><div class="row"><span class="ol">難易度</span><span class="seg" id="segDiff">${Object.keys(DIFFS).map(k => `<button data-v="${k}" class="${k === opts.diff ? 'on' : ''}">${DIFFS[k].n}</button>`).join('')}</span></div>
    <div class="row"><span class="ol">準備時間</span><span class="seg" id="segTimer"><button data-v="1" class="${opts.timer ? 'on' : ''}">制限あり</button><button data-v="0" class="${opts.timer ? '' : 'on'}">じっくり（無制限）</button></span></div></div>
    <div class="row"><span class="ol">口頭試問</span><span class="seg" id="segQuiz"><button data-v="1" class="${meta.P.opt.quiz ? 'on' : ''}">実験ラウンドで出題</button><button data-v="0" class="${meta.P.opt.quiz ? '' : 'on'}">出題しない</button></span></div>
    <div class="row go"><button id="mHow">遊び方・図鑑</button><button id="mRec">研究記録・スキン</button><button id="mQuiz">口頭試問</button></div>
    <div class="rankline">${meta.rank().name}　研究ポイント <b>${meta.P.rp}</b>　物質 ${Object.keys(meta.P.units).length}/${BY_COST.flat().length}　反応 ${Object.keys(meta.P.rx).length}/${REACTIONS.length}</div>
    <div class="foot">41種の構造体 ・ 14の族と性質 ・ 最大8人で対戦</div></div>`, 'titleBox');
  seg('#segDiff', v => { opts.diff = v; }); seg('#segTimer', v => { opts.timer = v === '1'; });
  $('#mSolo').onclick = () => { closeModal(); newGame(); };
  $('#mOnline').onclick = () => showOnline();
  $('#mHow').onclick = () => { showDex('how'); const c = $('#mClose'); c.onclick = () => { hideInfo(); showStart(); }; };
  seg('#segQuiz', v => meta.setOpt('quiz', v === '1'));
  $('#mRec').onclick = () => showRecord('prog');
  $('#mQuiz').onclick = () => showQuiz({ practice: true, onDone: showStart });
}
function seg(id, fn) { $(id).querySelectorAll('button').forEach(b => b.onclick = () => { $(id).querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); fn(b.dataset.v); }); }

function showAug() {
  augOpen = true;
  modal(`<h2>🔬 研究テーマを選ぶ</h2><p>このゲーム中ずっと有効な強化を1つ選択。${online() ? '<br><small class="mut">準備時間内に選ばないと自動で選ばれます。</small>' : ''}</p><div class="augs">${G.pendingAug.map((a, i) => `<div class="aug" data-i="${i}"><div class="ic">${a.ic}</div><div class="n">${a.n}</div><div class="d">${a.d}</div></div>`).join('')}</div>`);
  $('#modalBox').querySelectorAll('.aug').forEach(a => a.onclick = () => {
    if (!act({ t: 'aug', i: +a.dataset.i })) return;
    augOpen = false; closeModal(); render(); if (!online()) startTimer();
  });
}
// 戦闘開始時：成立している反応を記録して知らせる
function announceRx() {
  const rs = activeReactions(me.board.map(u => u.id)); if (!rs.length) return;
  let nw = 0; for (const r of rs) if (meta.seeRx(r.id, r.n)) nw++;
  toast(`⚗️ ${rs.slice(0, 2).map(r => r.eq).join('　／　')}${rs.length > 2 ? `　ほか${rs.length - 2}反応` : ''}`);
  flushNews(); if (nw) sfx('craft');
}
// 口頭試問。practice=true はタイトルからの自主練（連続出題）
let quizOpen = false;
function showQuiz(o = {}) {
  const q = pickQuestion(meta.P.quiz, o.seen || []), ch = choices(q); quizOpen = true;
  modal(`<div class="quiz"><div class="qh"><span class="chip">${q.t}</span><span class="mut">${o.practice ? '口頭試問（自主練）' : '口頭試問：正解で研究ポイント +10'}</span><span class="qrp">RP ${meta.P.rp}</span></div>
    <h3>${q.q}</h3><div class="qcs">${ch.map((c, i) => `<button class="qc" data-i="${i}">${c}</button>`).join('')}</div><div class="qex" hidden></div>
    <div class="row go"><button id="qSkip">${o.practice ? 'やめる' : 'スキップ'}</button><button class="primary" id="qNext" hidden>${o.practice ? '次の問題' : '盤面へ'}</button></div></div>`, 'quizBox');
  const done = () => { quizOpen = false; closeModal(); if (o.onDone) o.onDone(); };
  $('#modalBox').querySelectorAll('.qc').forEach(b => b.onclick = () => {
    if ($('#modalBox .qc.ok')) return;
    const right = ch[+b.dataset.i] === q.a; meta.answer(q.id, right, o.practice); sfx(right ? 'buy' : 'error');
    $('#modalBox').querySelectorAll('.qc').forEach(x => { x.disabled = true; if (ch[+x.dataset.i] === q.a) x.classList.add('ok'); }); if (!right) b.classList.add('ng');
    const ex = $('#modalBox .qex'); ex.hidden = false; ex.innerHTML = `<b>${right ? '正解' : '不正解'}</b>　${q.ex || ''}`;
    $('#qNext').hidden = false; $('#qSkip').hidden = !o.practice; $('#modalBox .qrp').textContent = 'RP ' + meta.P.rp; flushNews();
  });
  $('#qSkip').onclick = done;
  $('#qNext').onclick = () => { if (o.practice) showQuiz(Object.assign({}, o, { seen: (o.seen || []).concat(q.id).slice(-30) })); else done(); };
}
function closeQuiz() { if (quizOpen) { quizOpen = false; closeModal(); } }
// 研究記録：進捗・スキン・実績
function applySkins() {
  if (!stage) return; stage.setTheme(meta.boardSkin());
  if (stage.setMol(meta.P.eq.m)) { PIC = {}; document.querySelectorAll('img[data-pic]').forEach(im => { im.src = BLANK; }); pumpPics(); }
  if (G) render();
}
function showRecord(tab = 'prog') {
  const P = meta.P, rk = meta.rank(), nU = BY_COST.flat().length, qs = allQuestions(), qst = meta.quizStats();
  const bar = (a, b) => `<div class="pbar"><i style="width:${Math.min(100, a / b * 100)}%"></i><span>${a} / ${b}</span></div>`;
  let body = '';
  if (tab === 'prog') body = `<div class="rk"><b>${rk.name}</b><span class="mut">${rk.next ? `次の階級「${rk.next[1]}」まで あと ${rk.next[0] - P.total} RP` : '最高階級'}</span></div>
    <h4>物質の発見</h4>${bar(Object.keys(P.units).length, nU)}<h4>反応の発見</h4>${bar(Object.keys(P.rx).length, REACTIONS.length)}
    <h4>口頭試問（出題済み / 全問）</h4>${bar(qst.seen, qs.length)}<p class="mut">正解数 ${P.st.right}　／　苦手（誤答が多い）${qst.weak}問 … 苦手な問題ほど優先して出題される</p>
    <h4>戦績</h4><p>プレイ ${P.st.games}回　優勝 ${P.st.wins}回　4位以内 ${P.st.top4}回　最高 ${P.st.best < 9 ? P.st.best + '位' : '—'}</p>`;
  const skin = (kind, list) => list.map(x => { const own = meta.owned(kind, x.id), eq = P.eq[kind] === x.id;
    return `<div class="skin${eq ? ' eq' : ''}"><div class="sw">${kind === 'b' ? `<i style="background:#${x.ally.toString(16).padStart(6, '0')}"></i><i style="background:#${x.enemy.toString(16).padStart(6, '0')}"></i><i style="background:#${x.bg.toString(16).padStart(6, '0')}"></i>` : x.id === 'stick' ? '●━●' : x.id === 'fill' ? '⬤⬤' : '◌┄◌'}</div>
      <div><b>${x.n}</b><div class="mut">${x.d}</div></div><button data-k="${kind}" data-id="${x.id}" data-c="${x.cost}" ${eq || (!own && P.rp < x.cost) ? 'disabled' : ''}>${eq ? '使用中' : own ? '使う' : x.cost + ' RP'}</button></div>`; }).join('');
  if (tab === 'skin') body = `<p>研究ポイント <b class="on">${P.rp}</b>　物質や反応の発見、口頭試問の正解、対戦の順位で貯まる。</p><h4>反応台</h4><div class="skins">${skin('b', meta.BOARDS)}</div><h4>分子の表示様式</h4><div class="skins">${skin('m', meta.MOLS)}</div>${stage ? '' : '<p class="mut">この端末は3D表示が使えないため、スキンは反映されません。</p>'}`;
  if (tab === 'ach') body = `<div class="achs">${meta.ACHS.map(a => `<div class="ach${P.ach[a.id] ? ' got' : ''}"><b>${P.ach[a.id] ? '🏅' : '・'} ${a.n}</b><span class="mut">${a.d}</span><span class="rp">+${a.rp} RP</span></div>`).join('')}</div>`;
  const tabs = { prog: '進捗', skin: 'スキン', ach: '実績' };
  modal(`<div class="tabs">${Object.keys(tabs).map(k => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${tabs[k]}</button>`).join('')}<button id="mClose" style="margin-left:auto">閉じる</button></div>${body}`);
  $('#modalBox').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showRecord(b.dataset.tab));
  $('#modalBox').querySelectorAll('.skin button').forEach(b => b.onclick = () => { const k = b.dataset.k, id = b.dataset.id; if (!meta.owned(k, id) && !meta.buy(k, id, +b.dataset.c)) return; meta.equip(k, id); sfx('craft'); applySkins(); showRecord('skin'); });
  $('#mClose').onclick = () => { closeModal(); if (!G) showStart(); };
}
function closeAug() { if (augOpen) { augOpen = false; closeModal(); } }

function showOver() {
  const p = G.place, win = p === 1;
  musicMode('title'); if (win) sfx('champion');
  if (!G.recorded) { G.recorded = 1; meta.endGame(p); flushNews(); }
  const best = me.board.slice().sort((a, b) => UNITS[b.id].cost * b.star - UNITS[a.id].cost * a.star).slice(0, 5);
  const ranks = online() ? `<div class="ranks">${G.players.slice().sort((a, b) => (a.place || 9) - (b.place || 9)).map(q => `<div class="rk${q === me ? ' me' : ''}${q.human ? ' hu' : ''}"><b>${q.place || '-'}</b><span>${esc(q.name)}</span>${q.human ? `<em>${q.away ? '離席' : 'プレイヤー'}</em>` : '<em>AI</em>'}</div>`).join('')}</div>` : '';
  modal(`<div class="over ${win ? 'win' : ''}"><div class="place">${win ? '🏆' : p + '<small>位</small>'}</div>
    <h2>${win ? '元素盤の覇者' : '実験終了'}</h2>
    <p>${win ? 'すべてのライバルの実験を退け、あなたの反応系だけが盤上に残った。ラボの記録に、その名が刻まれる。' : p <= 4 ? '上位入賞。シナジーの段階をもう一つ上げれば、元素盤の頂が見える。' : '反応系は崩れた。だが失敗も記録になる。序盤は連敗しても利息で立て直せる——★2を作ってから盤面を広げよう。'}</p>
    ${ranks}
    <div class="minis">${best.map(u => `<span class="mini c${UNITS[u.id].cost}">${pic(u.id, 'fig', TOK_VB)}<b>${SHORT[u.id] || UNITS[u.id].f}${'★'.repeat(u.star)}</b></span>`).join('')}</div>
    <p class="mut">到達ラウンド ${G.label}　／　最終レベル ${me.level}</p>
    <div class="row go"><button class="primary big" id="mAgain">${online() ? 'タイトルへ' : 'もう一度'}</button></div></div>`, 'overBox');
  $('#mAgain').onclick = () => { if (online()) leaveOnline(); else showStart(); };
}

// ---------- 進行（ソロ） ----------
function newGame() {
  cancelAnimationFrame(raf); clearInterval(timerId); bt = null; flip = false; mode = 'solo'; speed = 1; syncTopBtns();
  G = new Game(opts); me = G.me; window.__G = G;
  seen.clear(); seenOn = false; render(); seenOn = true; layout(); enterPlan();
}
function enterPlan() {
  if (online()) return enterPlanOnline();
  bt = null; $('#banner').classList.remove('show'); $('#fx').innerHTML = '';
  render(); musicMode('plan'); sfx('round');
  const pve = G.isPvE(), o = G.opponent;
  stageFx(`ROUND ${G.label}`, pve ? '実験ラウンド ― 不純物を取り除け' : o ? `次の対戦：${esc(o.name)}${!o.human && titleOf(o.name) ? `「${titleOf(o.name)}」` : ''}` : '');
  if (G.pendingAug) showAug(); else if (pve && me.alive && meta.P.opt.quiz) showQuiz({ onDone: startTimer }); else startTimer();
}
function startTimer() {
  clearInterval(timerId); const bar = $('#timerBar i');
  if (online()) { // ホストが決めた締め切りまでの残り時間を表示するだけ（締め切りの判定はホスト）
    planDur = G.planTime() * 1000;
    const tick = () => { const left = net.client.deadline - performance.now(); bar.style.width = Math.max(0, left / planDur * 100) + '%'; if (me.alive) tickSnd(left); };
    tick(); timerId = setInterval(tick, 100); return;
  }
  if (!opts.timer) { bar.style.width = '100%'; return; }
  planDur = G.planTime() * 1000; planEnd = performance.now() + planDur;
  timerId = setInterval(() => {
    const left = planEnd - performance.now(); bar.style.width = Math.max(0, left / planDur * 100) + '%'; tickSnd(left);
    if (left <= 0) go();
  }, 100);
}
function go() {
  if (online()) { if (G && G.phase === 'plan' && me.alive) { act({ t: 'ready', on: !me.ready }); renderTop(); } return; }
  if (!G || G.phase !== 'plan' || !$('#modal').hidden && G.pendingAug) return;
  clearInterval(timerId); cancelDrag(); hideInfo();
  const f = G.myFight(), ghost = f && f.ghost;
  G.startCombat(); bt = G.battle; bt.oppName = G.opponent ? G.opponent.name + (ghost ? '（影）' : '') : '実験：不純物';
  render(); buildBattleTokens(); stageFx('反応開始', esc(bt.oppName), 'go'); musicMode('combat'); sfx('fight'); announceRx();
  playBattle(() => setTimeout(endCombat, 900));
}
// 戦闘の再生（ソロ・オンライン共通）。オンラインは常に ×1
function playBattle(onEnd) {
  cancelAnimationFrame(raf);
  let last = performance.now(), acc = 0, done = false;
  const loop = now => {
    if (!bt) return;
    let dt = Math.min(0.1, (now - last) / 1000) * speed; last = now; acc += dt;
    while (acc >= TICK && !bt.over) { bt.step(TICK); acc -= TICK; }
    playEvents(); updateTokens();
    $('#timerBar i').style.width = Math.max(0, (1 - bt.t / TIME_LIMIT) * 100) + '%';
    if (bt.over && !done) { done = true; onEnd(); return; }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
function showBanner(r) {
  const b = $('#banner');
  b.className = r.win ? 'win' : r.draw ? 'draw' : 'lose';
  b.innerHTML = `<span class="bt">${r.win ? '勝利' : r.draw ? '時間切れ' : '敗北'}</span><small>${r.win ? '反応系は盤上に残った' : r.draw ? '反応は平衡に達した' : '反応系が崩れた'}${r.dmg ? `　−${r.dmg} HP` : ''}</small>`;
  void b.offsetWidth; b.classList.add('show');
  musicMode('plan'); sfx(r.win ? 'win' : r.draw ? 'draw' : 'lose'); if (r.loot && r.loot.items) sfx('loot');
  if (r.loot && r.loot.items) toast('入手：' + r.loot.items.map(i => ITEMS[i].ic + ITEMS[i].n).join('　') + (r.loot.gold ? `　💰+${r.loot.gold}` : ''));
}
function endCombat() {
  G.finishCombat(); showBanner(G.lastResult);
  render();
  setTimeout(() => { if (G.over) { showOver(); return; } G.nextRound(); enterPlan(); }, 1700);
}

// ---------- オンライン：ロビー ----------
const REJECT = { notfound: 'ルームが見つかりません。コードを確認してください', full: 'ルームが満員です（最大8人）', started: 'このルームはすでにゲームが始まっています', ended: 'このルームのゲームは終了しています' };
function roomLink(code) {
  const q = new URLSearchParams({ room: code }); if (net && net.kind === 'local') q.set('net', 'local');
  return location.origin + location.pathname + '?' + q;
}
function setUrl(code) {
  const q = new URLSearchParams(location.search);
  if (code) q.set('room', code); else q.delete('room');
  const s = q.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
}
function showOnline(code = '', err = '') {
  modal(`<div class="ttl online">
    <div class="logo"><div class="pre">CHEMYTH LAB ・ 元素盤</div><h2>オンライン対戦</h2></div>
    <p class="intro sm">友だちとルームを作って対戦します。2〜8人で遊べて、空いた席はライバルAIが埋めるので常に8人で戦います。</p>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <div class="ofield"><label for="oName">表示名</label><input id="oName" maxlength="${NAME_MAX}" autocomplete="nickname" placeholder="例：アボガドロ好き" value="${esc(savedName())}"></div>
    <div class="ocards">
      <div class="ocard"><h4>ルームを作る</h4><p class="mut">ホストになり、招待リンクを友だちに送る</p><button class="${code ? '' : 'primary '}big" id="oCreate">ルームを作る</button></div>
      <div class="ocard"><h4>コードで参加</h4><p class="mut">友だちから聞いた5文字のコード</p><div class="jrow"><input id="oCode" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCDE" value="${esc(code)}"><button class="${code ? 'primary ' : ''}" id="oJoin">参加</button></div></div>
    </div>
    <div class="row go"><button id="oBack">戻る</button></div></div>`, 'titleBox');
  const name = () => { const n = cleanName($('#oName').value); if (!n) { toast('表示名を入力してください'); $('#oName').focus(); return null; } saveName(n); return n; };
  const busy = on => { for (const id of ['#oCreate', '#oJoin', '#oBack']) $(id).disabled = on; };
  $('#oBack').onclick = () => { setUrl(null); showStart(); };
  $('#oCreate').onclick = async () => {
    const n = name(); if (!n) return;
    busy(true); $('#oCreate').textContent = '接続中…';
    try { net = await Session.create(n, onNet); window.__net = net; setUrl(net.code); showLobby(); }
    catch (e) { net = null; showOnline('', netError(e)); }
  };
  const join = async () => {
    const n = name(); if (!n) return;
    const c = normCode($('#oCode').value); if (!c) { toast('コードは5文字です（英数字）'); return; }
    busy(true); $('#oJoin').textContent = '接続中…';
    try { net = await Session.join(c, n, onNet); window.__net = net; setUrl(c); showLobby(); }
    catch (e) { net = null; showOnline(c, netError(e)); }
  };
  $('#oJoin').onclick = join;
  $('#oCode').onkeydown = e => { if (e.key === 'Enter') join(); };
}
const netError = e => (e && e.message && /[ぁ-んァ-ン]/.test(e.message) ? e.message : '接続できませんでした。通信環境を確認してください');

function showLobby() {
  const lb = net.client.lobby, me_ = net.cid, host = net.isHost;
  const mem = lb ? lb.members : [];
  const link = roomLink(net.code);
  const seats = [];
  for (let i = 0; i < 8; i++) {
    const m = mem[i];
    seats.push(m ? `<div class="mem${m.cid === me_ ? ' me' : ''}"><span class="no">${i + 1}</span><span class="nm">${esc(m.name)}</span>${lb && m.cid === lb.host ? '<span class="badge">ホスト</span>' : ''}${m.cid === me_ ? '<span class="you">あなた</span>' : ''}</div>`
      : `<div class="mem ai"><span class="no">${i + 1}</span><span class="nm">ライバルAI</span></div>`);
  }
  const diff = lb ? lb.diff : 'normal';
  modal(`<div class="lobby">
    <div class="lhead"><span class="mut">ルームコード</span><span class="code" id="lCode">${esc(net.code)}</span></div>
    <div class="share"><input id="lLink" readonly value="${esc(link)}"><button id="lCopy">リンクをコピー</button></div>
    ${!lb ? '<p class="mut wait">ホストに接続しています…</p>' : ''}
    <h4>参加者 ${mem.length}/8 <small class="mut">（空き席はライバルAI）</small></h4>
    <div class="mems">${seats.join('')}</div>
    <div class="row"><span class="ol">AIの強さ</span>${host ? `<span class="seg" id="lDiff">${Object.keys(DIFFS).map(k => `<button data-v="${k}" class="${k === diff ? 'on' : ''}">${DIFFS[k].n}</button>`).join('')}</span>` : `<b>${DIFFS[diff] ? DIFFS[diff].n : ''}</b>`}</div>
    <p class="mut">準備時間はホストが管理します（全員が「準備完了」を押すと早く始まります）。</p>
    <div class="row go">${host ? `<button class="primary big" id="lStart" ${mem.length < 2 ? 'disabled' : ''}>開始</button>` : '<span class="wait">ホストの開始を待っています…</span>'}<button id="lLeave">退出</button></div>
    ${host && mem.length < 2 ? '<p class="mut c">リンクを送って、もう1人以上が参加すると開始できます。</p>' : ''}
  </div>`, 'titleBox lobbyBox');
  $('#lCopy').onclick = () => copyText(link);
  $('#lLink').onclick = e => e.target.select();
  $('#lLeave').onclick = () => leaveOnline();
  if (host) {
    seg('#lDiff', v => net.host.setDiff(v));
    $('#lStart').onclick = () => { if (!net.host.start()) toast('2人以上で開始できます'); };
  }
}
function copyText(s) {
  const ok = () => toast('招待リンクをコピーしました');
  const fallback = () => { const i = $('#lLink'); i.select(); try { document.execCommand('copy'); ok(); } catch { toast('コピーできませんでした。リンクを長押しでコピーしてください'); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(ok, fallback); else fallback();
}
async function leaveOnline(msg) {
  const n = net; net = null; mode = 'solo'; window.__net = null;
  cancelAnimationFrame(raf); clearInterval(timerId); bt = null; G = null; me = null; flip = false; augOpen = false; keys = {};
  $('#tokens').innerHTML = ''; $('#banner').classList.remove('show'); $('#fx').innerHTML = '';
  setUrl(null); syncTopBtns();
  if (n) await n.leave();
  if (msg) { modal(`<div class="over"><h2>ゲーム終了</h2><p>${esc(msg)}</p><div class="row go"><button class="primary big" id="mBack">タイトルへ</button></div></div>`, 'overBox'); $('#mBack').onclick = showStart; }
  else showStart();
}

// ---------- オンライン：ゲーム ----------
function onNet(ev, data) {
  if (!net) return;
  switch (ev) {
    case 'lobby': if (!online()) showLobby(); break;
    case 'reject': { const m = REJECT[data] || '参加できませんでした'; const c = net.code; net.leave(); net = null; showOnline(c, m); break; }
    case 'start': startOnline(); break;
    case 'snap': onSnap(net.client.snap); break;
    case 'combat': onCombat(data); break;
    case 'end': if (!(G && G.over)) leaveOnline(data === 'host-left' ? 'ホストが退出したため、このゲームは終了しました。' : 'ホストがゲームを終了しました。'); break;
  }
}
function startOnline() {
  mode = 'online'; speed = 1; keys = {}; augOpen = false; closeModal(); syncTopBtns();
  cancelAnimationFrame(raf); clearInterval(timerId); bt = null; flip = false;
  seen.clear(); seenOn = false;
  if (net.client.snap) onSnap(net.client.snap);
}
function onSnap(s) {
  if (!net || !net.client.G || !online()) return;
  const before = me ? new Set(G.allUnits(me).filter(u => u.uid < 0).map(u => u.id + ':' + u.star)) : new Set();
  G = net.client.G; me = G.me;
  // 予測で表示済みのユニットが本物のIDで届いたら、登場演出を繰り返さない
  if (before.size) for (const u of G.allUnits(me)) if (before.has(u.id + ':' + u.star)) seen.add(u.uid);
  if (drag && drag.on) { deferred = true; return; } // 持っているユニットを手から奪わない：描画は手を離すまで待つ
  deferred = false;
  if (!seenOn) { render(); seenOn = true; layout(); }
  if (augOpen && !me.pendingAug) { closeAug(); const a = AUG_N[me.augs[me.augs.length - 1]]; if (a) toast(`研究テーマ「${a}」を自動選択しました`); }
  if (s.over) { if (!keys.over) { keys.over = 1; resultOnline(); setTimeout(() => { if (online() && G.over) showOver(); }, 1600); } return; }
  if (s.phase === 'plan' && keys.plan !== s.label) { keys.plan = s.label; enterPlanOnline(); return; }
  if (s.phase === 'result' && keys.result !== s.label) { keys.result = s.label; resultOnline(); return; }
  if (s.phase === 'combat' && keys.combat !== s.label && !bt) { clearInterval(timerId); closeAug(); }
  render();
}
function enterPlanOnline() {
  cancelAnimationFrame(raf); bt = null; flip = false; replay = null;
  $('#banner').classList.remove('show'); $('#fx').innerHTML = '';
  render(); musicMode('plan'); sfx('round');
  const pve = G.isPvE(), o = G.opponent;
  if (me.alive) stageFx(`ROUND ${G.label}`, pve ? '実験ラウンド ― 不純物を取り除け' : o ? `次の対戦：${esc(o.name)}${!o.human && titleOf(o.name) ? `「${titleOf(o.name)}」` : ''}` : '');
  else stageFx(`ROUND ${G.label}`, '観戦中');
  if (me.alive && me.pendingAug && !augOpen) showAug(); else if (pve && me.alive && meta.P.opt.quiz) showQuiz({});
  startTimer();
}
function onCombat(m) {
  if (keys.combat === m.label) return; keys.combat = m.label;
  clearInterval(timerId); closeAug(); closeQuiz(); cancelDrag(); hideInfo();
  const seat = net.seat, f = m.fights.find(x => x.a === seat || (x.b === seat && !x.ghost));
  musicMode('combat'); sfx('fight');
  if (!f) { render(); stageFx('反応開始', '観戦中', 'go'); return; }
  flip = f.a !== seat; // 自分がチーム1なら描画だけ180°回す（シミュレーションはホストと同じ向きで作る）
  bt = new Battle(f.A, f.B, f.seed, true);
  const opp = f.pve ? null : G.players[flip ? f.a : f.b];
  bt.oppName = opp ? opp.name + (f.ghost ? '（影）' : '') : '実験：不純物';
  replay = { label: m.label, f, myTeam: flip ? 1 : 0, checked: false };
  net.view = { label: m.label, flip, myTeam: replay.myTeam };
  render(); buildBattleTokens(); stageFx('反応開始', esc(bt.oppName), 'go'); announceRx();
  playBattle(checkReplay);
}
// 手元で再生した戦闘がホストの確定結果と一致するか確認する
function checkReplay() {
  if (!replay || replay.checked || !bt || !bt.over) return;
  replay.checked = true;
  const surv = bt.units.filter(u => u.alive).map(u => [u.uid, Math.round(u.hp)]), r = replay.f.res;
  const ok = bt.winner === r.w && JSON.stringify(surv) === JSON.stringify(r.surv);
  net.replays.push({ label: replay.label, seat: net.seat, myTeam: replay.myTeam, flip, ok, winner: bt.winner, hostWinner: r.w, surv, hostSurv: r.surv, t: +bt.t.toFixed(2) });
  if (!ok) console.warn('[net] 戦闘の再生がホストの結果と一致しません', replay.label);
}
function finishReplay() {
  if (!bt) return;
  cancelAnimationFrame(raf);
  if (!bt.over) { bt.rec = false; while (!bt.over) bt.step(TICK); bt.ev = []; buildBattleTokens(); }
  checkReplay();
}
function resultOnline() {
  finishReplay();
  const r = me.lastResult;
  if (r && bt) showBanner(r);
  else if (r && r.loot && r.loot.items) toast('入手：' + r.loot.items.map(i => ITEMS[i].ic + ITEMS[i].n).join('　'));
  if (!me.alive && !keys.dead) { keys.dead = 1; toast(`脱落… ${me.place}位　（最後まで観戦できます）`); }
  render();
}
function syncTopBtns() {
  $('#btnSpeed').disabled = online(); $('#btnSpeed').textContent = '×' + speed;
  $('#btnSpeed').title = online() ? 'オンラインでは等速' : '戦闘速度';
  $('#btnExit').hidden = !online();
}

// ---------- 戦闘描画 ----------
function stageFx(main, sub, cls = '') {
  const s = $('#stageFx'); if (!s) return;
  s.className = ''; s.innerHTML = `<b>${main}</b>${sub ? `<small>${sub}</small>` : ''}`;
  void s.offsetWidth; s.className = 'show ' + cls;
}
function buildBattleTokens() {
  const box = $('#tokens'); box.innerHTML = ''; btEls.clear();
  for (const u of bt.units) {
    const t = mkToken(u.def.id, u.star, u.items, flip ? 1 - u.team : u.team, true, !!stage); t.dataset.bid = u.uid;
    if (!u.alive) t.classList.add('dead');
    box.appendChild(t);
    btEls.set(u.uid, { t, h: t.querySelector('.h'), s: t.querySelector('.s'), m: t.querySelector('.mp i'), tag: t.querySelector('.tag'), body: t.querySelector('.body'), tags: '' });
  }
  fitPlates(box);
  updateTokens();
}
// 戦闘中の駒のワールド座標（移動中は前のマスとの間を補間。flip 時は180°回す）
function unitW(u) {
  const f = (c, r) => (flip ? cellWorld(COLS - 1 - c, ROWS - 1 - r) : cellWorld(c, r));
  let [x, z] = f(u.pos.c, u.pos.r);
  if (u.moveT > 0) { const k = u.moveT / MOVE_T, [px, pz] = f(u.prev.c, u.prev.r); x += (px - x) * k; z += (pz - z) * k; }
  return [x, z];
}
function unitXY(u) {
  if (stage) { const [x, z] = unitW(u); return stage.project(x, TOKEN_Y, z); }
  let [x, y] = bxy(u.pos.c, u.pos.r);
  if (u.moveT > 0) { const k = u.moveT / MOVE_T, [px, py] = bxy(u.prev.c, u.prev.r); x += (px - x) * k; y += (py - y) * k; }
  return [x, y];
}
function updateTokens() {
  if (stage) stage.setUnits(bt.units.map(u => { const [x, z] = unitW(u), d = u.def; return { key: 'b' + u.uid, id: d.id, team: flip ? 1 - u.team : u.team, cost: d.cost, star: u.star, aura: hexInt(auraOf(d.id)), x, z, stun: u.st.stun > 0, dead: !u.alive }; }));
  for (const u of bt.units) {
    const e = btEls.get(u.uid); if (!e || !u.alive) continue;
    const [x, y] = unitXY(u); e.t.style.transform = `translate(${x}px,${y}px)`;
    if (stage) { const row = flip ? ROWS - 1 - u.pos.r : u.pos.r; if (e.row !== row) { e.row = row; e.t.style.setProperty('--hw', cellPx(3, row) + 'px'); } }
    const sh = bt.shieldOf(u), den = Math.max(u.maxHp, u.hp + sh);
    e.h.style.width = u.hp / den * 100 + '%'; e.s.style.left = u.hp / den * 100 + '%'; e.s.style.width = sh / den * 100 + '%';
    e.m.style.width = (u.maxMana ? u.mana / u.maxMana * 100 : 0) + '%';
    e.t.classList.toggle('stun', u.st.stun > 0);
    const tg = (u.st.hplus ? '<b class="H">H⁺</b>' : '') + (u.st.oh ? '<b class="O">OH⁻</b>' : '') + (u.burns.length ? '<b class="B">燃</b>' : '') + (u.st.shA || u.st.shM ? '<b class="S">↓</b>' : '');
    if (tg !== e.tags) { e.tags = tg; e.tag.innerHTML = tg; }
  }
}
const fxBox = () => $('#fx');
function ftext(x, y, s, col, cls, dur = 750) {
  const box = fxBox(); if (box.childElementCount > 70) return;
  const d = el('div', 'ft ' + (cls || '')); d.textContent = s; d.style.color = col; d.style.left = x + 'px'; d.style.top = y + 'px'; box.appendChild(d);
  d.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: `translate(-50%,calc(-50% - ${hexW * .55}px))`, opacity: 0 }], { duration: dur / Math.sqrt(speed), easing: 'ease-out' }).onfinish = () => d.remove();
}
function playEvents() {
  const evs = bt.ev; if (!evs.length) return; bt.ev = [];
  const box = fxBox(), sp = Math.sqrt(speed);
  for (const e of evs) {
    switch (e.k) {
      case 'dmg': {
        if (!e.dot) { sfx(e.crit ? 'crit' : 'hit'); if (stage) stage.hitFx('b' + e.u.uid, e.crit); }
        if (e.dot && e.a < 12) break;
        const [x, y] = unitXY(e.u), j = (Math.random() - .5) * hexW * .5;
        ftext(x + j, y - hexW * .3, Math.round(e.a) + (e.crit ? '!' : ''), e.type === 'phys' ? '#ffb38a' : e.type === 'magic' ? '#9ad1ff' : '#ffffff', e.crit ? 'big' : '');
        break;
      }
      case 'heal': { sfx('heal'); if (stage) stage.healFx('b' + e.u.uid); const [x, y] = unitXY(e.u); ftext(x, y - hexW * .2, '+' + Math.round(e.a), '#6dff9c'); break; }
      case 'text': { if (e.big) sfx('neutral'); const [x, y] = unitXY(e.u); ftext(x, y - hexW * .5, e.s, e.col, e.big ? 'big' : '', 900); break; }
      case 'cast': {
        sfx('cast'); if (stage) stage.castFx('b' + e.u.uid);
        const [x, y] = unitXY(e.u); ftext(x, y - hexW * .62, e.s, '#7df9ff', 'skill', 1100);
        const b = btEls.get(e.u.uid); if (b && !RM.matches) b.body.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)', boxShadow: '0 0 18px #7df9ff' }, { transform: 'scale(1)' }], { duration: 350 / sp });
        break;
      }
      case 'atk': {
        if (stage) { if (e.ranged) sfx('shot'); stage.attack('b' + e.a.uid, 'b' + e.b.uid, e.ranged, (e.a.team ^ flip) ? 0xff8fa3 : 0x9fe6ff); break; }
        const [ax, ay] = unitXY(e.a), [bx, by] = unitXY(e.b);
        if (e.ranged) {
          sfx('shot');
          if (box.childElementCount > 70) break;
          const p = el('div', 'proj'); p.style.background = (e.a.team ^ flip) ? '#ff9aa8' : '#9fd0ff'; box.appendChild(p);
          p.animate([{ transform: `translate(${ax}px,${ay}px)` }, { transform: `translate(${bx}px,${by}px)` }], { duration: 150 / sp }).onfinish = () => p.remove();
        } else {
          const b = btEls.get(e.a.uid), dx = (bx - ax) * .28, dy = (by - ay) * .28;
          if (b && !RM.matches) b.body.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 170 / sp });
        }
        break;
      }
      case 'aoe': {
        if (e.r >= 1) sfx('boom');
        if (stage) { const [wx, wz] = flip ? cellWorld(COLS - 1 - e.pos.c, ROWS - 1 - e.pos.r) : cellWorld(e.pos.c, e.pos.r); stage.ringFx(wx, wz, e.r + .55, hexInt(e.col), .5 + e.r * .12); if (e.r >= 1) stage.burst(wx, .5, wz, hexInt(e.col), 10 + e.r * 8, 2 + e.r); break; }
        const [x, y] = bxy(e.pos.c, e.pos.r), s = (2 * e.r + 1) * hexW, r = el('div', 'ring');
        r.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px;--col:${e.col}`; box.appendChild(r);
        r.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: 480 / sp, easing: 'ease-out' }).onfinish = () => r.remove();
        break;
      }
      case 'beam': {
        if (stage) { stage.beamFx(stage.pos('b' + e.a.uid), stage.pos('b' + e.b.uid), hexInt(e.col)); break; }
        const [ax, ay] = unitXY(e.a), [bx, by] = unitXY(e.b), len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax), l = el('div', 'beam');
        l.style.cssText = `left:${ax}px;top:${ay}px;width:${len}px;transform:rotate(${ang}rad);--col:${e.col}`; box.appendChild(l);
        l.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 340 / sp }).onfinish = () => l.remove();
        break;
      }
      case 'death': { sfx('death'); if (stage) stage.kill('b' + e.u.uid); const b = btEls.get(e.u.uid); if (b) b.t.classList.add('dead'); break; }
    }
  }
}

// ---------- ドラッグ & タップ ----------
const myUnit = uid => G.allUnits(me).find(u => u.uid === +uid);
function cancelDrag() {
  if (!drag) return;
  if (drag.ghost) drag.ghost.remove(); if (drag.src) drag.src.classList.remove('srcDrag');
  document.body.classList.remove('dragging', 'dragUnit'); document.querySelectorAll('.hover').forEach(e => e.classList.remove('hover'));
  if (stage) stage.hover(null);
  drag = null;
}
function dropTarget(x, y) {
  const e = document.elementFromPoint(x, y); if (!e) return null;
  const tok = e.closest('.token');
  if (tok && tok.dataset.uid) {
    const u = myUnit(tok.dataset.uid);
    if (u) { const slot = tok.closest('.slot'); return slot ? { type: 'bench', i: +slot.dataset.i, unit: u, el: slot } : { type: 'hex', c: u.c, r: u.r, unit: u, el: tok }; }
  }
  const d = e.closest('[data-drop]'); if (!d) return null;
  if (d.dataset.drop === 'hex') return { type: 'hex', c: +d.dataset.c, r: +d.dataset.r, el: d };
  if (d.dataset.drop === 'bench') return { type: 'bench', i: +d.dataset.i, unit: me.bench[+d.dataset.i], el: d };
  return { type: 'sell', el: d };
}
document.addEventListener('pointerdown', e => {
  if (!G || !me || e.button > 0 || !me.alive) return;
  const tok = e.target.closest('.token[data-uid]'), item = e.target.closest('.item[data-ii]');
  if (!tok && !item) return;
  if (tok && tok.closest('#modal')) return;
  drag = { x: e.clientX, y: e.clientY, src: tok || item, kind: tok ? 'unit' : 'item', on: false, id: e.pointerId };
  if (tok) { drag.unit = myUnit(tok.dataset.uid); drag.uid = +tok.dataset.uid; } else drag.ii = +item.dataset.ii;
});
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
    const u = drag.kind === 'unit' ? myUnit(drag.uid) : null;
    if (drag.kind === 'unit' && (!u || (me.board.includes(u) && G.phase !== 'plan'))) { drag = null; return; }
    drag.on = true; hideInfo(); sfx('pick');
    const g = drag.src.cloneNode(true); g.classList.add('ghost'); g.style.transform = ''; g.style.left = g.style.top = '0';
    document.body.appendChild(g); drag.ghost = g; drag.src.classList.add('srcDrag');
    document.body.classList.add('dragging'); if (drag.kind === 'unit') { document.body.classList.add('dragUnit'); $('#sellHint').textContent = `売却 +${sellValue(u)}G`; }
  }
  drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
  document.querySelectorAll('.hover').forEach(x => x.classList.remove('hover'));
  const t = dropTarget(e.clientX, e.clientY);
  if (t && t.el && (drag.kind === 'unit' || t.unit)) t.el.classList.add('hover');
  if (stage) { if (t && t.type === 'hex' && (drag.kind === 'unit' || t.unit)) stage.hover(t.c, 4 + t.r); else stage.hover(null); }
  e.preventDefault();
}, { passive: false });
function endPointer(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  if (!d.on) { // タップ
    drag = null;
    if (d.kind === 'unit' && d.unit) showUnitInfo(d.unit.id, d.unit.star, d.unit.items); else if (d.kind === 'item' && me.items[d.ii]) showItemInfo(me.items[d.ii]);
    return;
  }
  const t = e.type === 'pointercancel' ? null : dropTarget(e.clientX, e.clientY);
  cancelDrag();
  drop(d, t);
  if (deferred && online()) onSnap(net.client.snap); else render(); // ドラッグ中に届いたスナップショットをここで反映
}
// 手を離した時点の最新状態でユニットを引き直してから操作する
function drop(d, t) {
  if (!t || !G) return;
  if (d.kind === 'item') {
    if (!t.unit) return;
    const r = act({ t: 'equip', ii: d.ii, uid: t.unit.uid });
    if (r === 'full') toast('器具は3つまで'); else if (r === 'combined') toast('合成：' + ITEMS[t.unit.items[t.unit.items.length - 1]].n + ' など');
    if (r && G.phase !== 'plan' && me.board.includes(t.unit) && r !== 'full') toast('次の戦闘から有効');
    return;
  }
  const u = myUnit(d.uid); if (!u) return;
  const onBoard = me.board.includes(u), plan = G.phase === 'plan';
  if (t.type === 'sell') { if (onBoard && !plan) return toast('戦闘中の盤面は変更できない'); act({ t: 'sell', uid: u.uid }); return; }
  if (t.type === 'hex') {
    if (!plan) return toast('戦闘中の盤面は変更できない');
    if (act({ t: 'move', uid: u.uid, to: { board: 1, c: t.c, r: t.r } }) === 'full') toast(`配置上限 ${G.maxUnits(me)} 体（レベルを上げると増える）`);
  } else if (t.type === 'bench') {
    if (!plan && (onBoard || (t.unit && me.board.includes(t.unit)))) return toast('戦闘中の盤面は変更できない');
    act({ t: 'move', uid: u.uid, to: { bench: t.i } });
  }
}
// タッチ端末では、ドラッグを離した直後（約0.3秒以内）のタップにブラウザが click を出さないことがある。
// 動かさず短く触れて離したのに click が来なければ、こちらで click を発生させる。
let tapStart = null, synth = null;
document.addEventListener('pointerdown', e => { tapStart = e.pointerType === 'touch' ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), el: e.target } : null; }, true);
document.addEventListener('pointerup', e => {
  const s0 = tapStart; tapStart = null;
  if (!s0 || e.pointerId !== s0.id || e.pointerType !== 'touch' || e.target !== s0.el) return;
  if (Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10 || performance.now() - s0.t > 700) return;
  const t = e.target; if (t.closest('input, label, select, textarea, a, .token, .item')) return;
  let native = false; const seenClick = ev => { if (ev.isTrusted) native = true; };
  document.addEventListener('click', seenClick, true);
  setTimeout(() => { document.removeEventListener('click', seenClick, true); if (!native && t.isConnected) { synth = { el: t, t: performance.now() }; t.click(); } }, 80);
}, true);
document.addEventListener('click', e => { // 遅れて届いた本物の click で二重に反応しないようにする
  if (e.isTrusted && synth && e.target === synth.el && performance.now() - synth.t < 600) { e.stopImmediatePropagation(); e.preventDefault(); synth = null; }
}, true);
document.addEventListener('pointerup', endPointer);
document.addEventListener('pointercancel', endPointer);
document.addEventListener('click', e => {
  const cb = e.target.closest('button, .pl, .trait, .mode'); if (cb && !['btnXP', 'btnRoll', 'btnLock'].includes(cb.id)) sfx('click');
  const bt_ = e.target.closest('.token[data-bid]');
  if (bt_ && bt) { const u = bt.units[+bt_.dataset.bid]; if (u) showUnitInfo(u.def.id, u.star, u.items, u.alive ? u : null); return; }
  if (!e.target.closest('#info') && !e.target.closest('.token') && !e.target.closest('.item') && !e.target.closest('.card') && !e.target.closest('.trait')) hideInfo();
});
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- ボタン ----------
$('#btnGo').onclick = go;
$('#btnSpeed').onclick = () => { if (online()) return; speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $('#btnSpeed').textContent = '×' + speed; };
$('#btnDex').onclick = () => showDex('how');
// サウンド設定
function syncSnd() { $('#btnSnd').textContent = snd.sfx || snd.music ? '🔊' : '🔇'; }
$('#btnSnd').onclick = e => {
  e.stopPropagation();
  if (!$('#info').hidden && $('#sVol')) return hideInfo();
  showInfo(`<h3>サウンド</h3>
    <label class="sndRow"><input type="checkbox" id="sSfx" ${snd.sfx ? 'checked' : ''}> 効果音・振動</label>
    <label class="sndRow"><input type="checkbox" id="sMus" ${snd.music ? 'checked' : ''}> BGM</label>
    <label class="sndRow">音量 <input type="range" id="sVol" min="0" max="100" value="${Math.round(snd.vol * 100)}"></label>`);
  $('#sSfx').onchange = ev => { setSound('sfx', ev.target.checked); syncSnd(); sfx('buy'); };
  $('#sMus').onchange = ev => { setSound('music', ev.target.checked); syncSnd(); };
  $('#sVol').oninput = ev => setSound('vol', ev.target.value / 100);
  $('#sVol').onchange = () => sfx('buy');
};
syncSnd();
// ショップの開閉（スマホで盤面を広く使うため）。状態は端末に保存
const SHOP_KEY = 'autochemyth.shopClosed';
function setShop(closed) {
  $('#app').classList.toggle('shopClosed', closed); $('#btnShop').textContent = closed ? '▲' : '▼'; $('#btnShop').title = closed ? 'ショップを開く' : 'ショップを閉じる';
  try { localStorage.setItem(SHOP_KEY, closed ? '1' : ''); } catch { /* 保存できなくても動作に支障なし */ }
}
$('#btnShop').onclick = () => setShop(!$('#app').classList.contains('shopClosed'));
{ let c = false; try { c = !!localStorage.getItem(SHOP_KEY); } catch { /* 既定は開いた状態 */ } setShop(c); }
$('#btnXP').onclick = () => { if (G && act({ t: 'xp' })) render(); };
$('#btnRoll').onclick = () => { if (G && act({ t: 'roll' })) render(); };
$('#btnLock').onclick = () => { if (G && act({ t: 'lock', on: !me.lock })) renderShop(); };
$('#btnExit').onclick = () => {
  if (!online()) return;
  modal(`<h2>ルームから退出しますか？</h2><p>${net.isHost ? 'あなたはホストです。退出すると<b>全員のゲームが終了</b>します。' : 'あなたの席は、以後ライバルAIが代行します。同じ端末で同じリンクを開けば、ゲーム中は席に戻れます。'}</p>
    <div class="row go"><button id="xNo">続ける</button><button class="primary" id="xYes">退出する</button></div>`);
  $('#xNo').onclick = () => { closeModal(); if (augOpen) showAug(); };
  $('#xYes').onclick = () => leaveOnline();
};
document.addEventListener('keydown', e => {
  if (!G || !me || !$('#modal').hidden || e.target.closest('input')) return;
  if (e.code === 'KeyD') $('#btnRoll').click(); else if (e.code === 'KeyF') $('#btnXP').click(); else if (e.code === 'Space') { e.preventDefault(); go(); }
});
window.addEventListener('resize', layout);
// 盤面に使える領域（中央カラム）の大きさが変わったら盤面を引き直す。ショップの開閉や画面回転、アドレスバーの出入りを含む
let roW = 0, roH = 0;
new ResizeObserver(() => { const w = $('#center'); if (Math.abs(w.clientWidth - roW) + Math.abs(w.clientHeight - roH) > 2) { roW = w.clientWidth; roH = w.clientHeight; layout(); } }).observe($('#center'));
// 招待リンク（?room=CODE）で開いたら参加画面から
{ const c = normCode(new URLSearchParams(location.search).get('room')); if (c) showOnline(c); else showStart(); }
setTimeout(initStage, 30);
