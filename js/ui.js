// ============================================================
//  UI（描画・ドラッグ操作・戦闘演出）
// ============================================================
import { Game, sellValue, XP_NEED, ODDS, DIFFS, MAX_LEVEL } from './game.js';
import { UNITS, TRAITS, ITEMS, COMPS, FULL_ITEMS, BY_COST, STAR_HP, STAR_AD, NEUTRAL, traitTier, fmt, combine } from './data.js';
import { COLS, ROWS, TICK, MOVE_T, TIME_LIMIT } from './combat.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const SHORT = { NG: 'ﾆﾄﾛ', AcOH: 'CH₃COOH' };
const COSTCOL = ['#5c4a4a', '#8d99ae', '#3fb96b', '#3d8bfd', '#b05cff', '#ffb703'];

let G = null, me = null, hexW = 60, hexH = 69, speed = 1, bt = null /*表示中の戦闘*/, btEls = new Map(), raf = 0;
let planEnd = 0, planDur = 0, timerId = 0, drag = null, opts = { diff: 'normal', timer: true };

// ---------- 座標 ----------
const cellXY = (c, r) => [c * hexW + (r & 1 ? hexW / 2 : 0) + hexW / 2, r * hexH * 0.75 + hexH / 2];
function layout() {
  const b0 = $('#board'); b0.style.width = b0.style.height = '0px';
  const w = $('#boardWrap'), W = w.clientWidth, H = w.clientHeight;
  hexW = Math.max(30, Math.min(W / 7.5, H / 7.22, 88)); hexH = hexW * 1.1547;
  document.documentElement.style.setProperty('--hw', hexW + 'px');
  const b = $('#board'); b.style.width = hexW * 7.5 + 'px'; b.style.height = hexH * 6.25 + 'px';
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
function fsize(s) { const n = [...s].length; return n <= 2 ? .3 : n <= 4 ? .24 : n === 5 ? .2 : n <= 7 ? .15 : .13; }
function mkToken(id, star, items, team, bars) {
  const d = UNITS[id], f = SHORT[id] || d.f;
  const t = el('div', `token c${d.cost} t${team}`);
  t.innerHTML = (bars ? '<div class="bars"><div class="bar hp"><i class="h"></i><i class="s"></i></div><div class="bar mp"><i></i></div></div>' : '') +
    `<div class="body"><span class="f" style="--fs:${fsize(f)}">${f}</span></div>` +
    (d.mob ? '' : `<div class="stars s${star}">${'★'.repeat(star)}</div>`) +
    `<div class="its">${(items || []).map(i => `<span>${ITEMS[i].ic}</span>`).join('')}</div>` + (bars ? '<div class="tag"></div>' : '');
  return t;
}
function place(t, c, r) { const [x, y] = cellXY(c, r); t.style.transform = `translate(${x}px,${y}px)`; }

// ---------- 描画 ----------
function render() { renderTop(); renderTraits(); renderBoard(); renderBench(); renderItems(); renderShop(); renderScore(); }

function renderTop() {
  $('#stageLbl').textContent = G.label;
  const pve = G.isPvE(); $('#roundKind').textContent = pve ? '実験' : '対戦'; $('#roundKind').style.background = pve ? '#2d5a3a' : '#5a2d3a';
  const ph = G.phase;
  $('#phaseLbl').textContent = ph === 'plan' ? (pve ? '準備フェーズ ｜ 不純物を取り除け' : `準備フェーズ ｜ 次の相手: ${G.opponent ? G.opponent.name : '?'}`) : ph === 'combat' ? '戦闘中' : '結果';
  $('#btnGo').disabled = ph !== 'plan'; $('#btnGo').textContent = ph === 'plan' ? '戦闘開始' : '戦闘中…';
  $('#app').classList.toggle('plan', ph === 'plan');
  $('#oppTag').textContent = ph === 'plan' ? '' : (bt && bt.oppName ? '▲ ' + bt.oppName : '');
  const n = me.board.length, mx = G.maxUnits(me), cap = $('#capTag');
  cap.textContent = `配置 ${n}/${mx}`; cap.className = n > mx ? 'over' : n < mx && me.bench.some(Boolean) ? 'under' : '';
}

function renderTraits() {
  const box = $('#traits'), cnt = G.traits(me); box.innerHTML = '';
  const list = Object.keys(cnt).map(k => ({ k, c: cnt[k], t: traitTier(k, cnt[k]) }))
    .sort((a, b) => (b.t > 0) - (a.t > 0) || b.t - a.t || b.c - a.c);
  if (!list.length) { box.appendChild(el('div', 'traitsEmpty', 'ユニットを盤面に置くと<br>シナジーが表示されます')); return; }
  for (const { k, c, t } of list) {
    const T = TRAITS[k], d = el('div', 'trait' + (t ? ' act' : ''));
    d.style.setProperty('--tc', T.col);
    d.innerHTML = `<div class="ic">${T.ic}</div><div><div class="nm">${T.n}</div><div class="bp">${T.bp.map((b, i) => (i === t - 1 ? `<b class="on">${b}</b>` : b)).join(' / ')}</div></div><div class="ct">${c}</div>`;
    d.onclick = e => { e.stopPropagation(); showTraitInfo(k, t); };
    box.appendChild(d);
  }
}

function renderBoard(force) {
  if (G.phase !== 'plan' && !force) return;
  if (G.phase !== 'plan') { if (bt) buildBattleTokens(); return; }
  const box = $('#tokens'); box.innerHTML = ''; btEls.clear();
  for (const u of me.board) {
    const t = mkToken(u.id, u.star, u.items, 0); t.dataset.uid = u.uid; t.dataset.c = u.c; t.dataset.r = u.r;
    if (u.justMerged && Date.now() - u.justMerged < 800) t.classList.add('merge');
    place(t, u.c, 4 + u.r); box.appendChild(t);
  }
}

function renderBench() {
  const row = $('#benchRow'); row.innerHTML = '';
  me.bench.forEach((u, i) => {
    const s = el('div', 'slot'); s.dataset.drop = 'bench'; s.dataset.i = i;
    if (u) { const t = mkToken(u.id, u.star, u.items, 0); t.dataset.uid = u.uid; if (u.justMerged && Date.now() - u.justMerged < 800) t.classList.add('merge'); s.appendChild(t); }
    row.appendChild(s);
  });
}

function renderItems() {
  const row = $('#itemsRow'); row.innerHTML = '';
  if (!me.items.length) { row.appendChild(el('span', 'lbl', '器具なし（実験ラウンドで入手 → ユニットにドラッグ）')); return; }
  me.items.forEach((id, i) => { const d = el('div', 'item' + (ITEMS[id].comp ? '' : ' full'), ITEMS[id].ic); d.dataset.ii = i; d.title = ITEMS[id].n; row.appendChild(d); });
}

function renderShop() {
  const box = $('#shop'), cnt = G.traits(me); box.innerHTML = '';
  me.shop.forEach((id, i) => {
    if (!id) { box.appendChild(el('div', 'card empty')); return; }
    const d = UNITS[id], own = G.allUnits(me).filter(u => u.id === id), n1 = own.filter(u => u.star === 1).length;
    const c = el('div', `card c${d.cost}` + (own.length ? ' own' : '') + (n1 % 3 === 2 ? ' own3' : '') + (G.canBuy(me, i) ? '' : ' no'));
    c.innerHTML = `<div class="fm" style="font-size:${[...(SHORT[id] || d.f)].length > 5 ? 12 : ''}px">${SHORT[id] || d.f}</div><div class="nm">${d.n}</div>` +
      `<div class="trs">${d.traits.map(t => `<span class="${cnt[t] ? 'act' : ''}" style="color:${cnt[t] ? '' : TRAITS[t].col}">${TRAITS[t].n}</span>`).join('')}</div>` +
      `<div class="cost">${d.cost}G</div><div class="i">i</div>`;
    c.onclick = e => {
      e.stopPropagation();
      if (e.target.classList.contains('i')) return showUnitInfo(id, 1, []);
      if (G.buy(me, i)) render(); else toast(me.gold < d.cost ? 'ゴールドが足りない' : 'ベンチが満員');
    };
    box.appendChild(c);
  });
  $('#gold').textContent = '💰' + me.gold;
  const s = Math.abs(me.streak), inc = (G.stage === 1 ? 3 : 5) + Math.min(me.intCap, Math.floor(me.gold / 10)) + (s >= 5 ? 3 : s >= 4 ? 2 : s >= 2 ? 1 : 0);
  $('#incomeLbl').textContent = `次R +${inc}（利息${Math.min(me.intCap, Math.floor(me.gold / 10))}）`;
  $('#lvLbl').textContent = `Lv.${me.level}` + (me.level < MAX_LEVEL ? `　XP ${me.xp}/${XP_NEED[me.level]}` : '　MAX');
  $('#xpBar i').style.width = (me.level < MAX_LEVEL ? me.xp / XP_NEED[me.level] * 100 : 100) + '%';
  $('#btnXP').disabled = me.gold < 4 || me.level >= MAX_LEVEL;
  $('#btnRoll').disabled = me.gold < me.rerollCost; $('#rollCost').textContent = me.rerollCost + 'G';
  $('#btnLock').textContent = me.lock ? '🔒' : '🔓'; $('#btnLock').classList.toggle('on', me.lock);
}

function renderScore() {
  const box = $('#score'); box.innerHTML = '';
  const ps = G.players.slice().sort((a, b) => b.alive - a.alive || b.hp - a.hp || a.place - b.place);
  for (const p of ps) {
    const d = el('div', 'pl' + (p === me ? ' me' : '') + (p.alive ? '' : ' dead') + (p === G.opponent && G.phase !== 'result' ? ' opp' : ''));
    const s = p.streak;
    d.innerHTML = `<span class="lv">Lv${p.level}</span><span class="nm">${p.name}</span><span class="stk">${s >= 2 ? '🔥' + s : s <= -2 ? '❄️' + -s : ''}</span><span class="hp">${p.alive ? p.hp : p.place + '位'}</span><i class="hpb" style="width:${p.hp}%;background:${p.hp > 50 ? '#3fb96b' : p.hp > 25 ? '#ffb703' : '#ff5d73'}"></i>`;
    d.onclick = e => { e.stopPropagation(); showScout(p); };
    box.appendChild(d);
  }
}

// ---------- 情報パネル ----------
const chip = t => `<span class="chip" style="--tc:${TRAITS[t].col}">${TRAITS[t].n}</span>`;
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
  showInfo(`<h3>${d.n} <span class="fm">${d.f}</span><span class="costc">${d.mob ? '' : d.cost + 'G ' + '★'.repeat(star)}</span></h3>
    <div class="chips">${d.traits.map(chip).join('')}</div>
    <div class="stats"><span>HP <b>${st[0]}</b></span><span>攻撃力 <b>${st[1]}</b></span><span>攻速 <b>${st[2]}</b></span><span>アーマー <b>${st[3]}</b></span><span>魔法耐性 <b>${st[4]}</b></span><span>射程 <b>${st[5]}</b></span><span>スキル威力 <b>${st[6]}</b></span></div>
    ${skillHtml(d, star)}
    ${(items || []).map(i => `<div class="itl">${ITEMS[i].ic} <b>${ITEMS[i].n}</b>：${ITEMS[i].d}</div>`).join('')}
    ${d.note ? `<div class="note">📝 ${d.note}</div>` : ''}`);
}
function showTraitInfo(k, tier) {
  const T = TRAITS[k], us = Object.values(UNITS).filter(u => u.traits.includes(k)).sort((a, b) => a.cost - b.cost);
  showInfo(`<h3><span class="chip" style="--tc:${T.col}">${T.n}</span> <span class="fm">${T.bp.join(' / ')}体</span></h3>
    <div style="margin-top:6px">${fmt(T.d, T.v, tier)}</div>
    ${k === 'acid' || k === 'base' ? `<div class="eq">【中和】H⁺ + OH⁻ → H₂O ：${NEUTRAL.flat}＋最大HPの${NEUTRAL.pct}%の魔法ダメージ（中和熱）</div>` : ''}
    <div class="note">📝 ${T.why}</div>
    <div class="chips" style="margin-top:8px">${us.map(u => `<span class="chip" style="--tc:${COSTCOL[u.cost]}">${SHORT[u.id] || u.f}</span>`).join('')}</div>`);
}
function showItemInfo(id) {
  const it = ITEMS[id];
  let h = `<h3>${it.ic} ${it.n}</h3><div style="margin-top:6px">${it.d}</div>`;
  if (it.comp) h += '<div class="sk mut">組み合わせ</div>' + COMPS.map(c => { const r = ITEMS[combine(id, c)]; return `<div class="itl">${it.ic}＋${ITEMS[c].ic} → ${r.ic} <b>${r.n}</b></div>`; }).join('');
  else h += `<div class="sk mut">レシピ：${it.r.map(c => ITEMS[c].ic + ITEMS[c].n).join(' ＋ ')}</div>`;
  showInfo(h);
}

function toast(s) { const t = el('div', '', s); $('#toast').appendChild(t); setTimeout(() => t.remove(), 2600); }
function modal(html) { $('#modalBox').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }

function showScout(p) {
  const cnt = G.traits(p), act = Object.keys(cnt).filter(k => traitTier(k, cnt[k])).sort((a, b) => cnt[b] - cnt[a]);
  modal(`<h2>${p.name} <small style="color:var(--mut)">Lv.${p.level}　HP ${p.hp}　💰${p === me ? p.gold : '?'}</small></h2>
    <div class="chips row">${act.map(k => `<span class="chip" style="--tc:${TRAITS[k].col}">${TRAITS[k].n} ${cnt[k]}</span>`).join('') || '<span style="color:var(--mut)">発動中のシナジーなし</span>'}</div>
    <div class="scout" id="scoutBox"></div><div class="row"><button id="mClose">閉じる</button></div>`);
  const box = $('#scoutBox');
  for (const u of p.board.slice().sort((a, b) => UNITS[b.id].cost * b.star - UNITS[a.id].cost * a.star)) {
    const t = mkToken(u.id, u.star, u.items, p === me ? 0 : 1); t.onclick = () => showUnitInfo(u.id, u.star, u.items); box.appendChild(t);
  }
  if (!p.board.length) box.textContent = '盤面は空';
  $('#mClose').onclick = closeModal;
}

function showDex(tab = 'how') {
  const tabs = { how: '遊び方', units: '物質', traits: 'シナジー', items: '器具', odds: '確率' };
  let body = '';
  if (tab === 'how') body = `
    <p><b>Auto-Chemyth</b> は、元素や化合物を集めて盤面に並べ、7人のライバル化学者と自動で戦わせる化学オートバトラーです。</p>
    <h4>基本の流れ</h4>
    <p>① ショップで物質を買う（同じ物質が3つそろうと ★ が上がる＝精製）<br>② ベンチから盤面の下半分にドラッグして配置（配置数＝レベル）<br>③「戦闘開始」で自動戦闘。負けると生き残った敵の数に応じてHPが減る<br>④ 最後の1人になれば勝ち</p>
    <h4>化学のルール</h4>
    <p>・同じ<b>族・性質</b>の物質を並べるとシナジー発動（アルカリ金属、ハロゲン、酸、塩基、酸化剤…）<br>
    ・<b>中和</b>：酸が付けた H⁺ と塩基が付けた OH⁻ が同じ敵に重なると中和熱で大ダメージ<br>
    ・<b>イオン化傾向</b>：塩酸は H₂ よりイオン化傾向の大きい金属に特効。Cu・Ag・Au には効きにくい<br>
    ・<b>不動態</b>：Fe・Al は硝酸のスキルを半減。<b>金</b>は H⁺ を受けつけない<br>
    ・<b>脱水・けん化・付加</b>：硫酸・NaOH・臭素は有機化合物に特効<br>
    ・各物質のスキルは実際の反応式に基づく。タップで反応式と受験メモを確認できる</p>
    <h4>経済</h4>
    <p>毎ラウンド5G＋利息（10Gごとに+1、最大5）＋連勝/連敗ボーナス。経験値は4Gで4XP、リロードは2G。ユニットをショップ欄へドラッグで売却。</p>
    <h4>操作</h4><p>ドラッグ：移動・装備・売却　／　タップ：詳細　／　キー：<b>D</b> リロード・<b>F</b> 経験値・<b>Space</b> 戦闘開始</p>`;
  if (tab === 'units') body = [1, 2, 3, 4, 5].map(c => `<h4>コスト${c}</h4><div class="dex">${BY_COST[c - 1].map(id => { const d = UNITS[id]; return `<div class="card c${c}" data-id="${id}"><div class="fm" style="font-size:13px">${SHORT[id] || d.f}</div><div class="nm">${d.n}</div><div class="trs">${d.traits.map(t => `<span style="color:${TRAITS[t].col}">${TRAITS[t].n}</span>`).join('')}</div></div>`; }).join('')}</div>`).join('');
  if (tab === 'traits') body = Object.values(TRAITS).map(T => `<div class="dexT" style="--tc:${T.col}"><b style="color:${T.col}">${T.n}</b>（${T.bp.join('/')}）<br>${fmt(T.d, T.v)}<div class="why">📝 ${T.why}</div></div>`).join('') +
    `<div class="dexT" style="--tc:#fff36b"><b style="color:#fff36b">中和</b><br>H⁺ と OH⁻ が同じユニットに重なると両方が消え、${NEUTRAL.flat}＋最大HPの${NEUTRAL.pct}%の魔法ダメージ。<div class="why">📝 H⁺ + OH⁻ → H₂O　ΔH = −56.5 kJ/mol（強酸・強塩基なら種類によらず一定）</div></div>`;
  if (tab === 'items') body = `<h4>素材</h4><div class="recipe">${COMPS.map(c => `<div>${ITEMS[c].ic} <b>${ITEMS[c].n}</b><br>${ITEMS[c].d}</div>`).join('')}</div><h4>完成品（素材2つを同じユニットに装備）</h4><div class="recipe">${FULL_ITEMS.map(k => { const it = ITEMS[k]; return `<div>${it.r.map(c => ITEMS[c].ic).join('＋')} → ${it.ic} <b>${it.n}</b><br>${it.d}</div>`; }).join('')}</div>`;
  if (tab === 'odds') body = `<p>レベルごとのショップ出現率(%)</p><table class="odds"><tr><th>Lv</th>${[1, 2, 3, 4, 5].map(c => `<th style="color:${COSTCOL[c]}">${c}G</th>`).join('')}</tr>${ODDS.slice(1).map((o, i) => `<tr${me && me.level === i + 1 ? ' style="background:#2a5fd055"' : ''}><td>${i + 1}</td>${o.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`;
  modal(`<div class="tabs">${Object.keys(tabs).map(k => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${tabs[k]}</button>`).join('')}<button id="mClose" style="margin-left:auto">閉じる</button></div>${body}`);
  $('#modalBox').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showDex(b.dataset.tab));
  $('#modalBox').querySelectorAll('[data-id]').forEach(c => c.onclick = e => { e.stopPropagation(); showUnitInfo(c.dataset.id, 1, []); });
  $('#mClose').onclick = () => { closeModal(); hideInfo(); };
}

function showStart() {
  modal(`<h2>⚗️ Auto-Chemyth <small style="color:var(--mut);font-size:12px">化学オートバトラー</small></h2>
    <p>41種の元素・化合物を集め、族と性質のシナジーを組み、実際の化学反応に基づくスキルで7人のライバル化学者に勝ち残れ。</p>
    <p>酸と塩基で<b>中和</b>、塩酸は<b>イオン化傾向</b>で特効、鉄は濃硝酸に<b>不動態</b>、金は<b>王水</b>でしか溶けない——盤面の強さはそのまま化学の知識になる。</p>
    <div class="row"><span>難易度</span><span class="seg" id="segDiff">${Object.keys(DIFFS).map(k => `<button data-v="${k}" class="${k === opts.diff ? 'on' : ''}">${DIFFS[k].n}</button>`).join('')}</span></div>
    <div class="row"><span>準備時間</span><span class="seg" id="segTimer"><button data-v="1" class="${opts.timer ? 'on' : ''}">制限あり</button><button data-v="0" class="${opts.timer ? '' : 'on'}">じっくり（無制限）</button></span></div>
    <div class="row"><button class="primary" id="mStart" style="padding:10px 26px;font-size:15px">実験開始</button><button id="mHow">遊び方・図鑑</button></div>`);
  const seg = (id, fn) => $(id).querySelectorAll('button').forEach(b => b.onclick = () => { $(id).querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); fn(b.dataset.v); });
  seg('#segDiff', v => { opts.diff = v; }); seg('#segTimer', v => { opts.timer = v === '1'; });
  $('#mStart').onclick = () => { closeModal(); newGame(); };
  $('#mHow').onclick = () => { showDex('how'); const c = $('#mClose'); c.onclick = () => { hideInfo(); showStart(); }; };
}

function showAug() {
  modal(`<h2>🔬 研究テーマを選ぶ</h2><p>このゲーム中ずっと有効な強化を1つ選択。</p><div class="augs">${G.pendingAug.map((a, i) => `<div class="aug" data-i="${i}"><div class="ic">${a.ic}</div><div class="n">${a.n}</div><div class="d">${a.d}</div></div>`).join('')}</div>`);
  $('#modalBox').querySelectorAll('.aug').forEach(a => a.onclick = () => { G.chooseAug(+a.dataset.i); closeModal(); render(); startTimer(); });
}

function showOver() {
  const p = G.place, win = p === 1;
  modal(`<h2>${win ? '🏆 優勝！' : `実験終了：${p}位`}</h2>
    <p>${win ? 'すべてのライバルを退けた。君の反応系は完璧だ。' : p <= 4 ? '上位入賞。シナジーの段階をもう一つ上げれば優勝が見える。' : '序盤は連敗しても利息で立て直せる。★2を作ってから盤面を広げよう。'}</p>
    <p>到達ラウンド ${G.label}　／　最終レベル ${me.level}</p>
    <div class="row"><button class="primary" id="mAgain">もう一度</button></div>`);
  $('#mAgain').onclick = () => showStart();
}

// ---------- 進行 ----------
function newGame() {
  cancelAnimationFrame(raf); clearInterval(timerId); bt = null;
  G = new Game(opts); me = G.me; window.__G = G;
  render(); layout(); enterPlan();
}
function enterPlan() {
  bt = null; $('#banner').classList.remove('show'); $('#fx').innerHTML = '';
  render();
  if (G.pendingAug) showAug(); else startTimer();
}
function startTimer() {
  clearInterval(timerId); const bar = $('#timerBar i');
  if (!opts.timer) { bar.style.width = '100%'; return; }
  planDur = G.planTime() * 1000; planEnd = performance.now() + planDur;
  timerId = setInterval(() => {
    const left = planEnd - performance.now(); bar.style.width = Math.max(0, left / planDur * 100) + '%';
    if (left <= 0) go();
  }, 100);
}
function go() {
  if (!G || G.phase !== 'plan' || !$('#modal').hidden && G.pendingAug) return;
  clearInterval(timerId); cancelDrag(); hideInfo();
  const f = G.myFight(), ghost = f && f.ghost;
  G.startCombat(); bt = G.battle; bt.oppName = G.opponent ? G.opponent.name + (ghost ? '（影）' : '') : '実験：不純物';
  render(); buildBattleTokens();
  let last = performance.now(), acc = 0, done = false;
  const loop = now => {
    let dt = Math.min(0.1, (now - last) / 1000) * speed; last = now; acc += dt;
    while (acc >= TICK && !bt.over) { bt.step(TICK); acc -= TICK; }
    playEvents(); updateTokens();
    $('#timerBar i').style.width = Math.max(0, (1 - bt.t / TIME_LIMIT) * 100) + '%';
    if (bt.over && !done) { done = true; setTimeout(endCombat, 900); return; }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
function endCombat() {
  G.finishCombat(); const r = G.lastResult, b = $('#banner');
  b.innerHTML = (r.win ? '<span style="color:#7df9ff">勝利！</span>' : r.draw ? '<span style="color:#ffd166">時間切れ</span>' : '<span style="color:#ff5d73">敗北</span>') + (r.dmg ? `<small>−${r.dmg} HP</small>` : '');
  b.classList.add('show');
  if (r.loot && r.loot.items) toast('入手：' + r.loot.items.map(i => ITEMS[i].ic + ITEMS[i].n).join('　') + (r.loot.gold ? `　💰+${r.loot.gold}` : ''));
  render();
  setTimeout(() => { if (G.over) { showOver(); return; } G.nextRound(); enterPlan(); }, 1700);
}

// ---------- 戦闘描画 ----------
function buildBattleTokens() {
  const box = $('#tokens'); box.innerHTML = ''; btEls.clear();
  for (const u of bt.units) {
    const t = mkToken(u.def.id, u.star, u.items, u.team, true); t.dataset.bid = u.uid;
    if (!u.alive) t.classList.add('dead');
    box.appendChild(t);
    btEls.set(u.uid, { t, h: t.querySelector('.h'), s: t.querySelector('.s'), m: t.querySelector('.mp i'), tag: t.querySelector('.tag'), body: t.querySelector('.body'), tags: '' });
  }
  updateTokens();
}
function unitXY(u) {
  let [x, y] = cellXY(u.pos.c, u.pos.r);
  if (u.moveT > 0) { const k = u.moveT / MOVE_T, [px, py] = cellXY(u.prev.c, u.prev.r); x += (px - x) * k; y += (py - y) * k; }
  return [x, y];
}
function updateTokens() {
  for (const u of bt.units) {
    const e = btEls.get(u.uid); if (!e || !u.alive) continue;
    const [x, y] = unitXY(u); e.t.style.transform = `translate(${x}px,${y}px)`;
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
        if (e.dot && e.a < 12) break;
        const [x, y] = unitXY(e.u), j = (Math.random() - .5) * hexW * .5;
        ftext(x + j, y - hexW * .3, Math.round(e.a) + (e.crit ? '!' : ''), e.type === 'phys' ? '#ffb38a' : e.type === 'magic' ? '#9ad1ff' : '#ffffff', e.crit ? 'big' : '');
        break;
      }
      case 'heal': { const [x, y] = unitXY(e.u); ftext(x, y - hexW * .2, '+' + Math.round(e.a), '#6dff9c'); break; }
      case 'text': { const [x, y] = unitXY(e.u); ftext(x, y - hexW * .5, e.s, e.col, e.big ? 'big' : '', 900); break; }
      case 'cast': {
        const [x, y] = unitXY(e.u); ftext(x, y - hexW * .62, e.s, '#7df9ff', 'skill', 1100);
        const b = btEls.get(e.u.uid); if (b) b.body.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)', boxShadow: '0 0 18px #7df9ff' }, { transform: 'scale(1)' }], { duration: 350 / sp });
        break;
      }
      case 'atk': {
        const [ax, ay] = unitXY(e.a), [bx, by] = unitXY(e.b);
        if (e.ranged) {
          if (box.childElementCount > 70) break;
          const p = el('div', 'proj'); p.style.background = e.a.team ? '#ff9aa8' : '#9fd0ff'; box.appendChild(p);
          p.animate([{ transform: `translate(${ax}px,${ay}px)` }, { transform: `translate(${bx}px,${by}px)` }], { duration: 150 / sp }).onfinish = () => p.remove();
        } else {
          const b = btEls.get(e.a.uid), dx = (bx - ax) * .28, dy = (by - ay) * .28;
          if (b) b.body.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 170 / sp });
        }
        break;
      }
      case 'aoe': {
        const [x, y] = cellXY(e.pos.c, e.pos.r), s = (2 * e.r + 1) * hexW, r = el('div', 'ring');
        r.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px;--col:${e.col}`; box.appendChild(r);
        r.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: 480 / sp, easing: 'ease-out' }).onfinish = () => r.remove();
        break;
      }
      case 'beam': {
        const [ax, ay] = unitXY(e.a), [bx, by] = unitXY(e.b), len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax), l = el('div', 'beam');
        l.style.cssText = `left:${ax}px;top:${ay}px;width:${len}px;transform:rotate(${ang}rad);--col:${e.col}`; box.appendChild(l);
        l.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 340 / sp }).onfinish = () => l.remove();
        break;
      }
      case 'death': { const b = btEls.get(e.u.uid); if (b) b.t.classList.add('dead'); break; }
    }
  }
}

// ---------- ドラッグ & タップ ----------
const myUnit = uid => G.allUnits(me).find(u => u.uid === +uid);
function cancelDrag() {
  if (!drag) return;
  if (drag.ghost) drag.ghost.remove(); if (drag.src) drag.src.classList.remove('srcDrag');
  document.body.classList.remove('dragging', 'dragUnit'); document.querySelectorAll('.hover').forEach(e => e.classList.remove('hover'));
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
  if (!G || e.button > 0) return;
  const tok = e.target.closest('.token[data-uid]'), item = e.target.closest('.item[data-ii]');
  if (!tok && !item) return;
  if (tok && tok.closest('#modal')) return;
  drag = { x: e.clientX, y: e.clientY, src: tok || item, kind: tok ? 'unit' : 'item', on: false, id: e.pointerId };
  if (tok) drag.unit = myUnit(tok.dataset.uid); else drag.ii = +item.dataset.ii;
});
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
    if (drag.kind === 'unit' && (!drag.unit || (me.board.includes(drag.unit) && G.phase !== 'plan'))) { drag = null; return; }
    drag.on = true; hideInfo();
    const g = drag.src.cloneNode(true); g.classList.add('ghost'); g.style.transform = ''; g.style.left = g.style.top = '0';
    document.body.appendChild(g); drag.ghost = g; drag.src.classList.add('srcDrag');
    document.body.classList.add('dragging'); if (drag.kind === 'unit') { document.body.classList.add('dragUnit'); $('#sellHint').textContent = `売却 +${sellValue(drag.unit)}G`; }
  }
  drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
  document.querySelectorAll('.hover').forEach(x => x.classList.remove('hover'));
  const t = dropTarget(e.clientX, e.clientY);
  if (t && t.el && (drag.kind === 'unit' || t.unit)) (t.type === 'hex' && t.unit ? t.el : t.el).classList.add('hover');
  e.preventDefault();
}, { passive: false });
function endPointer(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  if (!d.on) { // タップ
    drag = null;
    if (d.kind === 'unit' && d.unit) showUnitInfo(d.unit.id, d.unit.star, d.unit.items); else if (d.kind === 'item') showItemInfo(me.items[d.ii]);
    return;
  }
  const t = e.type === 'pointercancel' ? null : dropTarget(e.clientX, e.clientY);
  cancelDrag();
  if (!t) return;
  if (d.kind === 'item') {
    if (!t.unit) return;
    const r = G.equip(me, d.ii, t.unit);
    if (r === 'full') toast('器具は3つまで'); else if (r === 'combined') toast('合成：' + ITEMS[t.unit.items[t.unit.items.length - 1]].n + ' など');
    if (G.phase !== 'plan' && me.board.includes(t.unit) && r !== 'full') toast('次の戦闘から有効');
    render(); return;
  }
  const u = d.unit, onBoard = me.board.includes(u), plan = G.phase === 'plan';
  if (t.type === 'sell') { if (onBoard && !plan) return toast('戦闘中の盤面は変更できない'); G.sell(me, u); render(); return; }
  if (t.type === 'hex') {
    if (!plan) return toast('戦闘中の盤面は変更できない');
    if (G.move(me, u, { board: true, c: t.c, r: t.r }) === 'full') toast(`配置上限 ${G.maxUnits(me)} 体（レベルを上げると増える）`);
  } else if (t.type === 'bench') {
    if (!plan && (onBoard || (t.unit && me.board.includes(t.unit)))) return toast('戦闘中の盤面は変更できない');
    G.move(me, u, { bench: t.i });
  }
  render();
}
document.addEventListener('pointerup', endPointer);
document.addEventListener('pointercancel', endPointer);
document.addEventListener('click', e => {
  const bt_ = e.target.closest('.token[data-bid]');
  if (bt_ && bt) { const u = bt.units[+bt_.dataset.bid]; if (u) showUnitInfo(u.def.id, u.star, u.items, u.alive ? u : null); return; }
  if (!e.target.closest('#info') && !e.target.closest('.token') && !e.target.closest('.item') && !e.target.closest('.card') && !e.target.closest('.trait')) hideInfo();
});
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- ボタン ----------
$('#btnGo').onclick = go;
$('#btnSpeed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $('#btnSpeed').textContent = '×' + speed; };
$('#btnDex').onclick = () => showDex('how');
$('#btnXP').onclick = () => { if (G.buyXP(me)) render(); };
$('#btnRoll').onclick = () => { if (G.reroll(me)) render(); };
$('#btnLock').onclick = () => { me.lock = !me.lock; renderShop(); };
document.addEventListener('keydown', e => {
  if (!G || !$('#modal').hidden) return;
  if (e.code === 'KeyD') $('#btnRoll').click(); else if (e.code === 'KeyF') $('#btnXP').click(); else if (e.code === 'Space') { e.preventDefault(); go(); }
});
window.addEventListener('resize', layout);
let roW = 0, roH = 0;
new ResizeObserver(() => { const w = $('#boardWrap'); if (Math.abs(w.clientWidth - roW) + Math.abs(w.clientHeight - roH) > 2) { roW = w.clientWidth; roH = w.clientHeight; layout(); } }).observe($('#boardWrap'));
showStart();
