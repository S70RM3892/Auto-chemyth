import { Game } from '../js/game.js';
import { UNITS, UNIT_IDS, TRAITS } from '../js/data.js';
import { Battle } from '../js/combat.js';
const N = +process.argv[2] || 20;
let places = [], rounds = [], dur = [], draws = 0, fights = 0; const winT = {}, useT = {}, winU = {}, useU = {};
for (let g = 0; g < N; g++) {
  const G = new Game(); let n = 0;
  while (!G.over && n++ < 80) {
    if (G.pendingAug) G.chooseAug(0);
    G.botTurn(G.me); G.makeFights(); G.startCombat(); G.battle.run();
    for (const f of G.fights) { fights++; dur.push(f.battle.t); if (f.battle.winner === null) draws++;
      if (!f.pve && f.battle.winner !== null) { [f.a, f.b].forEach((p, i) => { const w = f.battle.winner === i;
        const c = G.traits(p); for (const k in c) { useT[k] = (useT[k]||0)+1; if (w) winT[k] = (winT[k]||0)+1; }
        for (const u of p.board) { useU[u.id] = (useU[u.id]||0)+1; if (w) winU[u.id] = (winU[u.id]||0)+1; } }); } }
    G.finishCombat(); if (!G.over) G.nextRound();
  }
  places.push(G.place); rounds.push(G.stage + '-' + G.round);
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
console.log('places', places.join(','), 'end', rounds.join(' '));
console.log('avg dur', avg(dur), 'max', Math.max(...dur).toFixed(1), 'draw%', (draws / fights * 100).toFixed(1));
console.log('trait winrate', Object.keys(useT).map(k => TRAITS[k].n + ':' + (winT[k] / useT[k] * 100 | 0) + '%(' + useT[k] + ')').join(' '));
console.log('unit winrate', Object.keys(useU).sort((a, b) => winU[b] / useU[b] - winU[a] / useU[a]).map(k => k + ':' + ((winU[k]||0) / useU[k] * 100 | 0) + '(' + useU[k] + ')').join(' '));
// every skill cast smoke test
for (const id of UNIT_IDS) for (const star of [1, 3]) {
  const A = { units: [{ id, star, items: ['buffer','flame','daniell'], c: 3, r: 0 }, { id: 'O2', star: 1, items: [], c: 2, r: 1 }] };
  const B = { units: UNIT_IDS.slice(0, 7).map((x, i) => ({ id: x, star: 2, items: ['plating'], c: i, r: 0 })) };
  const b = new Battle(A, B, 7, true).run(); if (!b.ev.some(e => e.k === 'cast' && e.u.def.id === id)) console.log('NO CAST', id, star);
  if (b.units.some(u => !isFinite(u.hp))) console.log('NaN', id);
}
