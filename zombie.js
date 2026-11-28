'use strict';
/* 잠못드는 빱찌의 밤 — 방 목록·대기실 + 입력 전달. 주소: wss://<게임 서버>/zombie
   게임 계산은 각자 화면에서 한다(같은 씨앗 + 같은 입력 = 같은 결과). 서버는 1초에 20번, 모든 사람의 입력을 한 묶음으로 나눠 줄 뿐이다(전송량 아주 적음).
   - 자리 4개. 방장이 난이도를 정하고 시작. 한 방에서 같은 캐릭터는 한 명만
   - 2초마다 각자 상태 지문을 보낸다. 기준(방장)과 다른 사람이 있으면 기준의 상태를 받아 그 사람에게 넘겨 다시 맞춘다
   - 도중에 들어오거나 끊겼다 돌아온 사람도 같은 방법(기준의 상태 받기)으로 이어서 한다 */
const { WebSocketServer } = require('ws');
const rooms = new Map();
const MAX_ROOMS = 100, MAX_SEAT = 4, NCH = 15, FRAME_MS = 1000 / 30 /* v1.64 1초에 30번 나눠 준다(예전 20번): 조작이 화면에 닿기까지의 시간을 줄인다 */, TPF = 2 /* 묶음 하나 = 2틱 */, DIFFS = ['easy', 'normal', 'hard'], SNAP_MAX = 900000;
const str = (v, n) => String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const int = (v, a, b, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
function send(ws, m) { if (ws && ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
function newId() { let id; do { id = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(id)); return id; }
function seatOf(r, ws) { return r.seats.indexOf(ws); }
function freeCh(r, ch, me) { const used = new Set(r.seats.filter(s => s && s !== me).map(s => s.ch)); if (!used.has(ch)) return ch; for (let i = 0; i < NCH; i++) if (!used.has(i)) return i; return ch; }
function info(r, ws) { return { t: 'room', id: r.id, title: r.title, lock: !!r.pw, cfg: r.cfg, host: seatOf(r, r.host), me: seatOf(r, ws), run: !!r.run,
  seats: r.seats.map((s, i) => s ? { name: s.name, ch: s.ch, ready: !!r.ready[i] } : null) }; }
function pushInfo(r) { for (const ws of r.seats) if (ws) send(ws, info(r, ws)); }
function listOf() { return [...rooms.values()].map(r => ({ id: r.id, title: r.title, lock: !!r.pw, n: r.seats.filter(Boolean).length, max: MAX_SEAT, run: !!r.run, diff: r.cfg.diff, t: r.run ? Math.floor(r.run.f * FRAME_MS / 1000) : 0 })); }

/* ---------- 한 판 ---------- */
const emptyIn = () => [0, 0, 0, -1, -1, -1]; // [dx, dy, 한 번짜리(1 구르기 · 2 다시 뽑기 · 4 카드 창 열기 · 8 스킬), 카드 고르기, 편의점 고르기, 만두 명령]
function refOf(run) { return run.pl.findIndex(p => p.ws && !p.gone && !p.sync); } // 기준 = 접속해 있고 맞춰져 있는 첫 사람(보통 방장)
function startRun(r) {
  const pl = []; r.seats.forEach(ws => { if (ws) pl.push({ ws, name: ws.name, ch: ws.ch, cid: ws.cid, gone: false, sync: false, inp: emptyIn(), syncAt: 0 }); });
  r.run = { f: 0, seed: (Math.random() * 2147483647) | 0, cfg: { diff: r.cfg.diff }, pl, evq: [], hs: new Map(), t0: Date.now() };
  pl.forEach((p, i) => send(p.ws, startMsg(r, i, 0)));
}
function startMsg(r, me, resume) { const run = r.run; return { t: 'start', seed: run.seed, cfg: run.cfg, players: run.pl.map(p => ({ name: p.name, ch: p.ch })), me, resume: resume ? 1 : 0, f: run.f, tpf: TPF, fms: FRAME_MS }; }
function askSnap(r, to) { // 기준의 상태를 받아 to 번 사람에게 넘긴다(다음 묶음이 끝난 시점의 상태)
  const run = r.run, ref = refOf(run), now = Date.now(), p = run.pl[to]; if (ref < 0 || ref === to || !p || !p.ws) return false; if (now - p.syncAt < 4000) return true;
  p.syncAt = now; p.sync = true; send(run.pl[ref].ws, { t: 'snapReq', to, f: run.f + 1 }); return true;
}
function joinRun(r, ws) { // 진행 중인 방에 들어옴: 끊겼던 사람이면 제자리로, 새 사람이면 자리를 하나 더 만든다
  const run = r.run; let i = run.pl.findIndex(p => p.gone && p.cid && p.cid === ws.cid);
  if (i >= 0) { const p = run.pl[i]; p.ws = ws; p.gone = false; p.inp = emptyIn(); p.name = ws.name; run.evq.push({ k: 'back', p: i }); }
  else { if (run.pl.length >= MAX_SEAT) return false; i = run.pl.length; run.pl.push({ ws, name: ws.name, ch: ws.ch, cid: ws.cid, gone: false, sync: true, inp: emptyIn(), syncAt: 0 }); run.evq.push({ k: 'join', p: i, name: ws.name, ch: ws.ch }); }
  run.pl[i].sync = true; run.pl[i].syncAt = 0; send(ws, startMsg(r, i, 1)); if (!askSnap(r, i)) { run.pl[i].sync = false; } return true;
}
function leaveRun(r, ws) { const run = r.run; if (!run) return; const i = run.pl.findIndex(p => p.ws === ws); if (i < 0) return; const p = run.pl[i]; p.ws = null; p.gone = true; p.sync = false; p.inp = emptyIn(); run.evq.push({ k: 'gone', p: i });
  if (!run.pl.some(q => q.ws)) endRun(r); }
function endRun(r) { r.run = null; r.ready.fill(false); if (r.seats.some(Boolean)) pushInfo(r); }
function frame(r) {
  const run = r.run; run.f++; const m = { t: 'f', f: run.f, i: run.pl.map(p => p.inp), a: run.pl.map(p => p.seq || 0) /* 각자의 입력을 몇 번째 것까지 받았는지(내 캐릭터 미리 움직이기에 쓴다) */ }; if (run.evq.length) { m.e = run.evq; run.evq = []; }
  const s = JSON.stringify(m); for (const p of run.pl) { if (p.ws) send(p.ws, s); p.inp = [p.inp[0], p.inp[1], 0, -1, -1, -1]; } // 방향은 이어지고, 한 번짜리는 지운다
  if (run.f % 200 === 0) for (const k of run.hs.keys()) if (k < run.f - 400) run.hs.delete(k);
  if (run.f > 30 * 60 * 90) endRun(r); // 90분이 넘으면 끝낸다
}
function onHash(r, ws, m) { // 상태 지문 비교: 기준과 다르면 그 사람을 다시 맞춘다
  const run = r.run, i = run.pl.findIndex(p => p.ws === ws); if (i < 0 || run.pl[i].sync) return; const f = int(m.f, 0, 1e9, -1), h = int(m.h, -2147483648, 4294967295, 0); if (f < run.f - 400 || f > run.f) return;
  let o = run.hs.get(f); if (!o) run.hs.set(f, o = {}); o[i] = h; const ref = refOf(run); if (ref < 0 || o[ref] == null) return;
  for (const k in o) if (+k !== ref && o[k] !== o[ref] && run.pl[k] && run.pl[k].ws && !run.pl[k].sync) { console.log('zombie desync room', r.id, 'frame', f, 'player', k); askSnap(r, +k); }
}

/* ---------- 방 ---------- */
function leaveRoom(ws) {
  const r = rooms.get(ws.room); ws.room = null; if (!r) return; const i = seatOf(r, ws); if (i >= 0) { r.seats[i] = null; r.ready[i] = false; }
  leaveRun(r, ws);
  if (!r.seats.some(Boolean)) { rooms.delete(r.id); return; }
  if (r.host === ws) r.host = r.seats.find(Boolean); pushInfo(r);
}
function onMsg(ws, m) {
  const t = m.t;
  if (t === 'i') { const r = rooms.get(ws.room), run = r && r.run; if (!run) return; const p = run.pl.find(q => q.ws === ws); if (!p || !Array.isArray(m.i)) return; const a = m.i, b = p.inp; p.seq = int(m.q, 0, 2e9, p.seq || 0);
    b[0] = int(a[0], -127, 127, 0); b[1] = int(a[1], -127, 127, 0); b[2] |= int(a[2], 0, 15, 0); const pk = int(a[3], -1, 3, -1), by = int(a[4], -1, 8, -1), ac = int(a[5], -1, 4, -1); if (pk >= 0) b[3] = pk; if (by >= 0) b[4] = by; if (ac >= 0) b[5] = ac; return; }
  if (t === 'h') { const r = rooms.get(ws.room); if (r && r.run) onHash(r, ws, m); return; }
  if (t === 'snap') { const r = rooms.get(ws.room), run = r && r.run; if (!run) return; const ref = refOf(run); if (ref < 0 || run.pl[ref].ws !== ws) return; const to = run.pl[int(m.to, 0, MAX_SEAT - 1, -1)]; if (!to || !to.ws || typeof m.s !== 'string' || m.s.length > SNAP_MAX) return;
    send(to.ws, { t: 'snap', f: int(m.f, 0, 1e9, 0), s: m.s }); to.sync = false; return; }
  if (t === 'end') { const r = rooms.get(ws.room), run = r && r.run; if (!run) return; const ref = refOf(run); if (ref >= 0 && run.pl[ref].ws === ws) endRun(r); return; } // 기준이 "끝났다"고 하면 대기실로
  if (t === 'hello') { ws.name = str(m.name, 10) || '빱알이'; ws.ch = int(m.ch, 0, NCH - 1, 0); ws.cid = str(m.cid, 24); return send(ws, { t: 'hi' }); }
  if (t === 'list') return send(ws, { t: 'rooms', list: listOf() });
  if (t === 'create') {
    if (ws.room) leaveRoom(ws); if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: '방이 가득 찼어요. 잠시 뒤에 다시 시도해 주세요.' });
    const r = { id: newId(), title: str(m.title, 20) || (ws.name || '빱알이') + '의 잠 못 드는 밤', pw: str(m.pw, 12), host: ws, seats: new Array(MAX_SEAT).fill(null), ready: new Array(MAX_SEAT).fill(false), cfg: { diff: DIFFS.includes(m.diff) ? m.diff : 'normal' }, run: null };
    r.seats[0] = ws; rooms.set(r.id, r); ws.room = r.id; return pushInfo(r);
  }
  if (t === 'join') {
    const r = rooms.get(str(m.id, 8)); if (!r) return send(ws, { t: 'err', m: '방이 없어졌어요.' });
    if (r.pw && str(m.pw, 12) !== r.pw) return send(ws, { t: 'err', m: '비밀번호가 달라요.', pw: 1, id: r.id });
    if (ws.room === r.id) return pushInfo(r); if (ws.room) leaveRoom(ws);
    const i = r.seats.indexOf(null); if (i < 0) return send(ws, { t: 'err', m: '자리가 다 찼어요.' });
    if (r.run && !r.run.pl.some(p => p.gone && p.cid && p.cid === ws.cid) && r.run.pl.length >= MAX_SEAT) return send(ws, { t: 'err', m: '이번 판은 자리가 다 찼어요. 판이 끝나면 들어올 수 있어요.' });
    r.seats[i] = ws; r.ready[i] = false; ws.room = r.id; ws.ch = freeCh(r, ws.ch, ws); pushInfo(r); if (r.run) joinRun(r, ws); return;
  }
  if (t === 'leave') { if (ws.room) leaveRoom(ws); return send(ws, { t: 'left' }); }
  const r = rooms.get(ws.room); if (!r) return; const i = seatOf(r, ws); if (i < 0) return;
  if (t === 'ch') { if (r.run) return; const c = int(m.ch, 0, NCH - 1, 0); if (r.seats.some(s => s && s !== ws && s.ch === c)) return send(ws, { t: 'err', m: '다른 사람이 고른 캐릭터예요.' }); ws.ch = c; return pushInfo(r); }
  if (t === 'ready') { if (r.run) return; r.ready[i] = !!m.v; return pushInfo(r); }
  if (t === 'cfg') { if (ws !== r.host || r.run) return; if (DIFFS.includes(m.diff)) r.cfg.diff = m.diff; if (typeof m.title === 'string') r.title = str(m.title, 20) || r.title; return pushInfo(r); }
  if (t === 'start') { if (ws !== r.host || r.run) return; if (r.seats.some((s, k) => s && s !== r.host && !r.ready[k])) return send(ws, { t: 'err', m: '아직 준비하지 않은 사람이 있어요.' }); startRun(r); return pushInfo(r); }
  if (t === 'say') { const s = str(m.s, 60); if (s) for (const o of r.seats) if (o) send(o, { t: 'say', p: i, name: ws.name, s }); return; }
}
function attach() {
  const sw = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  sw.on('connection', ws => {
    ws.room = null; ws.last = Date.now(); ws.cnt = 0; ws.name = '빱알이'; ws.ch = 0; ws.cid = '';
    ws.on('message', (raw, isBin) => { ws.last = Date.now(); if (isBin || ++ws.cnt > 160) return ws.terminate(); let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; } if (!m || typeof m !== 'object') return; try { onMsg(ws, m); } catch (e) { console.error('zombie msg', e); } });
    ws.on('pong', () => { ws.last = Date.now(); }); ws.on('close', () => leaveRoom(ws)); ws.on('error', () => { });
  });
  let tick = 0;
  setInterval(() => { const t = Date.now(); tick++; for (const ws of sw.clients) { ws.cnt = 0; if (t - ws.last > 45000) ws.terminate(); else if (tick % 10 === 0) try { ws.ping(); } catch (e) { } } }, 1000);
  setInterval(() => { const now = Number(process.hrtime.bigint() / 1000000n); for (const r of rooms.values()) if (r.run) { const run = r.run; if (!run.nx || now - run.nx > 250) run.nx = now; /* 처음이거나 크게 밀렸으면 지금부터 다시 센다 */ let n = 0; while (r.run === run && now >= run.nx && n++ < 3) { run.nx += FRAME_MS; try { frame(r); } catch (e) { console.error('zombie frame', e); endRun(r); } } } }, 5); // 5ms 마다 살펴서, 때가 된 방만 묶음을 내보낸다(시계가 밀려도 평균 빠르기는 정확히 1초 30번)
  return sw;
}
function roomsHttp(res) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(listOf())); }
module.exports = { attach, rooms, roomsHttp };
