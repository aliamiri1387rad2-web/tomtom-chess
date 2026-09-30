'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const accountPanel=$('accountPanel'),rankPanel=$('rankPanel');
 const account={token:localStorage.getItem('tomtom_token')||'',username:localStorage.getItem('tomtom_username')||''};
 const api=path=>`${location.origin}${path}`;
 function authUser(){return account.token&&account.username?{username:account.username,token:account.token}:null}
 function setAuthMessage(t){$('authMessage').textContent=t}
 function applyUser(u){
   if(!u)return;
   profile={...profile,...u};profile.name=u.name||profile.name;saveProfileData();
   $('authState').textContent=`${u.name} • ${u.rating}`;$('authState').classList.add('auth-user');$('authDot').classList.add('connected');
   $('authName').value=u.name||'';$('authUsername').value=u.username||'';
 }
 async function request(path,opts={}){const r=await fetch(api(path),{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({error:'پاسخ نامعتبر'}));if(!r.ok)throw new Error(d.error||'خطا');return d}
 async function register(){try{const d=await request('/api/register',{method:'POST',body:JSON.stringify({name:$('authName').value.trim(),username:$('authUsername').value.trim(),password:$('authPassword').value})});account.token=d.token;account.username=d.user.username;localStorage.setItem('tomtom_token',account.token);localStorage.setItem('tomtom_username',account.username);applyUser(d.user);setAuthMessage('ثبت‌نام با موفقیت انجام شد.')}catch(e){setAuthMessage(e.message)}}
 async function login(){try{const d=await request('/api/login',{method:'POST',body:JSON.stringify({username:$('authUsername').value.trim(),password:$('authPassword').value})});account.token=d.token;account.username=d.user.username;localStorage.setItem('tomtom_token',account.token);localStorage.setItem('tomtom_username',account.username);applyUser(d.user);setAuthMessage('ورود موفق بود.')}catch(e){setAuthMessage(e.message)}}
 function logout(){account.token='';account.username='';localStorage.removeItem('tomtom_token');localStorage.removeItem('tomtom_username');$('authState').textContent='مهمان';$('authState').classList.remove('auth-user');$('authDot').classList.remove('connected');setAuthMessage('از حساب خارج شدید.')}
 async function leaderboard(){const box=$('leaderboard');box.innerHTML='<div class="room-message">در حال دریافت…</div>';try{const d=await request('/api/leaderboard');box.innerHTML=d.players.length?d.players.map(p=>`<div class="rank-row"><div class="rank">#${p.rank}</div><div class="who"><b>${escapeHtml(p.name)}</b><small>@${escapeHtml(p.username)} • سطح ${p.level}</small></div><div class="rr">${p.rating}</div></div>`).join(''):'<div class="room-message">هنوز بازیکنی ثبت نشده است.</div>'}catch(e){box.innerHTML='<div class="room-message">'+escapeHtml(e.message)+'</div>'}}
 async function savedGames(){const box=$('savedGames'),a=authUser();if(!a){box.innerHTML='<div class="room-message">برای دیدن بازی‌ها وارد حساب شوید.</div>';return}try{const d=await request(`/api/games?username=${encodeURIComponent(a.username)}&token=${encodeURIComponent(a.token)}`);box.innerHTML=d.games.length?d.games.map(g=>`<div class="saved-game"><b>${g.result==='win'?'🏆 برد':g.result==='loss'?'باخت':'مساوی'}</b> • ${g.moves.length} حرکت<small>${new Date(g.createdAt).toLocaleString('fa-IR')}</small></div>`).join(''):'<div class="room-message">بازی ذخیره‌شده‌ای ندارید.</div>'}catch(e){box.innerHTML='<div class="room-message">'+escapeHtml(e.message)+'</div>'}}
 function escapeHtml(x){return String(x).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
 async function syncResult(result){const a=authUser();if(!a)return;try{const d=await request('/api/result',{method:'POST',body:JSON.stringify({...a,result})});applyUser(d.user);await request('/api/game',{method:'POST',body:JSON.stringify({...a,game:{players:[a.username],result,moves:moveLog}})});}catch(e){console.warn('online result',e.message)}}
 window.tomtomSyncResult=syncResult;
 function matchmake(){
   const ws=connectOnline();if(!ws)return;
   const send=()=>{sendOnline({type:'matchmake',name:profile.name,username:account.username||'guest'});$('roomMessage').textContent='⏳ در صف پیدا کردن حریف…';$('roomMessage').classList.add('match-wait')};
   if(ws.readyState===WebSocket.OPEN)send();else ws.addEventListener('open',send,{once:true});
 }
 // Add identity to room creation/join payloads by wrapping the socket send path is not necessary for gameplay,
 // but the server stores the display name already. Matchmaking uses the current profile directly.
 $('loginBtn').addEventListener('click',()=>{accountPanel.classList.add('show');accountPanel.setAttribute('aria-hidden','false')});
 $('closeAccount').addEventListener('click',()=>{accountPanel.classList.remove('show');accountPanel.setAttribute('aria-hidden','true')});
 $('registerBtn').addEventListener('click',register);$('loginBtn2').addEventListener('click',login);$('logoutBtn').addEventListener('click',logout);
 $('rankBtn').addEventListener('click',()=>{rankPanel.classList.add('show');rankPanel.setAttribute('aria-hidden','false');leaderboard();savedGames()});
 $('closeRank').addEventListener('click',()=>{rankPanel.classList.remove('show');rankPanel.setAttribute('aria-hidden','true')});$('refreshRank').addEventListener('click',()=>{leaderboard();savedGames()});$('matchmakeBtn').addEventListener('click',matchmake);
 if(account.token&&account.username){request('/api/leaderboard').then(()=>request('/api/games?username='+encodeURIComponent(account.username)+'&token='+encodeURIComponent(account.token))).catch(()=>{})}
 window.tomtomAuth=authUser;
})();
