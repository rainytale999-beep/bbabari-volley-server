'use strict';
/* 빱알이 격투 — 연결 중계(배구 방과 완전히 따로). 주소: wss://<게임 서버>/fight
   하는 일: 같은 링크(방 코드)로 들어온 두 사람을 이어 주고, 서로의 키 입력을 그대로 전해 준다(계산은 두 브라우저가 똑같이 함).
   방은 2명까지. 둘 다 '대전 신청'을 누르면 같은 씨앗값(난수)으로 동시에 시작한다. */
const { WebSocketServer } = require('ws');
const rooms = new Map();
const clean = v => String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
function send(ws, m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function other(ws) { const r = ws.room && rooms.get(ws.room); return r ? r.peers.find(p => p !== ws) : null; }
function leave(ws) {
  const r = ws.room && rooms.get(ws.room); if (!r) return;
  r.peers = r.peers.filter(p => p !== ws); r.ready = [false, false]; r.playing = false;
  for (const p of r.peers) send(p, { t: 'peer', on: false });
  if (!r.peers.length) rooms.delete(ws.room); ws.room = null;
}
function onMsg(ws, m) {
  if (m.t === 'join') {
    if (ws.room) return; const code = clean(m.room); if (code.length < 4) return send(ws, { t: 'err', s: 'bad room' });
    let r = rooms.get(code); if (!r) { if (rooms.size > 200) return send(ws, { t: 'err', s: 'busy' }); r = { peers: [], ready: [false, false], playing: false, seq: 0 }; rooms.set(code, r); }
    if (r.peers.length >= 2) return send(ws, { t: 'full' });
    r.peers.push(ws); ws.room = code; ws.ch = m.ch | 0; ws.name = String(m.name || '').slice(0, 10);
    send(ws, { t: 'joined', n: r.peers.length });
    const o = other(ws); if (o) { send(o, { t: 'peer', on: true, ch: ws.ch }); send(ws, { t: 'peer', on: true, ch: o.ch }); }
    return;
  }
  const r = ws.room && rooms.get(ws.room); if (!r) return;
  const o = other(ws);
  if (m.t === 'ch') { ws.ch = m.ch | 0; send(o, { t: 'peerCh', ch: ws.ch }); }
  else if (m.t === 'love') { // 대전 신청(둘 다 누르면 시작)
    const i = r.peers.indexOf(ws); r.ready[i] = !!m.on; send(o, { t: 'peerLove', on: !!m.on });
    if (r.peers.length === 2 && r.ready[0] && r.ready[1] && !r.playing) {
      r.playing = true; r.ready = [false, false]; r.seq++;
      const seed = (Math.random() * 2147483647) | 0, chs = r.peers.map(p => p.ch);
      r.peers.forEach((p, k) => send(p, { t: 'start', seed, side: k, chs, game: r.seq, delay: 4 }));
    }
  }
  else if (m.t === 'in') { if (r.playing) send(o, { t: 'in', f: m.f | 0, k: m.k | 0, g: m.g | 0 }); } // 입력 그대로 전달
  else if (m.t === 'sum') { if (r.playing) send(o, { t: 'sum', f: m.f | 0, v: m.v | 0 }); } // 계산이 어긋났는지 확인용
  else if (m.t === 'end') { r.playing = false; }
  else if (m.t === 'ping') send(ws, { t: 'pong', c: m.c });
}
function attach(server) {
  const fw = new WebSocketServer({ noServer: true, maxPayload: 512 });
  fw.on('connection', ws => {
    ws.room = null; ws.last = Date.now(); ws.cnt = 0;
    ws.on('message', (raw, isBin) => { ws.last = Date.now(); if (isBin || ++ws.cnt > 300) return ws.terminate(); let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; } try { onMsg(ws, m); } catch (e) { console.error('fight msg', e); } });
    ws.on('close', () => leave(ws)); ws.on('error', () => { });
  });
  setInterval(() => { const t = Date.now(); for (const ws of fw.clients) { ws.cnt = 0; if (t - ws.last > 20000) ws.terminate(); } }, 1000);
  return fw;
}
module.exports = { attach, rooms };
