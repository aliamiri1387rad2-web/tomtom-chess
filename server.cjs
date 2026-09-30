'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||8080),ROOT=__dirname,STATIC_ROOT=path.join(ROOT,'dist'),DB_FILE=path.join(ROOT,'tomtom-data.json');
const rooms=new Map(), queue=[];
let db={users:{},games:[]};
try{if(fs.existsSync(DB_FILE)) db={...db,...JSON.parse(fs.readFileSync(DB_FILE,'utf8'))};}catch(e){console.error('DB load:',e.message)}
function persist(){try{fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))}catch(e){console.error('DB save:',e.message)}}
function hash(s){return crypto.createHash('sha256').update(String(s)).digest('hex')}
function token(){return crypto.randomBytes(24).toString('hex')}
function code(){return crypto.randomBytes(3).toString('hex').toUpperCase()}
function validRoomCode(v){return /^[A-Z0-9]{3,8}$/.test(v)}
function send(ws,data){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))}
function broadcast(room,data,except){for(const p of room.players)if(p.ws!==except)send(p.ws,data)}
function safeUser(u){return {username:u.username,name:u.name,rating:u.rating,wins:u.wins,losses:u.losses,draws:u.draws,level:u.level,xp:u.xp}}
function snapshot(room){return {type:'room_state',room:room.code,players:room.players.map(p=>({color:p.color,name:p.name||'PLAYER',username:p.username||''})),started:room.players.length===2}}
function leave(ws){
 for(const [id,room] of rooms){const i=room.players.findIndex(p=>p.ws===ws);if(i<0)continue;room.players.splice(i,1);broadcast(room,{type:'opponent_left'});if(room.players.length===0)rooms.delete(id);else broadcast(room,snapshot(room));break}
 const qi=queue.indexOf(ws);if(qi>=0)queue.splice(qi,1);
}
function authenticate(msg){const u=db.users[msg.username];return u&&u.token===msg.token?u:null}
function httpJson(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
 if(req.method==='GET'&&url.pathname==='/health'){return httpJson(res,200,{ok:true,service:'TOMTOM CHESS',websocket:true,time:new Date().toISOString()})}
 if(url.pathname.startsWith('/api/')){
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   let msg={};try{msg=body?JSON.parse(body):{}}catch{return httpJson(res,400,{error:'JSON نامعتبر'})}
   if(req.method==='POST'&&url.pathname==='/api/register'){
    const username=String(msg.username||'').trim().toLowerCase();const password=String(msg.password||'');const name=String(msg.name||username).trim().slice(0,24);
    if(!/^[a-z0-9_]{3,20}$/.test(username)||password.length<4)return httpJson(res,400,{error:'نام کاربری ۳ تا ۲۰ حرف انگلیسی/عدد و رمز حداقل ۴ کاراکتر باشد.'});
    if(db.users[username])return httpJson(res,409,{error:'این نام کاربری قبلاً ثبت شده است.'});
    const u={username,name,password:hash(password),token:token(),rating:1200,wins:0,losses:0,draws:0,level:1,xp:0};db.users[username]=u;persist();return httpJson(res,200,{user:safeUser(u),token:u.token});
   }
   if(req.method==='POST'&&url.pathname==='/api/login'){
    const username=String(msg.username||'').trim().toLowerCase(),u=db.users[username];
    if(!u||u.password!==hash(String(msg.password||'')))return httpJson(res,401,{error:'نام کاربری یا رمز عبور اشتباه است.'});
    u.token=token();persist();return httpJson(res,200,{user:safeUser(u),token:u.token});
   }
   if(req.method==='GET'&&url.pathname==='/api/leaderboard'){
    const list=Object.values(db.users).sort((a,b)=>b.rating-a.rating).slice(0,50).map((u,i)=>({rank:i+1,...safeUser(u)}));return httpJson(res,200,{players:list});
   }
   if(req.method==='GET'&&url.pathname==='/api/games'){
    const u=authenticate({username:url.searchParams.get('username'),token:url.searchParams.get('token')});if(!u)return httpJson(res,401,{error:'نیاز به ورود دارید.'});
    return httpJson(res,200,{games:db.games.filter(g=>g.players.includes(u.username)).slice(-50).reverse()});
   }
   if(req.method==='POST'&&url.pathname==='/api/game'){
    const u=authenticate(msg);if(!u)return httpJson(res,401,{error:'نیاز به ورود دارید.'});
    const g=msg.game||{};db.games.push({id:crypto.randomUUID(),players:Array.isArray(g.players)?g.players.slice(0,2):[u.username],result:g.result||'draw',moves:Array.isArray(g.moves)?g.moves.slice(0,500):[],createdAt:new Date().toISOString()});if(db.games.length>1000)db.games=db.games.slice(-1000);persist();return httpJson(res,200,{ok:true});
   }
   if(req.method==='POST'&&url.pathname==='/api/result'){
    const u=authenticate(msg);if(!u)return httpJson(res,401,{error:'نیاز به ورود دارید.'});
    const result=msg.result==='win'||msg.result==='loss'||msg.result==='draw'?msg.result:'draw';
    if(result==='win'){u.wins++;u.rating+=12;u.xp+=35}else if(result==='loss'){u.losses++;u.rating=Math.max(100,u.rating-10);u.xp+=8}else{u.draws++;u.xp+=18}
    while(u.xp>=100){u.xp-=100;u.level++}persist();return httpJson(res,200,{user:safeUser(u)});
   }
   return httpJson(res,404,{error:'Not found'});
  });return;
 }
 let reqPath=decodeURIComponent(url.pathname);
 if(reqPath==='/')reqPath='/index.html';
 const safe=path.normalize(reqPath).replace(/^([.][.][\\/])+/,''),baseRoot=fs.existsSync(STATIC_ROOT)?STATIC_ROOT:ROOT,file=path.join(baseRoot,safe);
 if(!file.startsWith(baseRoot)){res.writeHead(403);return res.end('Forbidden')}
 fs.readFile(file,(err,data)=>{
   // Vite puts files from /public into /dist, but the original chess files
   // may also live at the project root. If a requested static file is not
   // in dist, fall back to the project root before returning 404.
   if(err && fs.existsSync(STATIC_ROOT)){
     const rootFile=path.join(ROOT,safe);
     if(rootFile.startsWith(ROOT) && fs.existsSync(rootFile)) {
       return fs.readFile(rootFile,(e,d)=>{
         if(e){res.writeHead(404);return res.end('Not found')}
         const ext=path.extname(rootFile);
         const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
         res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(d)
       })
     }
     if(!path.extname(reqPath) && reqPath!=='/index.html'){
       return fs.readFile(path.join(STATIC_ROOT,'index.html'),(e,d)=>{
         if(e){res.writeHead(404);return res.end('Not found')}
         res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(d)
       })
     }
   }
   if(err){res.writeHead(404);return res.end('Not found')}
   const ext=path.extname(file);
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
   res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)
 })
});
const wss=new WebSocket.Server({server});
server.on('upgrade',(req)=>{console.log('WS upgrade request:',req.url,req.headers.upgrade||'')});
wss.on('connection',(ws,req)=>{console.log('WS connected:',req.url)});
// One in-memory lobby/room registry is safe only while this service has one
// active process/instance. render.yaml pins this service to one instance.
const heartbeat=setInterval(()=>{
 for(const ws of wss.clients){
  if(ws.isAlive===false){try{ws.terminate()}catch(_){};continue}
  ws.isAlive=false;try{ws.ping()}catch(_){ }
 }
},30000);
wss.on('close',()=>clearInterval(heartbeat));
function detachFromRoom(ws){
 const oldId=ws.room;
 if(!oldId)return;
 const old=rooms.get(oldId);
 if(old){
  old.players=old.players.filter(p=>p.ws!==ws);
  if(old.players.length)broadcast(old,snapshot(old));
  else rooms.delete(oldId);
 }
 ws.room=null;ws.color=null;
}
function removeFromQueue(ws){const qi=queue.indexOf(ws);if(qi>=0)queue.splice(qi,1)}
function requestError(ws,reqId,message){send(ws,{type:'error',reqId,message})}
function queueMatchmake(ws,reqId,msg){
 removeFromQueue(ws);detachFromRoom(ws);ws.name=String(msg.name||'PLAYER').slice(0,24);ws.username=String(msg.username||'');
 const other=queue.shift();
 if(other && other.readyState===WebSocket.OPEN){
  const id=code(),room={code:id,players:[],lastMove:null};
  const a={ws:other,color:'w',name:other.name||'PLAYER',username:other.username||''};
  const b={ws,color:'b',name:ws.name||'PLAYER',username:ws.username||''};
  room.players.push(a,b);rooms.set(id,room);other.room=id;other.color='w';ws.room=id;ws.color='b';
  send(other,{type:'match_found',reqId:other.__matchReqId||null,room:id,color:'w'});
  send(ws,{type:'match_found',reqId,room:id,color:'b'});
  broadcast(room,snapshot(room));
 }else{
  if(other && other.readyState!==WebSocket.OPEN)removeFromQueue(other);
  ws.__matchReqId=reqId;queue.push(ws);send(ws,{type:'match_waiting',reqId});
 }
}
wss.on('connection',ws=>{
 ws.isAlive=true;ws.room=null;ws.color=null;ws.name='PLAYER';ws.username='';ws.__matchReqId=null;
 ws.on('pong',()=>{ws.isAlive=true});
 ws.on('error',()=>{});
 send(ws,{type:'connected'});
 ws.on('message',raw=>{
  let msg;try{msg=JSON.parse(raw.toString())}catch(_){return}
  const reqId=msg.reqId||null;
  if(msg.type==='matchmake'){return queueMatchmake(ws,reqId,msg)}
  if(msg.type==='cancel_matchmake'){
   removeFromQueue(ws);ws.__matchReqId=null;send(ws,{type:'match_cancelled',reqId});return;
  }
  if(msg.type==='create_room'){
   removeFromQueue(ws);detachFromRoom(ws);
   let id=String(msg.room||'').trim().toUpperCase();
   if(id&&!validRoomCode(id))return requestError(ws,reqId,'کد اتاق باید ۳ تا ۸ حرف انگلیسی یا عدد باشد.');
   if(!id)id=code();
   if(rooms.has(id))return requestError(ws,reqId,'این کد اتاق قبلاً استفاده شده است. یک کد دیگر وارد کنید.');
   const room={code:id,players:[],lastMove:null};
   const p={ws,color:'w',name:String(msg.name||'PLAYER 1').slice(0,24),username:String(msg.username||'')};
   room.players.push(p);rooms.set(id,room);ws.room=id;ws.color='w';ws.name=p.name;ws.username=p.username;
   send(ws,{type:'room_created',reqId,room:id,color:'w'});send(ws,snapshot(room));return;
  }
  if(msg.type==='join_room'){
   removeFromQueue(ws);
   const id=String(msg.room||'').trim().toUpperCase(),room=rooms.get(id);
   if(!room)return requestError(ws,reqId,'اتاق پیدا نشد. مطمئن شوید کد را دقیق وارد کرده‌اید و صاحب اتاق هنوز آنلاین است.');
   if(room.players.some(p=>p.ws===ws))return requestError(ws,reqId,'این اتصال همین حالا صاحب این اتاق است. برای ورود به اتاق، از دستگاه یا مرورگر دوم استفاده کنید.');
   if(room.players.length>=2)return requestError(ws,reqId,'این اتاق پر است.');
   detachFromRoom(ws);
   const p={ws,color:'b',name:String(msg.name||'PLAYER 2').slice(0,24),username:String(msg.username||'')};
   room.players.push(p);ws.room=id;ws.color='b';ws.name=p.name;ws.username=p.username;
   send(ws,{type:'room_joined',reqId,room:id,color:'b'});broadcast(room,snapshot(room));return;
  }
  const room=rooms.get(ws.room);if(!room)return requestError(ws,reqId,'این اتصال هنوز وارد اتاقی نشده است.');
  if(msg.type==='move'){
   if(msg.color!==ws.color)return requestError(ws,reqId,'بازیکن نامعتبر.');
   room.lastMove=msg.move;broadcast(room,{type:'remote_move',move:msg.move,color:ws.color},ws);
  }else if(msg.type==='new_game'){room.lastMove=null;broadcast(room,{type:'new_game'},ws)}
  else if(msg.type==='resign'){broadcast(room,{type:'resigned',color:ws.color},ws)}
  else if(msg.type==='chat'){const text=String(msg.text||'').trim().slice(0,180);if(!text)return;broadcast(room,{type:'chat',text,name:ws.name||'PLAYER',color:ws.color,at:Date.now()},null)}
  else if(msg.type==='ping')send(ws,{type:'pong',reqId});
 });
 ws.on('close',()=>{removeFromQueue(ws);detachFromRoom(ws)});
});

// A client-side application ping keeps a live queue/session active on platforms
// that may otherwise stop an idle service. This also gives the client a simple
// request/response health signal at the WebSocket layer.
server.listen(PORT,'0.0.0.0',()=>console.log(`TOMTOM CHESS server listening on ${PORT}`));
