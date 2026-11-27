/* 지구정복 자격시험 — 한 판 진행 규칙(서버와 혼자 하기가 같이 씀)
   문제 순서·점수·하트·탈락·특별 문제·끝 판정만 계산한다. 그림·조작은 각자 화면이 한다. */
(function (root) {
  'use strict';
  const SPECIAL = [901, 902, 903, 904]; // 특별 문제: 치즈 쟁탈전 · 빱찌 면접 · 배구공 띄우기 · 줄다리기
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function stageOf(n, every) { return Math.min(4, 1 + Math.floor(n / (every || 5))); } // 5문제마다 빨라짐(1~4단계)
  function isSpecialN(cfg, n) { return cfg.special !== false && cfg.mode !== 'endless' && (n + 1) % 10 === 0; }
  /* cfg: { mode:'surv'|'score'|'endless', diff:'mild'|'normal'|'hot', count:30, seed, pool:[[id,ctrl],...] }
     players: [{ name, ch }] */
  function create(cfg, players) {
    const hp0 = cfg.diff === 'hot' ? 3 : 4;
    const R = { cfg, n: -1, seed: cfg.seed >>> 0, players: players.map(p => ({ name: p.name, ch: p.ch })), sc: players.map(() => 0), hp: players.map(() => hp0), hp0,
      out: players.map(() => false), gone: players.map(() => false), streak: players.map(() => 0), firsts: players.map(() => 0), fails: players.map(() => 0), oks: players.map(() => 0),
      recent: [], used: new Set(), lastCtrl: '', cur: null, res: null, over: false, rnd: rng(cfg.seed ^ 0x9e3779b9) };
    return R;
  }
  function stageMax(R) { return R.cfg.diff === 'mild' ? 3 : 4; }
  function pick(R) { // 같은 문제 두 번 안 나오게, 같은 조작 연달아 안 나오게
    const pool = R.cfg.pool || [];
    if (!pool.length) return 1;
    let cands = pool.filter(g => !R.used.has(g[0]) && g[1] !== R.lastCtrl);
    if (!cands.length) cands = pool.filter(g => !R.used.has(g[0]));
    if (!cands.length) { R.used.clear(); for (const id of R.recent.slice(-6)) R.used.add(id); cands = pool.filter(g => !R.used.has(g[0]) && g[1] !== R.lastCtrl); if (!cands.length) cands = pool; }
    const g = cands[Math.floor(R.rnd() * cands.length)]; R.used.add(g[0]); R.recent.push(g[0]); R.lastCtrl = g[1]; return g[0];
  }
  function alive(R) { const a = []; R.players.forEach((p, i) => { if (!R.out[i] && !R.gone[i]) a.push(i); }); return a; }
  /* 다음 문제 → { n, id, stage, seed, special } (끝났으면 null) */
  function next(R) {
    if (R.over) return null;
    R.n++;
    const count = R.cfg.mode === 'endless' ? 1e9 : (R.cfg.count || 30);
    if (R.n >= count) { R.over = true; return null; }
    const special = isSpecialN(R.cfg, R.n);
    const id = special ? SPECIAL[Math.floor(R.rnd() * SPECIAL.length)] : pick(R);
    const st = Math.min(stageOf(R.n, R.cfg.every), stageMax(R));
    R.cur = { n: R.n, id, stage: st, seed: (R.rnd() * 4294967295) >>> 0, special, final: R.cfg.mode !== 'endless' && R.n === count - 1 };
    R.res = R.players.map(() => null);
    return R.cur;
  }
  /* 결과 한 명: r = { ok, rem(남은 초), ms(시작부터 걸린 ms), v(특별 문제 성적: 클수록 좋음) } */
  function submit(R, i, r) { if (!R.cur || R.res[i]) return; R.res[i] = { ok: !!(r && r.ok), rem: Math.max(0, Math.min(10, +(r && r.rem) || 0)), ms: Math.max(0, +(r && r.ms) || 99999), v: +(r && r.v) || 0 }; }
  function waiting(R) { return alive(R).filter(i => !R.res[i]); }
  /* 문제 마감: 점수·하트 계산 → { n, res:[{ok,pt,first}], sc, hp, out, newOut:[], over, win } */
  function close(R) {
    const c = R.cur; if (!c) return null;
    const mult = c.stage >= 4 ? 2 : c.stage >= 3 ? 1.5 : 1, al = alive(R), newOut = [];
    const out = R.players.map(() => ({ ok: false, pt: 0, first: false, skip: true }));
    if (c.special) {
      const order = al.filter(i => R.res[i]).sort((a, b) => (R.res[b].v - R.res[a].v) || (R.res[a].ms - R.res[b].ms));
      const prize = [500, 300, 150];
      order.forEach((i, k) => { const pt = R.players.length === 1 ? Math.round(R.res[i].v * 10) : (prize[k] || 0); out[i] = { ok: k === 0, pt, first: k === 0, rank: k + 1, skip: false, v: R.res[i].v }; R.sc[i] += pt; if (k === 0 && R.players.length > 1) R.hp[i] = Math.min(R.hp0, R.hp[i] + 1); });
      for (const i of al) if (!R.res[i]) out[i] = { ok: false, pt: 0, skip: false, rank: 99 };
    } else {
      let firstI = -1, firstMs = 1e9;
      for (const i of al) { const r = R.res[i]; if (r && r.ok && r.ms < firstMs) { firstMs = r.ms; firstI = i; } }
      for (const i of al) {
        const r = R.res[i] || { ok: false, rem: 0 };
        if (r.ok) {
          R.streak[i]++; R.oks[i]++;
          let pt = 100 + Math.round(r.rem * 20); if (i === firstI && al.length > 1) { pt += 50; R.firsts[i]++; } if (R.streak[i] >= 3) pt += 30;
          pt = Math.round(pt * mult); R.sc[i] += pt; out[i] = { ok: true, pt, first: i === firstI && al.length > 1, skip: false };
        } else {
          R.streak[i] = 0; R.fails[i]++;
          let pt = 0;
          if (R.cfg.mode === 'score') { pt = -50; R.sc[i] = Math.max(0, R.sc[i] - 50); }
          else { R.hp[i]--; if (R.hp[i] <= 0) { R.hp[i] = 0; R.out[i] = true; newOut.push(i); } }
          out[i] = { ok: false, pt, first: false, skip: false };
        }
      }
    }
    const left = alive(R);
    const multi = R.players.length > 1;
    if (R.cfg.mode !== 'score' && (left.length === 0 || (multi && left.length <= 1))) R.over = true;
    const count = R.cfg.mode === 'endless' ? 1e9 : (R.cfg.count || 30);
    if (R.n >= count - 1) R.over = true;
    R.cur = null;
    return { n: c.n, res: out, sc: R.sc.slice(), hp: R.hp.slice(), out: R.out.slice(), newOut, over: R.over, allOut: left.length === 0 && newOut.length > 0 };
  }
  /* 최종 순위: 점수 → 살아남음 → 늦게 탈락 */
  function ranking(R) {
    const idx = R.players.map((p, i) => i);
    idx.sort((a, b) => (R.out[a] - R.out[b]) || (R.sc[b] - R.sc[a]));
    return idx.map((i, k) => ({ i, rank: k + 1, name: R.players[i].name, ch: R.players[i].ch, sc: R.sc[i], out: R.out[i], firsts: R.firsts[i], fails: R.fails[i], oks: R.oks[i] }));
  }
  function leave(R, i) { R.gone[i] = true; }
  const API = { create, next, submit, waiting, close, ranking, leave, alive, stageOf, SPECIAL, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.QRUN = API;
})(typeof window !== 'undefined' ? window : globalThis);
