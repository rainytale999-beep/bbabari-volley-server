'use strict';
/* 지구정복 자격시험 — 방 목록·대기실·관전 + 문제 진행. 주소: wss://<게임 서버>/quiz
   서버는 문제 순서·마감·점수만 정하고, 문제 풀이는 각자 화면에서 한다(전송량 아주 적음).
   - 자리 8개 + 관전자. 방장이 시작. 한 방에서 같은 캐릭터는 한 명만
   - 문제마다: 서버가 문제 번호를 보냄 → 각자 풀고 결과 1번 → 모두 내거나 시간이 다 되면 결과 발표 → 다음 문제
   - 탈락한 사람은 훼방 카드를 던질 수 있다 */
const { WebSocketServer } = require('ws');
const QRUN = require('./quizrun.js');
const rooms = new Map();
const MAX_ROOMS = 100, MAX_SEAT = 8, MAX_SPEC = 8, NCH = 15;
const str = (v, n) => String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const MODES = ['surv', 'score'], DIFFS = ['mild', 'normal', 'hot'], COUNTS = [10, 20, 30], CARDS = ['ink', 'banana', 'sleep', 'swirl', 'bolt'];
function send(ws, m) { if (ws && ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
function members(r) { return [...r.seats.filter(Boolean), ...r.specs]; }
function bcast(r, m) { const s = JSON.stringify(m); for (const ws of members(r)) send(ws, s); }
function newId() { let id; do { id = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(id)); return id; }
function listOf() { return [...rooms.values()].map(r => ({ id: r.id, title: r.title, lock: !!r.pw, n: r.seats.filter(Boolean).length, max: MAX_SEAT, spec: r.spec, playing: !!r.run, nspec: r.specs.length })); }
function info(r, ws) {
  return { t: 'room', id: r.id, title: r.title, lock: !!r.pw, spec: r.spec, cfg: r.cfg, host: r.seats.indexOf(r.host), me: r.seats.indexOf(ws),
    seats: r.seats.map((s, i) => s ? { name: s.name, ch: s.ch, ready: !!r.ready[i] } : null), specs: r.specs.map(s => s.name), playing: !!r.run };
}
function pushInfo(r) { for (const ws of members(r)) send(ws, info(r, ws)); }
function freeCh(r, want, except) { const used = new Set(r.seats.filter(s => s && s !== except).map(s => s.ch)); if (want >= 0 && want < NCH && !used.has(want)) return want; for (let c = 0; c < NCH; c++) if (!used.has(c)) return c; return 0; }
function leaveRoom(ws) {
  const r = ws.room && rooms.get(ws.room); ws.room = null; if (!r) return;
  const si = r.seats.indexOf(ws);
  if (si >= 0) { r.seats[si] = null; r.ready[si] = false; if (r.run) { const p = r.run.pl.indexOf(ws); if (p >= 0) { QRUN.leave(r.run.R, p); r.run.pl[p] = null; checkClose(r); } } }
  r.specs = r.specs.filter(s => s !== ws);
  if (!r.seats.some(Boolean) && !r.specs.length) { stopRun(r); rooms.delete(r.id); return; }
  if (r.host === ws) r.host = r.seats.find(Boolean) || r.specs[0];
  if (r.run && !r.run.pl.some(Boolean)) endRun(r);
  pushInfo(r);
}
function stopRun(r) { if (r.run && r.run.timer) clearTimeout(r.run.timer); }
function endRun(r) { stopRun(r); r.run = null; r.ready = r.ready.map(() => false); bcast(r, { t: 'lobby' }); pushInfo(r); }
function later(r, ms, fn) { const run = r.run; if (!run) return; if (run.timer) clearTimeout(run.timer); run.timer = setTimeout(() => { if (r.run === run) { run.timer = null; fn(); } }, ms); }
function ask(r) { // 다음 문제
  const run = r.run, q = QRUN.next(run.R);
  if (!q) return finish(r);
  run.qAt = Date.now(); run.allIn = false; run.dl = run.qAt + (q.special ? 26000 : 16000); bcast(r, Object.assign({ t: 'q' }, q));
  later(r, q.special ? 26000 : 16000, () => closeQ(r)); // v1.48 제한시간 +1.5초 반영(14→16초) // 시간이 다 되면 마감(안 낸 사람은 실패)
}
function checkClose(r) { const run = r.run; if (!run || !run.R.cur) return; if (!QRUN.waiting(run.R).length) { run.allIn = true; later(r, 300, () => closeQ(r)); } }
function closeQ(r) {
  const run = r.run; if (!run || !run.R.cur) return;
  const cur = run.R.cur, res = QRUN.close(run.R); bcast(r, Object.assign({ t: 'qr' }, res));
  run.jamUsed = new Set();
  const nextStage = QRUN.stageOf(cur.n + 1) > cur.stage;
  later(r, res.over ? 2600 : 2300 + (nextStage ? 2200 : 0) + (res.newOut.length ? 800 : 0), () => res.over ? finish(r) : ask(r));
}
function finish(r) { const run = r.run; if (!run) return; bcast(r, { t: 'end', rank: QRUN.ranking(run.R) }); stopRun(r); r.run = null; r.ready = r.ready.map(() => false); pushInfo(r); }
function onMsg(ws, m) {
  const t = m.t;
  if (t === 'ping') return send(ws, { t: 'pong', c: m.c });
  if (t === 'hello') {
    ws.name = str(m.name, 10) || '빱알이'; ws.ch = Math.max(0, Math.min(NCH - 1, m.ch | 0));
    ws.gl = Array.isArray(m.gl) ? m.gl.slice(0, 300).filter(g => Array.isArray(g) && Number.isFinite(+g[0])).map(g => [g[0] | 0, str(g[1], 6)]) : [];
    return send(ws, { t: 'hi' });
  }
  if (t === 'list') return send(ws, { t: 'rooms', list: listOf() });
  if (t === 'create') {
    if (ws.room) leaveRoom(ws);
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: '방이 가득 찼어요. 잠시 뒤에 다시 시도해 주세요.' });
    const r = { id: newId(), title: str(m.title, 20) || (ws.name || '빱알이') + '의 시험장', pw: str(m.pw, 12), spec: m.spec !== false, host: ws,
      seats: new Array(MAX_SEAT).fill(null), ready: new Array(MAX_SEAT).fill(false), specs: [], cfg: { mode: 'surv', diff: 'normal', count: 30 }, run: null };
    r.seats[0] = ws; ws.ch = freeCh(r, ws.ch, ws); rooms.set(r.id, r); ws.room = r.id; return pushInfo(r);
  }
  if (t === 'join') {
    const r = rooms.get(str(m.id, 8)); if (!r) return send(ws, { t: 'err', m: '방이 없어졌어요.' });
    if (r.pw && str(m.pw, 12) !== r.pw) return send(ws, { t: 'err', m: '비밀번호가 달라요.', pw: 1, id: r.id });
    if (ws.room) leaveRoom(ws);
    const free = r.seats.indexOf(null);
    if (!m.watch && !r.run && free >= 0) { r.seats[free] = ws; r.ready[free] = false; ws.ch = freeCh(r, ws.ch, ws); }
    else { if (!r.spec) return send(ws, { t: 'err', m: r.run ? '시험 중이고 관전이 꺼진 방이에요.' : '자리가 없고 관전이 꺼진 방이에요.' });
      if (r.specs.length >= MAX_SPEC) return send(ws, { t: 'err', m: '관전 자리가 가득 찼어요.' }); r.specs.push(ws); }
    ws.room = r.id; pushInfo(r);
    if (r.run && r.specs.includes(ws)) send(ws, startMsg(r, ws));
    return;
  }
  const r = ws.room && rooms.get(ws.room); if (!r) return;
  if (t === 'leave') return leaveRoom(ws);
  if (t === 'chat') { const s = str(m.s, 40); if (s) bcast(r, { t: 'chat', name: ws.name, s }); return; }
  if (!r.run) { // ── 대기실 ──
    const si = r.seats.indexOf(ws);
    if (t === 'ch') { if (si < 0) return; const c = m.ch | 0; if (c < 0 || c >= NCH) return; if (r.seats.some(s => s && s !== ws && s.ch === c)) return send(ws, { t: 'err', m: '다른 사람이 고른 캐릭터예요.' }); ws.ch = c; r.ready[si] = false; return pushInfo(r); }
    if (t === 'seat') { if (m.to === -1) { if (si >= 0) { r.seats[si] = null; r.ready[si] = false; if (!r.specs.includes(ws)) r.specs.push(ws); } }
      else { const free = r.seats.indexOf(null); if (si < 0 && free >= 0) { r.specs = r.specs.filter(s => s !== ws); r.seats[free] = ws; ws.ch = freeCh(r, ws.ch, ws); } }
      return pushInfo(r); }
    if (t === 'ready') { if (si >= 0 && ws !== r.host) { r.ready[si] = !!m.on; pushInfo(r); } return; }
    if (t === 'cfg') { if (ws !== r.host) return; const c = r.cfg; if (MODES.includes(m.mode)) c.mode = m.mode; if (DIFFS.includes(m.diff)) c.diff = m.diff; if (COUNTS.includes(m.count)) c.count = m.count; if (typeof m.spec === 'boolean') r.spec = m.spec; return pushInfo(r); }
    if (t === 'start') {
      if (ws !== r.host) return;
      const idx = r.seats.map((s, i) => s ? i : -1).filter(i => i >= 0); if (!idx.length) return send(ws, { t: 'err', m: '자리에 앉은 사람이 없어요.' });
      if (r.seats.indexOf(ws) < 0) return send(ws, { t: 'err', m: '방장이 자리에 앉아야 시작할 수 있어요.' });
      if (!idx.every(i => r.seats[i] === r.host || r.ready[i])) return send(ws, { t: 'err', m: '아직 준비하지 않은 사람이 있어요.' });
      const pl = idx.map(i => r.seats[i]);
      let pool = null; for (const p of pl) { const ids = new Map((p.gl || []).map(g => [g[0], g[1]])); pool = pool ? pool.filter(g => ids.has(g[0])) : [...ids].map(([id, c]) => [id, c]); }
      pool = (pool || []).filter(g => g[0] < 900); if (pool.length < 3) return send(ws, { t: 'err', m: '게임 버전이 서로 달라요. 모두 새로고침(Ctrl+F5) 해 주세요.' });
      const cfg = { mode: r.cfg.mode, diff: r.cfg.diff, count: r.cfg.count, seed: (Math.random() * 4294967295) >>> 0, pool, special: pl.length > 1 };
      const R = QRUN.create(cfg, pl.map(p => ({ name: p.name, ch: p.ch })));
      r.run = { R, pl, cfg, timer: null, jamUsed: new Set() };
      for (const w of members(r)) send(w, startMsg(r, w));
      pushInfo(r);
      later(r, 5200, () => ask(r)); // 입실 연출 뒤 첫 문제
      return;
    }
    return;
  }
  // ── 시험 중 ──
  const run = r.run, p = run.pl.indexOf(ws);
  if (t === 'st') { // v1.49 이 사람이 실제로 문제를 시작함(그림 불러오기·설명이 늦은 폰): 마감을 그 사람의 제한시간 뒤로 늦춤(문제 시작부터 최대 40초)
    if (p < 0 || !run.R.cur || (m.n | 0) !== run.R.cur.n || run.allIn) return;
    const T = Math.min(20, Math.max(0, +m.T || 0)), nd = Math.min(run.qAt + 40000, Date.now() + T * 1000 + 2000);
    if (nd > run.dl) { run.dl = nd; later(r, nd - Date.now(), () => closeQ(r)); } return; }
  if (t === 'res') { if (p < 0 || !run.R.cur || (m.n | 0) !== run.R.cur.n) return; QRUN.submit(run.R, p, m); bcast(r, { t: 'did', p, ok: !!m.ok }); checkClose(r); return; }
  if (t === 'jam') { if (p < 0 || !run.R.out[p] || run.jamUsed.has(p) || !CARDS.includes(m.card)) return; const al = QRUN.alive(run.R); if (!al.length) return;
    run.jamUsed.add(p); const to = al[Math.floor(Math.random() * al.length)]; bcast(r, { t: 'jam', from: p, to, card: m.card }); return; }
  if (t === 'quit') { if (ws === r.host) endRun(r); return; }
}
function startMsg(r, ws) { const run = r.run; return { t: 'start', cfg: run.cfg, players: run.R.players, me: run.pl.indexOf(ws), n: run.R.n, sc: run.R.sc, hp: run.R.hp, out: run.R.out }; }
function attach() {
  const sw = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  sw.on('connection', ws => {
    ws.room = null; ws.last = Date.now(); ws.cnt = 0; ws.name = '빱알이'; ws.ch = 0; ws.gl = [];
    ws.on('message', (raw, isBin) => { ws.last = Date.now(); if (isBin || ++ws.cnt > 120) return ws.terminate(); let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; } if (!m || typeof m !== 'object') return; try { onMsg(ws, m); } catch (e) { console.error('quiz msg', e); } });
    ws.on('pong', () => { ws.last = Date.now(); }); ws.on('close', () => leaveRoom(ws)); ws.on('error', () => { });
  });
  let tick = 0;
  setInterval(() => { const t = Date.now(); tick++; for (const ws of sw.clients) { ws.cnt = 0; if (t - ws.last > 45000) ws.terminate(); else if (tick % 10 === 0) try { ws.ping(); } catch (e) { } } }, 1000);
  return sw;
}
function roomsHttp(res) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(listOf())); }
module.exports = { attach, rooms, roomsHttp };
