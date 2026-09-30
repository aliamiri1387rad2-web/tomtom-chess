'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const accountPanel=$('accountPanel'),rankPanel=$('rankPanel');
 const account={token:localStorage.getItem('tomtom_token')||'',username:localStorage.getItem('tomtom_username')||''};
 const api=path=>`${(typeof serverBase==='function'?serverBase():'https://tomtom-chess.onrender.com')}${path}`;
 function authUser(){return account.token&&account.username?{username:account.username,token:account.token}:null}
 function setAuthMessage(t){$('authMessage').textContent=t}
 function applyUser(u){
   if(!u)return;
   profile={...profile,...u};profile.name=u.name||profile.name;saveProfileData();
   if(typeof window.updateTomtomRankUI==='function') window.updateTomtomRankUI(u.rating);
   $('authState').textContent=`${u.name} • ${u.rating}`;$('authState').classList.add('auth-user');$('authDot').classList.add('connected');
   $('authName').value=u.name||'';$('authUsername').value=u.username||'';
 }
 async function request(path,opts={}){const r=await fetch(api(path),{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({error:'پاسخ نامعتبر'}));if(!r.ok)throw new Error(d.error||'خطا');return d}
 async function register(){try{const d=await request('/api/register',{method:'POST',body:JSON.stringify({name:$('authName').value.trim(),username:$('authUsername').value.trim(),password:$('authPassword').value})});account.token=d.token;account.username=d.user.username;localStorage.setItem('tomtom_token',account.token);localStorage.setItem('tomtom_username',account.username);applyUser(d.user);setAuthMessage('ثبت‌نام با موفقیت انجام شد.')}catch(e){setAuthMessage(e.message)}}
 async function login(){try{const d=await request('/api/login',{method:'POST',body:JSON.stringify({username:$('authUsername').value.trim(),password:$('authPassword').value})});account.token=d.token;account.username=d.user.username;localStorage.setItem('tomtom_token',account.token);localStorage.setItem('tomtom_username',account.username);applyUser(d.user);setAuthMessage('ورود موفق بود.')}catch(e){setAuthMessage(e.message)}}
 function logout(){account.token='';account.username='';localStorage.removeItem('tomtom_token');localStorage.removeItem('tomtom_username');$('authState').textContent='مهمان';$('authState').classList.remove('auth-user');$('authDot').classList.remove('connected');setAuthMessage('از حساب خارج شدید.')}
 const RANKS=[
  {key:'bronze',fa:'برنز',en:'BRONZE',min:0,max:799,range:'0–799'},
  {key:'silver',fa:'نقره‌ای',en:'SILVER',min:800,max:999,range:'800–999'},
  {key:'gold',fa:'طلایی',en:'GOLD',min:1000,max:1199,range:'1000–1199'},
  {key:'platinum',fa:'پلاتینیوم',en:'PLATINUM',min:1200,max:1399,range:'1200–1399'},
  {key:'diamond',fa:'الماس',en:'DIAMOND',min:1400,max:1599,range:'1400–1599'},
  {key:'master',fa:'مستر',en:'MASTER',min:1600,max:1799,range:'1600–1799'},
  {key:'grandmaster',fa:'گرندمستر',en:'GRANDMASTER',min:1800,max:1999,range:'1800–1999'},
  {key:'champion',fa:'قهرمان',en:'CHAMPION',min:2000,max:Infinity,range:'2000+'}
 ];
 function rankOf(rating){const n=Math.max(0,Number(rating)||0);return RANKS.find(r=>n>=r.min&&n<=r.max)||RANKS[0]}
 window.updateTomtomRankUI=function(rating){
   const r=rankOf(rating);
   const hb=$('homeRankBadge'),hn=$('homeRankName');
   if(hb){hb.src='/ranks/'+r.key+'.svg';hb.alt=r.fa}
   if(hn)hn.textContent=r.en;
   const card=$('currentRankCard');
   if(card)card.innerHTML=`<img src="/ranks/${r.key}.svg" alt="${r.fa}"><div class="rank-copy"><b>${r.fa}</b><small>${r.en} • ${r.range} RATING</small></div><div class="rank-rating">${nFmt(rating)}<small>RATING</small></div>`;
 };
 function nFmt(x){return Number(x)||0}
 async function leaderboard(){const box=$('leaderboard');box.innerHTML='<div class="room-message">در حال دریافت…</div>';try{const d=await request('/api/leaderboard');box.innerHTML=d.players.length?d.players.map(p=>{const r=rankOf(p.rating);return `<div class="rank-row"><div class="rank">#${p.rank}</div><img class="rank-logo" src="/ranks/${r.key}.svg" alt="${r.fa}"><div class="who"><b>${escapeHtml(p.name)}</b><small>${r.fa} • ${r.en} • سطح ${p.level} • ${p.wins} برد</small></div><div class="rr">${p.rating}</div></div>`}).join(''):'<div class="room-message">هنوز بازیکنی ثبت نشده است.</div>'}catch(e){box.innerHTML='<div class="room-message">'+escapeHtml(e.message)+'</div>'}}
 async function savedGames(){const box=$('savedGames'),a=authUser();if(!a){box.innerHTML='<div class="room-message">برای دیدن بازی‌ها وارد حساب شوید.</div>';return}try{const d=await request(`/api/games?username=${encodeURIComponent(a.username)}&token=${encodeURIComponent(a.token)}`);box.innerHTML=d.games.length?d.games.map(g=>`<div class="saved-game"><b>${g.result==='win'?'🏆 برد':g.result==='loss'?'باخت':'مساوی'}</b> • ${g.moves.length} حرکت<small>${new Date(g.createdAt).toLocaleString('fa-IR')}</small></div>`).join(''):'<div class="room-message">بازی ذخیره‌شده‌ای ندارید.</div>'}catch(e){box.innerHTML='<div class="room-message">'+escapeHtml(e.message)+'</div>'}}
 function escapeHtml(x){return String(x).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
 async function syncResult(result){const a=authUser();if(!a)return;try{const d=await request('/api/result',{method:'POST',body:JSON.stringify({...a,result})});applyUser(d.user);await request('/api/game',{method:'POST',body:JSON.stringify({...a,game:{players:[a.username],result,moves:moveLog}})});}catch(e){console.warn('online result',e.message)}}
 window.tomtomSyncResult=syncResult;
 function matchmake(){
   const box=$('roomMessage');
   if(window.__tomtomSearching){
     if(typeof sendOnline==='function')sendOnline({type:'cancel_matchmake'});
     window.__tomtomSearching=false;
     box.textContent='⏹ جستجوی حریف متوقف شد.';
     box.classList.remove('match-wait');
     const mm=$('matchmakeBtn');if(mm)mm.textContent='⚡ بازی سریع با حریف تصادفی';
     return;
   }
   window.__tomtomSearching=true;box.textContent='⏳ در حال اتصال و جستجوی حریف…';box.classList.add('match-wait');const mm=$('matchmakeBtn');if(mm)mm.textContent='⏹ توقف جستجو';
   const request=(typeof onlineRequest==='function')?onlineRequest:null;
   if(!request){window.__tomtomSearching=false;box.classList.remove('match-wait');box.textContent='ماژول آنلاین آماده نیست.';return}
   request('matchmake',{name:profile.name,username:account.username||'guest',rating:Number(profile.rating)||1200},120000).then(m=>{
     if(m.type==='match_waiting')box.textContent='⏳ در صف پیدا کردن حریف…';
     if(m.type==='match_found')window.__tomtomSearching=false;
   }).catch(e=>{window.__tomtomSearching=false;box.classList.remove('match-wait');const mm=$('matchmakeBtn');if(mm)mm.textContent='⚡ بازی سریع با حریف تصادفی';box.textContent=e.message||'جستجوی حریف انجام نشد.'});
 }

 // Add identity to room creation/join payloads by wrapping the socket send path is not necessary for gameplay,
 // but the server stores the display name already. Matchmaking uses the current profile directly.
 $('loginBtn').addEventListener('click',()=>{ if(typeof openHomePanelNav==='function') { openHomePanelNav(accountPanel); } else { accountPanel.classList.add('show');accountPanel.setAttribute('aria-hidden','false'); } });
 $('closeAccount').addEventListener('click',()=>{ if(typeof closeCurrentPanel==='function') closeCurrentPanel(); else { accountPanel.classList.remove('show');accountPanel.setAttribute('aria-hidden','true'); } });
 $('registerBtn').addEventListener('click',register);$('loginBtn2').addEventListener('click',login);$('logoutBtn').addEventListener('click',logout);
 $('rankBtn').addEventListener('click',()=>{ if(typeof openHomePanelNav==='function') openHomePanelNav(rankPanel); else { rankPanel.classList.add('show');rankPanel.setAttribute('aria-hidden','false'); } leaderboard();savedGames() });
 $('closeRank').addEventListener('click',()=>{ if(typeof closeCurrentPanel==='function') closeCurrentPanel(); else { rankPanel.classList.remove('show');rankPanel.setAttribute('aria-hidden','true'); } });$('refreshRank').addEventListener('click',()=>{leaderboard();savedGames()});$('matchmakeBtn').addEventListener('click',matchmake);
 if(account.token&&account.username){request('/api/leaderboard').then(()=>request('/api/games?username='+encodeURIComponent(account.username)+'&token='+encodeURIComponent(account.token))).catch(()=>{})}
 if(typeof window.updateTomtomRankUI==='function') window.updateTomtomRankUI(profile.rating);
 window.tomtomAuth=authUser;
})();

// ===== V7 LIVE CHAT =====
(function(){
 const form=document.getElementById('chatForm'), input=document.getElementById('chatInput'), box=document.getElementById('chatMessages'), state=document.getElementById('chatState');
 if(!form)return;
 function addChat(name,text,me=false){
   const empty=box.querySelector('.chat-empty'); if(empty)empty.remove();
   const el=document.createElement('div'); el.className='chat-msg'+(me?' me':'');
   const b=document.createElement('b'); b.textContent=me?'شما':name;
   const span=document.createElement('span'); span.textContent=text;
   el.append(b,span); box.appendChild(el); box.scrollTop=box.scrollHeight;
 }
 form.addEventListener('submit',e=>{e.preventDefault();const text=input.value.trim();if(!text)return;if(!online.ws||online.ws.readyState!==WebSocket.OPEN){state.textContent='آفلاین';return}sendOnline({type:'chat',text});addChat('شما',text,true);input.value='';});
 const timer=setInterval(()=>{ state.textContent=(online.connected?'آنلاین':'آماده'); },700);
 window.addEventListener('beforeunload',()=>clearInterval(timer));
})();


