'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const rooms = new Map();
const matchmaking = [];
const VERSION = 'ONLINE-REBUILD-3';
const DB_FILE = path.join(ROOT, 'tomtom-data.json');
let db = { users: {}, games: [], clans: {} };
if (!db.clans) db.clans = {};
try { if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch (_) {}
function persist(){ try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (_) {} }
function hash(v){ return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function token(){ return crypto.randomBytes(24).toString('hex'); }
function leagueFor(rating){ const r=Number(rating)||1200; if(r<1000)return {key:'bronze',name:'برنز',min:0,max:999}; if(r<1200)return {key:'silver',name:'نقره‌ای',min:1000,max:1199}; if(r<1400)return {key:'gold',name:'طلایی',min:1200,max:1399}; if(r<1600)return {key:'platinum',name:'پلاتینیوم',min:1400,max:1599}; if(r<1800)return {key:'diamond',name:'الماس',min:1600,max:1799}; return {key:'master',name:'مستر',min:1800,max:null}; }
function safeUser(u){ return { username:u.username, name:u.name, rating:u.rating, wins:u.wins, losses:u.losses, draws:u.draws, level:u.level, xp:u.xp, league:leagueFor(u.rating) }; }
function auth(body){ const u=db.users[String(body.username||'').toLowerCase()]; return u && u.token===body.token ? u : null; }
function clanLevel(xp){ let level=1, need=500, rest=Math.max(0,Number(xp)||0); while(rest>=need && level<50){rest-=need;level++;need=Math.round(need*1.25)} return {level,xp:rest,next:need}; }
function clanRoleName(role){ return ({leader:'رهبر',deputy:'قائم‌مقام',veteran:'پیشکسوت',member:'تازه‌وارد'})[role]||'تازه‌وارد'; }
function clanSafe(c){
  const lv=clanLevel(c.xp||0);
  return {id:c.id,name:c.name,tag:c.tag,badge:c.badge,level:lv.level,xp:lv.xp,nextXp:lv.next,leader:c.leader,memberCount:c.members.length,war:c.war?{id:c.war.id,opponent:c.war.opponent,startsAt:c.war.startsAt,endsAt:c.war.endsAt,score:c.war.score,attacks:c.war.attacks}:null};
}
function onlineUsernames(){ const set=new Set(); for(const client of wss?.clients||[]) if(client.readyState===WebSocket.OPEN&&client.username) set.add(client.username); return set; }
function clanView(c){ const on=onlineUsernames(); return {...clanSafe(c),members:c.members.map(m=>({...m,roleName:clanRoleName(m.role),online:on.has(m.username),attacks:c.war?.attacks?.[m.username]||0}))}; }
function findClanByUser(username){ return Object.values(db.clans).find(c=>c.members.some(m=>m.username===username)); }
function clanCanManage(c,u){ const m=c?.members.find(x=>x.username===u.username); return m && (m.role==='leader'||m.role==='deputy'); }
function clanTouchWar(c){ if(c?.war && Date.now()>c.war.endsAt){ c.war=null; persist(); } return c?.war; }
function clanOpponents(c){ return Object.values(db.clans).filter(x=>x.id!==c.id && x.members.length && !x.war); }


function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}
function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function roomCode() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function validCode(s) { return /^[A-Z0-9]{3,8}$/.test(s); }
function cleanName(s, fallback) { return String(s || fallback).trim().slice(0, 24) || fallback; }
function removeQueue(ws) {
  for (let i = matchmaking.length - 1; i >= 0; i--) if (matchmaking[i] === ws) matchmaking.splice(i, 1);
  ws.__matchReqId = null;
}
function roomOf(ws) { return ws.room ? rooms.get(ws.room) : null; }
function broadcast(room, data, except) {
  for (const player of room.players) if (player.ws !== except) send(player.ws, data);
}
function state(room) {
  return {
    type: 'room_state',
    room: room.code,
    started: !!room.started,
    players: room.players.map(p => ({ color: p.color, name: p.name, username: p.username }))
  };
}
function leaveRoom(ws, notify) {
  const id = ws.room;
  if (!id) return;
  const room = rooms.get(id);
  ws.room = null; ws.color = null;
  if (!room) return;
  room.players = room.players.filter(p => p.ws !== ws);
  if (room.players.length < 2) room.started = false;
  if (!room.players.length) rooms.delete(id);
  else {
    if (notify) broadcast(room, { type: 'opponent_left' });
    broadcast(room, state(room));
  }
}
function joinRoom(ws, id, name, username, reqId) {
  const room = rooms.get(id);
  if (!room) return send(ws, { type: 'error', reqId, message: 'اتاق پیدا نشد یا صاحب اتاق آفلاین شده است.' });
  if (room.players.length >= 2) return send(ws, { type: 'error', reqId, message: 'این اتاق پر است.' });
  leaveRoom(ws, false);
  const player = { ws, color: 'b', name: cleanName(name, 'PLAYER 2'), username: String(username || '').slice(0, 32) };
  room.players.push(player);
  ws.room = id; ws.color = player.color; ws.name = player.name; ws.username = player.username;
  send(ws, { type: 'room_joined', reqId, room: id, color: player.color });
  broadcast(room, state(room));
}
function createRoom(ws, id, name, username, reqId) {
  removeQueue(ws); leaveRoom(ws, false);
  if (!id) { do { id = roomCode(); } while (rooms.has(id)); }
  if (!validCode(id)) return send(ws, { type: 'error', reqId, message: 'کد اتاق باید ۳ تا ۸ حرف انگلیسی یا عدد باشد.' });
  if (rooms.has(id)) return send(ws, { type: 'error', reqId, message: 'این کد اتاق قبلاً استفاده شده است.' });
  const room = { code: id, players: [], lastMove: null, started: false };
  const player = { ws, color: 'w', name: cleanName(name, 'PLAYER 1'), username: String(username || '').slice(0, 32) };
  room.players.push(player); rooms.set(id, room);
  ws.room = id; ws.color = player.color; ws.name = player.name; ws.username = player.username;
  send(ws, { type: 'room_created', reqId, room: id, color: player.color });
  send(ws, state(room));
}
function findOpponent(ws){
  let bestIndex=-1, bestDiff=Infinity;
  const rating=Number(ws.__rating)||1200;
  for(let i=0;i<matchmaking.length;i++){
    const other=matchmaking[i];
    if(!other||other===ws||other.readyState!==WebSocket.OPEN||other.room)continue;
    const diff=Math.abs((Number(other.__rating)||1200)-rating);
    if(diff<bestDiff){bestDiff=diff;bestIndex=i;}
  }
  if(bestIndex<0)return null;
  const other=matchmaking.splice(bestIndex,1)[0];
  other.__matchReqId=null;
  return other;
}
function matchmake(ws, reqId, msg) {
  removeQueue(ws); leaveRoom(ws, false);
  ws.name = cleanName(msg.name, 'PLAYER');
  ws.username = String(msg.username || '').slice(0, 32);
  ws.__rating = Math.max(0, Number(msg.rating)||1200);
  const other = findOpponent(ws);
  if (!other) {
    ws.__matchReqId = reqId;
    matchmaking.push(ws);
    return send(ws, { type: 'match_waiting', reqId });
  }
  const id = roomCode();
  const room = { code: id, players: [
    { ws: other, color: 'w', name: other.name, username: other.username },
    { ws, color: 'b', name: ws.name, username: ws.username }
  ], lastMove: null, started: true };
  rooms.set(id, room);
  other.room = id; other.color = 'w';
  ws.room = id; ws.color = 'b';
  send(other, { type: 'match_found', reqId: other.__matchReqId, room: id, color: 'w' });
  send(ws, { type: 'match_found', reqId, room: id, color: 'b' });
  broadcast(room, state(room));
  other.__matchReqId = null;
  ws.__matchReqId = null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'TOMTOM CHESS', version: VERSION, websocket: true, websocketPath: '/ws', time: new Date().toISOString() });
  }
  if (url.pathname.startsWith('/api/')) {
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let msg={}; try{msg=body?JSON.parse(body):{}}catch(_){return json(res,400,{error:'JSON نامعتبر'})}
      if(req.method==='POST' && url.pathname==='/api/register'){
        const username=String(msg.username||'').trim().toLowerCase(), password=String(msg.password||''), name=cleanName(msg.name,username);
        if(!/^[a-z0-9_]{3,20}$/.test(username)||password.length<4)return json(res,400,{error:'نام کاربری ۳ تا ۲۰ حرف انگلیسی/عدد و رمز حداقل ۴ کاراکتر باشد.'});
        if(db.users[username])return json(res,409,{error:'این نام کاربری قبلاً ثبت شده است.'});
        const u={username,name,password:hash(password),token:token(),rating:1200,wins:0,losses:0,draws:0,level:1,xp:0};db.users[username]=u;persist();return json(res,200,{user:safeUser(u),token:u.token});
      }
      if(req.method==='POST' && url.pathname==='/api/login'){
        const username=String(msg.username||'').trim().toLowerCase(),u=db.users[username];
        if(!u||u.password!==hash(msg.password||''))return json(res,401,{error:'نام کاربری یا رمز عبور اشتباه است.'});
        u.token=token();persist();return json(res,200,{user:safeUser(u),token:u.token});
      }
      if(req.method==='GET' && url.pathname==='/api/leaderboard'){
        const players=Object.values(db.users).sort((a,b)=>b.rating-a.rating).slice(0,50).map((u,i)=>({rank:i+1,...safeUser(u)}));return json(res,200,{players});
      }
      if(req.method==='GET' && url.pathname==='/api/games'){
        const u=auth({username:url.searchParams.get('username'),token:url.searchParams.get('token')});if(!u)return json(res,401,{error:'نیاز به ورود دارید.'});
        return json(res,200,{games:db.games.filter(g=>g.players.includes(u.username)).slice(-50).reverse()});
      }
      if(req.method==='POST' && url.pathname==='/api/result'){
        const u=auth(msg);if(!u)return json(res,401,{error:'نیاز به ورود دارید.'});
        const result=['win','loss','draw'].includes(msg.result)?msg.result:'draw';
        if(result==='win'){u.wins++;u.rating+=12;u.xp+=35}else if(result==='loss'){u.losses++;u.rating=Math.max(100,u.rating-10);u.xp+=8}else{u.draws++;u.xp+=18}
        while(u.xp>=100){u.xp-=100;u.level++}persist();return json(res,200,{user:safeUser(u)});
      }
      if(req.method==='POST' && url.pathname==='/api/game'){
        const u=auth(msg);if(!u)return json(res,401,{error:'نیاز به ورود دارید.'});
        const g=msg.game||{};db.games.push({id:crypto.randomUUID(),players:Array.isArray(g.players)?g.players.slice(0,2):[u.username],result:g.result||'draw',moves:Array.isArray(g.moves)?g.moves.slice(0,500):[],createdAt:new Date().toISOString()});if(db.games.length>1000)db.games=db.games.slice(-1000);persist();return json(res,200,{ok:true});
      }

      if(req.method==='GET' && url.pathname==='/api/clan/search'){
        const q=String(url.searchParams.get('q')||'').trim().toLowerCase(); const clans=Object.values(db.clans).filter(c=>!q||c.name.toLowerCase().includes(q)||c.tag.toLowerCase().includes(q)).slice(0,30).map(clanSafe); return json(res,200,{clans});
      }
      if(req.method==='GET' && url.pathname==='/api/clan'){
        const u=auth({username:url.searchParams.get('username'),token:url.searchParams.get('token')}); if(!u)return json(res,401,{error:'نیاز به ورود دارید.'}); const c=findClanByUser(u.username); return json(res,200,{clan:c?clanView(c):null});
      }
      if(req.method==='POST' && url.pathname==='/api/clan/create'){
        const u=auth(msg); if(!u)return json(res,401,{error:'ابتدا وارد حساب شوید.'}); if(Number(u.rating)<1200)return json(res,403,{error:'برای ساخت کلن باید به لیگ طلایی برسید.'}); if(findClanByUser(u.username))return json(res,409,{error:'شما همین حالا عضو یک کلن هستید.'});
        const name=cleanName(msg.name,'TOMTOM CLAN').slice(0,24), tag=String(msg.tag||'TOM').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); if(name.length<3||tag.length<2)return json(res,400,{error:'نام کلن و تگ معتبر وارد کنید.'}); if(Object.values(db.clans).some(c=>c.name.toLowerCase()===name.toLowerCase()||c.tag===tag))return json(res,409,{error:'نام یا تگ کلن قبلاً استفاده شده است.'});
        const id=crypto.randomUUID(); db.clans[id]={id,name,tag,badge:String(msg.badge||'♜').slice(0,2),leader:u.username,xp:0,members:[{username:u.username,name:u.name,role:'leader',joinedAt:Date.now()}],war:null}; persist(); return json(res,200,{clan:clanView(db.clans[id])});
      }
      if(req.method==='POST' && url.pathname==='/api/clan/join'){
        const u=auth(msg); if(!u)return json(res,401,{error:'ابتدا وارد حساب شوید.'}); if(findClanByUser(u.username))return json(res,409,{error:'ابتدا از کلن فعلی خارج شوید.'}); const c=db.clans[String(msg.clanId||'')]; if(!c)return json(res,404,{error:'کلن پیدا نشد.'}); if(c.members.length>=50)return json(res,409,{error:'ظرفیت کلن پر است.'}); c.members.push({username:u.username,name:u.name,role:'member',joinedAt:Date.now()});persist();return json(res,200,{clan:clanView(c)});
      }
      if(req.method==='POST' && url.pathname==='/api/clan/leave'){
        const u=auth(msg); if(!u)return json(res,401,{error:'ابتدا وارد حساب شوید.'}); const c=findClanByUser(u.username); if(!c)return json(res,404,{error:'عضو کلنی نیستید.'}); if(c.leader===u.username)return json(res,400,{error:'رهبر باید قبل از خروج، رهبری را منتقل کند.'}); c.members=c.members.filter(m=>m.username!==u.username);persist();return json(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/clan/role'){
        const u=auth(msg); if(!u)return json(res,401,{error:'ابتدا وارد حساب شوید.'}); const c=findClanByUser(u.username); if(!c||!clanCanManage(c,u))return json(res,403,{error:'فقط رهبر یا قائم‌مقام می‌تواند نقش‌ها را تغییر دهد.'}); const target=c.members.find(m=>m.username===String(msg.username||'')); const role=['deputy','veteran','member'].includes(msg.role)?msg.role:null; if(!target||!role)return json(res,400,{error:'عضو یا نقش نامعتبر است.'}); if(target.username===c.leader)return json(res,400,{error:'نقش رهبر قابل تغییر نیست.'}); target.role=role;persist();return json(res,200,{clan:clanView(c)});
      }
      if(req.method==='POST' && url.pathname==='/api/clan/war/start'){
        const u=auth(msg); if(!u)return json(res,401,{error:'ابتدا وارد حساب شوید.'}); const c=findClanByUser(u.username); if(!c||c.leader!==u.username)return json(res,403,{error:'فقط رهبر می‌تواند جنگ کلنی را آغاز کند.'}); clanTouchWar(c); if(c.war)return json(res,409,{error:'کلن شما در حال جنگ است.'}); const pool=clanOpponents(c); if(!pool.length)return json(res,404,{error:'فعلاً کلن دیگری برای جنگ پیدا نشد.'}); const opp=pool[Math.floor(Math.random()*pool.length)]; const now=Date.now(); const war={id:crypto.randomUUID(),opponent:opp.id,startsAt:now,endsAt:now+30*60*1000,score:{[c.id]:0,[opp.id]:0},attacks:{}}; c.war=war; opp.war={...war,opponent:c.id}; persist();return json(res,200,{clan:clanView(c),opponent:clanView(opp)});
      }
      if(req.method==='GET' && url.pathname==='/api/clan/war'){
        const u=auth({username:url.searchParams.get('username'),token:url.searchParams.get('token')}); if(!u)return json(res,401,{error:'نیاز به ورود دارید.'}); const c=findClanByUser(u.username); if(!c)return json(res,404,{error:'عضو کلنی نیستید.'}); clanTouchWar(c); if(!c.war)return json(res,200,{war:null}); const opp=db.clans[c.war.opponent]; return json(res,200,{war:c.war,clan:clanView(c),opponent:opp?clanView(opp):null});
      }
      if(req.method==='POST' && url.pathname==='/api/clan/attack'){
        const u=auth(msg); if(!u)return json(res,401,{error:'ابتدا وارد حساب شوید.'}); const c=findClanByUser(u.username); if(!c||!c.war)return json(res,400,{error:'جنگ فعالی ندارید.'}); clanTouchWar(c); if(!c.war)return json(res,400,{error:'زمان جنگ تمام شده است.'}); const used=c.war.attacks[u.username]||0; if(used>=3)return json(res,409,{error:'هر بازیکن فقط ۳ رقابت دارد.'}); const result=['win','draw','loss'].includes(msg.result)?msg.result:'draw'; c.war.attacks[u.username]=used+1; const pts=result==='win'?1:result==='draw'?0.5:0; c.war.score[c.id]=(c.war.score[c.id]||0)+pts; const opp=db.clans[c.war.opponent]; if(opp?.war){opp.war.attacks[u.username]=used+1;opp.war.score[c.id]=c.war.score[c.id];} c.xp+=(result==='win'?40:result==='draw'?20:10); persist();return json(res,200,{war:c.war,clan:clanView(c)});
      }
      return json(res,404,{error:'Not found'});
    }); return;
  }
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/') filePath = '/index.html';
  const roots = [DIST, ROOT];
  for (const base of roots) {
    const candidate = path.resolve(base, ' .'.trim() + filePath);
    if (candidate.startsWith(path.resolve(base)) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate);
      const type = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.mp3':'audio/mpeg'}[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return fs.createReadStream(candidate).pipe(res);
    }
  }
  return res.writeHead(404).end('Not found');
});

const wss = new WebSocket.Server({ server, path: '/ws' });
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', ws => {
  ws.isAlive = true; ws.room = null; ws.color = null; ws.name = 'PLAYER'; ws.username = ''; ws.__matchReqId = null; ws.__rating = 1200;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  // Informational only. The client never requires this message before sending a request.
  send(ws, { type: 'connected', serverVersion: VERSION });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return send(ws, { type: 'error', message: 'پیام نامعتبر است.' }); }
    const reqId = msg.reqId || null;
    if (msg.type === 'ping') return send(ws, { type: 'pong', reqId });
    if (msg.type === 'matchmake') return matchmake(ws, reqId, msg);
    if (msg.type === 'cancel_matchmake') { removeQueue(ws); return send(ws, { type: 'match_cancelled', reqId }); }
    if (msg.type === 'leave_room') { removeQueue(ws); leaveRoom(ws, true); return send(ws, { type: 'left_room', reqId }); }
    if (msg.type === 'create_room') return createRoom(ws, String(msg.room || '').trim().toUpperCase(), msg.name, msg.username, reqId);
    if (msg.type === 'join_room') return joinRoom(ws, String(msg.room || '').trim().toUpperCase(), msg.name, msg.username, reqId);
    if (msg.type === 'clan_presence') {
      ws.username=String(msg.username||ws.username||'').toLowerCase(); ws.name=cleanName(msg.name,ws.name); return send(ws,{type:'clan_presence',online:true,username:ws.username});
    }
    if (msg.type === 'clan_war_match') {
      const u=db.users[String(ws.username||msg.username||'').toLowerCase()]; const c=u?findClanByUser(u.username):null; if(!c)return send(ws,{type:'error',reqId,message:'ابتدا وارد حساب و کلن شوید.'}); clanTouchWar(c); if(!c.war)return send(ws,{type:'error',reqId,message:'جنگ فعالی وجود ندارد.'});
      const used=c.war.attacks[u.username]||0; if(used>=3)return send(ws,{type:'error',reqId,message:'هر بازیکن فقط ۳ رقابت دارد.'}); const opp=db.clans[c.war.opponent]; if(!opp)return send(ws,{type:'error',reqId,message:'کلن مقابل پیدا نشد.'});
      let target=null; for(const client of wss.clients){if(client===ws||client.readyState!==WebSocket.OPEN||!client.username)continue; const ou=db.users[String(client.username).toLowerCase()]; const oc=ou?findClanByUser(ou.username):null; if(oc&&oc.id===opp.id&&(c.war.attacks[ou.username]||0)<3){target=client;break}}
      if(!target)return send(ws,{type:'error',reqId,message:'فعلاً بازیکن آنلاین و آماده‌ای از کلن مقابل پیدا نشد.'});
      const id=roomCode(); const room={code:id,players:[{ws,color:'w',name:ws.name,username:ws.username},{ws:target,color:'b',name:target.name,username:target.username}],lastMove:null,started:true,clanWar:{a:c.id,b:opp.id}}; rooms.set(id,room); ws.room=id;ws.color='w';target.room=id;target.color='b';
      send(ws,{type:'match_found',reqId,room:id,color:'w',clanWar:true}); send(target,{type:'match_found',room:id,color:'b',clanWar:true}); return broadcast(room,state(room));
    }
    if (msg.type === 'start_game') {
      const room = roomOf(ws);
      if (!room) return send(ws, { type: 'error', reqId, message: 'ابتدا وارد اتاق شوید.' });
      if (room.players.length < 2) return send(ws, { type: 'error', reqId, message: 'برای شروع باید هر دو بازیکن وارد اتاق باشند.' });
      room.started = true; room.lastMove = null;
      broadcast(room, { type: 'game_started', room: room.code });
      return send(ws, { type: 'game_started', reqId, room: room.code });
    }
    if (msg.type === 'clan_chat') {
      const u=db.users[String(ws.username||'').toLowerCase()]; const c=u?findClanByUser(u.username):null; if(!c)return send(ws,{type:'error',reqId,message:'عضو کلنی نیستید.'}); const text=String(msg.text||'').trim().slice(0,180); if(!text)return; for(const client of wss.clients){if(client.readyState!==WebSocket.OPEN||!client.username)continue; const cu=db.users[String(client.username).toLowerCase()]; const cc=cu?findClanByUser(cu.username):null; if(cc?.id===c.id)send(client,{type:'clan_chat',name:ws.name,text,at:Date.now()})} return;
    }
    const room = roomOf(ws);
    if (!room) return send(ws, { type: 'error', reqId, message: 'ابتدا یک اتاق بسازید یا وارد اتاق شوید.' });
    if (msg.type === 'move') {
      if (msg.color !== ws.color) return send(ws, { type: 'error', reqId, message: 'نوبت یا بازیکن نامعتبر است.' });
      room.lastMove = msg.move || null;
      return broadcast(room, { type: 'remote_move', move: room.lastMove, color: ws.color }, ws);
    }
    if (msg.type === 'new_game') { room.lastMove = null; room.started = true; return broadcast(room, { type: 'new_game' }, ws); }
    if (msg.type === 'resign') return broadcast(room, { type: 'resigned', color: ws.color }, ws);
    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 180); if (!text) return;
      return broadcast(room, { type: 'chat', text, name: ws.name, color: ws.color, at: Date.now() });
    }
  });
  ws.on('close', () => { removeQueue(ws); leaveRoom(ws, true); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`TOMTOM CHESS ${VERSION} listening on ${PORT}`));
