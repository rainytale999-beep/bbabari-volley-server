'use strict';
/* 빱찌 은하 대소동(슈팅) — 방 목록·대기실·관전 + 키 입력 중계. 주소: wss://<게임 서버>/shoot
   게임 계산은 각 브라우저가 같은 씨앗값으로 똑같이 하고, 서버는 방 관리와 키 입력 전달·기록만 한다(서버 부담·전송량 아주 적음).
   - 자리 2개(0 = 빱찌 우주선, 1 = 만두 우주선) + 관전자. 방장은 혼자 시작하거나, 상대가 '준비'하면 2인 시작
   - 창을 내리거나 다른 탭으로 가면 그 사람만 '자리 비움'(키를 안 누른 것처럼), 게임 시간은 계속 흐름. 돌아오면 기록으로 따라잡음
   - 관전자는 시작부터의 키 기록을 받아 빨리감기로 따라잡은 뒤 실시간으로 봄 */
const { WebSocketServer } = require('ws');
const rooms = new Map();
const MAX_ROOMS = 100, MAX_SPEC = 8, MAX_LOG = 60 * 60 * 120 * 2; // 기록은 2시간 분량까지
const str = (v, n) => String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const DIFFS = ['easy', 'normal', 'hot'];
function send(ws, m) { if (ws && ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
function members(r) { return [...r.seats.filter(Boolean), ...r.specs]; }
function bcast(r, m, except) { const s = JSON.stringify(m); for (const ws of members(r)) if (ws !== except) send(ws, s); }
function newId() { let id; do { id = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(id)); return id; }
function listOf() {
  const list = [];
  for (const r of rooms.values()) list.push({ id: r.id, title: r.title, lock: !!r.pw, host: r.host ? r.host.name : '?', n: r.seats.filter(Boolean).length, specs: r.specs.length, spec: r.spec, state: r.run ? 'game' : 'lobby' });
  list.sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1));
  return list.slice(0, 40);
}
function roleOf(r, ws) { const i = r.seats.indexOf(ws); return i >= 0 ? 'p' + i : 'spec'; }
function info(r, ws) {
  return { t: 'room', id: r.id, title: r.title, lock: !!r.pw, spec: r.spec, diff: r.diff, stage: r.stage, max: r.host ? r.host.max : 1, playing: !!r.run,
    host: r.host === ws, me: roleOf(r, ws), swapReq: r.swapReq && r.swapReq.to === ws ? 1 : 0,
    seats: r.seats.map((s, i) => s ? { name: s.name, ready: !!r.ready[i], host: s === r.host } : null), specs: r.specs.map(s => s.name) };
}
function pushInfo(r) { for (const ws of members(r)) send(ws, info(r, ws)); }
function leaveRoom(ws) {
  const r = ws.room && rooms.get(ws.room); ws.room = null; if (!r) return;
  const si = r.seats.indexOf(ws);
  if (si >= 0) { r.seats[si] = null; r.ready[si] = false; if (r.run) playerGone(r, ws); }
  r.specs = r.specs.filter(s => s !== ws);
  if (r.swapReq && (r.swapReq.from === ws || r.swapReq.to === ws)) r.swapReq = null;
  if (r.host === ws) r.host = r.seats.find(Boolean) || r.specs[0] || null;
  if (!members(r).length) { rooms.delete(r.id); return; }
  pushInfo(r);
}
function playerGone(r, ws) { // 게임 중에 나감: 그 사람 우주선은 다음 칸부터 빠진다
  const run = r.run, p = run.pl.indexOf(ws); if (p < 0) return;
  run.pl[p] = null; run.gone[p] = true;
  const mx = Math.max(...run.last); // 자리 비운 채로 나가면, 다른 사람이 이미 계산했을 수 있는 칸 뒤에서 퇴장
  const ev = { k: 'left', p, f: run.away[p] ? mx + run.D + 10 : run.last[p] + 1 }; run.ev.push(ev); bcast(r, { t: 'ev', ev });
  if (run.pl.every(x => !x)) endRun(r); // 플레이어가 아무도 없으면 대기실로
}
function endRun(r) { r.run = null; r.ready = [false, false]; bcast(r, { t: 'lobby' }); pushInfo(r); }
function startMsg(r, ws) { const run = r.run; return { t: 'start', seed: run.seed, np: run.np, ships: run.ships, names: run.names, autos: run.autos, diff: run.diff, stage: run.stage, D: run.D, me: run.pl.indexOf(ws) }; }
function sendCatch(ws, run, from) { // 기록 보내기(관전 시작·돌아온 사람)
  const log = from > 0 ? run.log.filter(e => e[1] >= from) : run.log;
  for (let i = 0; i < log.length; i += 3000) send(ws, { t: 'log', a: log.slice(i, i + 3000) });
  send(ws, { t: 'logEnd', ev: run.ev, last: run.last });
}
function onMsg(ws, m) {
  const t = m.t;
  if (t === 'ping') return send(ws, { t: 'pong', c: m.c });
  if (t === 'rtt') { ws.rtt = Math.max(1, Math.min(1000, +m.v || 0)); return; }
  if (t === 'hello') { ws.name = str(m.name, 10) || '빱알이'; ws.max = Math.max(1, Math.min(5, m.max | 0)); ws.auto = m.auto !== false; return send(ws, { t: 'hi' }); }
  if (t === 'list') return send(ws, { t: 'rooms', list: listOf() });
  if (t === 'create') {
    if (ws.room) leaveRoom(ws);
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: '방이 가득 찼어요. 잠시 뒤에 다시 시도해 주세요.' });
    const r = { id: newId(), title: str(m.title, 20) || (ws.name || '빱알이') + '의 은하 대소동', pw: str(m.pw, 12), spec: m.spec !== false, host: ws, seats: [ws, null], specs: [], ready: [false, false], diff: 'normal', stage: 1, run: null, swapReq: null };
    rooms.set(r.id, r); ws.room = r.id; return pushInfo(r);
  }
  if (t === 'join') {
    const r = rooms.get(str(m.id, 8)); if (!r) return send(ws, { t: 'err', m: '방이 없어졌어요.' });
    if (r.pw && str(m.pw, 12) !== r.pw) return send(ws, { t: 'err', m: '비밀번호가 달라요.', pw: 1, id: r.id });
    if (ws.room) leaveRoom(ws);
    const free = r.seats.indexOf(null);
    if (!m.watch && !r.run && free >= 0) { r.seats[free] = ws; r.ready[free] = false; }
    else { if (!r.spec && !(m.watch && r.host === ws)) return send(ws, { t: 'err', m: r.run ? '게임 중이고 관전이 꺼진 방이에요.' : '자리가 없고 관전이 꺼진 방이에요.' });
      if (r.specs.length >= MAX_SPEC) return send(ws, { t: 'err', m: '관전 자리가 가득 찼어요.' }); r.specs.push(ws); }
    ws.room = r.id; pushInfo(r);
    if (r.run && r.specs.includes(ws)) { send(ws, startMsg(r, ws)); sendCatch(ws, r.run, 0); }
    return;
  }
  const r = ws.room && rooms.get(ws.room); if (!r) return;
  if (t === 'leave') return leaveRoom(ws);
  if (t === 'chat') { const s = str(m.s, 40); if (s) bcast(r, { t: 'chat', name: ws.name, s }); return; }
  if (!r.run) { // ── 대기실 ──
    const si = r.seats.indexOf(ws);
    if (t === 'seat') { const to = m.to === 1 ? 1 : m.to === 0 ? 0 : -1;
      if (to < 0) { if (si >= 0) { r.seats[si] = null; r.ready[si] = false; } if (!r.specs.includes(ws)) r.specs.push(ws); } // 관전으로 빠지기
      else if (!r.seats[to]) { if (si >= 0) { r.seats[si] = null; r.ready[si] = false; } r.specs = r.specs.filter(s => s !== ws); r.seats[to] = ws; r.ready[to] = false; }
      return pushInfo(r); }
    if (t === 'swap') { // 자리 바꾸기: 상대 자리가 비었으면 바로, 아니면 상대에게 물어봄
      if (si < 0) return; const o = r.seats[1 - si];
      if (!o) { r.seats[1 - si] = ws; r.seats[si] = null; r.ready = [false, false]; return pushInfo(r); }
      r.swapReq = { from: ws, to: o }; return pushInfo(r); }
    if (t === 'swapAns') { const q = r.swapReq; if (!q || q.to !== ws) return; r.swapReq = null;
      if (m.ok) { const a = r.seats.indexOf(q.from), b = r.seats.indexOf(q.to); if (a >= 0 && b >= 0) { r.seats[a] = q.to; r.seats[b] = q.from; r.ready = [false, false]; } }
      return pushInfo(r); }
    if (t === 'ready') { if (si >= 0 && ws !== r.host) { r.ready[si] = !!m.on; pushInfo(r); } return; }
    if (t === 'cfg') { if (ws !== r.host) return; if (DIFFS.includes(m.diff)) r.diff = m.diff; if (m.stage) r.stage = Math.max(1, Math.min(r.host.max || 1, m.stage | 0)); if (typeof m.spec === 'boolean') r.spec = m.spec; return pushInfo(r); }
    if (t === 'start') {
      if (ws !== r.host) return; const pl = r.seats.map((s, i) => s ? i : -1).filter(i => i >= 0); if (!pl.length) return;
      const hostSeat = r.seats.indexOf(ws);
      if (m.solo) { if (hostSeat < 0) return send(ws, { t: 'err', m: '자리에 앉아야 시작할 수 있어요.' }); pl.length = 0; pl.push(hostSeat); }
      else if (pl.length === 2 && !pl.every(i => r.seats[i] === r.host || r.ready[i])) return send(ws, { t: 'err', m: '상대가 아직 준비하지 않았어요.' });
      else if (pl.length < 2) return send(ws, { t: 'err', m: '2인 시작은 상대가 들어와야 해요. 혼자 하려면 "혼자 시작"을 눌러 주세요.' });
      const players = pl.map(i => r.seats[i]), np = players.length;
      const oneWay = Math.max(...players.map(p => p.rtt || 60)) / 2;
      const D = np === 1 ? 2 : Math.max(3, Math.min(8, Math.round(oneWay / 16.7) + 2));
      r.run = { seed: (Math.random() * 4294967295) >>> 0, np, pl: players, ships: pl.map(i => i === 0 ? 'bbabjji' : 'mandu'), names: players.map(p => p.name), autos: players.map(p => p.auto !== false),
        diff: r.diff, stage: r.stage, D, log: [], ev: [], last: players.map(() => -1), away: players.map(() => false), gone: players.map(() => false), sums: new Map() };
      r.swapReq = null;
      for (const w of members(r)) send(w, startMsg(r, w));
      return pushInfo(r);
    }
    return;
  }
  // ── 게임 중 ──
  const run = r.run, p = run.pl.indexOf(ws);
  if (t === 'in') { if (p < 0 || !Array.isArray(m.d)) return; const f = m.f | 0; if (f <= run.last[p]) return;
    run.last[p] = f; const e = [p, f, m.d[0] | 0, m.d[1] | 0, m.d[2] | 0]; if (run.log.length < MAX_LOG) run.log.push(e);
    const s = JSON.stringify({ t: 'in', e }); for (const w of members(r)) if (w !== ws) send(w, s); return; }
  if (t === 'away') { if (p < 0 || run.away[p]) return; run.away[p] = true; const ev = { k: 'away', p, f: run.last[p] + 1 }; run.ev.push(ev); bcast(r, { t: 'ev', ev }); return; }
  if (t === 'back') { if (p < 0 || !run.away[p]) return; run.away[p] = false;
    const a = run.ev.filter(e => e.p === p && e.k === 'away').pop(), E = a ? a.f : run.last[p] + 1;
    let o = -1, act = false; run.pl.forEach((w, q) => { if (q !== p && !run.gone[q]) { o = Math.max(o, run.last[q]); if (!run.away[q]) act = true; } });
    const B = Math.max(E, o + 1 + (act ? run.D + 6 : 0)); // 다른 사람이 이어 간 칸 뒤에서 다시 합류(이어 가는 중이면 조금 더 앞쪽)
    run.last[p] = B - 1; const ev = { k: 'back', p, f: B }; run.ev.push(ev); bcast(r, { t: 'ev', ev });
    sendCatch(ws, run, Math.max(0, (m.cur | 0) - 1)); return; }
  if (t === 'sum') { if (p < 0) return; const f = m.f | 0, v = m.v | 0; const o = run.sums.get(f);
    if (o == null) { run.sums.set(f, v); if (run.sums.size > 50) run.sums.delete(run.sums.keys().next().value); }
    else if (o !== v) { console.error('shoot desync room', r.id, 'frame', f); bcast(r, { t: 'desync', f }); } return; }
  if (t === 'end') { if (p >= 0) endRun(r); return; }
}
function attach() {
  const sw = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  sw.on('connection', ws => {
    ws.room = null; ws.last = Date.now(); ws.cnt = 0; ws.name = '빱알이'; ws.max = 1;
    ws.on('message', (raw, isBin) => { ws.last = Date.now(); if (isBin || ++ws.cnt > 400) return ws.terminate(); let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; } if (!m || typeof m !== 'object') return; try { onMsg(ws, m); } catch (e) { console.error('shoot msg', e); } });
    ws.on('pong', () => { ws.last = Date.now(); }); ws.on('close', () => leaveRoom(ws)); ws.on('error', () => { });
  });
  let tick = 0; // 창을 내린 탭은 타이머가 느려져서, 서버가 10초마다 연결 확인(브라우저가 자동으로 답함)
  setInterval(() => { const t = Date.now(); tick++; for (const ws of sw.clients) { ws.cnt = 0; if (t - ws.last > 45000) ws.terminate(); else if (tick % 10 === 0) try { ws.ping(); } catch (e) { } } }, 1000);
  return sw;
}
function roomsHttp(res) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(listOf())); }
module.exports = { attach, rooms, roomsHttp };
