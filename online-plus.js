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
   $('authState').textContent=`${u.name} • ${u.rating}`;$('authState').classList.add('auth-user');$('authDot').classList.add('connected');
   $('authName').value=u.name||'';$('authUsername').value=u.username||'';
 }
 async function request(path,opts={}){const r=await fetch(api(path),{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({error:'پاسخ نامعتبر'}));if(!r.ok)throw new Error(d.error||'خطا');return d}
 async function register(){try{const d=await request('/api/register',{method:'POST',body:JSON.stringify({name:$('authName').value.trim(),username:$('authUsername').value.trim(),password:$('authPassword').value})});account.token=d.token;account.username=d.user.username;localStorage.setItem('tomtom_token',account.token);localStorage.setItem('tomtom_username',account.username);applyUser(d.user);setAuthMessage('ثبت‌نام با موفقیت انجام شد.')}catch(e){setAuthMessage(e.message)}}
 async function login(){try{const d=await request('/api/login',{method:'POST',body:JSON.stringify({username:$('authUsername').value.trim(),password:$('authPassword').value})});account.token=d.token;account.username=d.user.username;localStorage.setItem('tomtom_token',account.token);localStorage.setItem('tomtom_username',account.username);applyUser(d.user);setAuthMessage('ورود موفق بود.')}catch(e){setAuthMessage(e.message)}}
 function logout(){account.token='';account.username='';localStorage.removeItem('tomtom_token');localStorage.removeItem('tomtom_username');$('authState').textContent='مهمان';$('authState').classList.remove('auth-user');$('authDot').classList.remove('connected');setAuthMessage('از حساب خارج شدید.')}
 async function leaderboard(){const box=$('leaderboard');box.innerHTML='<div class="room-message">در حال دریافت…</div>';try{const d=await request('/api/leaderboard');box.innerHTML=d.players.length?d.players.map(p=>`<div class="rank-row"><div class="rank">#${p.rank}</div><div class="who"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.league?.name||'طلایی')} • سطح ${p.level} • ${p.wins} برد</small></div><div class="rr">${p.rating}</div></div>`).join(''):'<div class="room-message">هنوز بازیکنی ثبت نشده است.</div>'}catch(e){box.innerHTML='<div class="room-message">'+escapeHtml(e.message)+'</div>'}}
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

// ===== V8 CLANS / CLAN CHAT / CLAN WARS =====
(function(){
 const $=id=>document.getElementById(id);
 const clanPanel=$('clanPanel'), clanBody=$('clanBody'), clanChatPanel=$('clanChatPanel');
 const api=path=>`${(typeof serverBase==='function'?serverBase():'https://tomtom-chess.onrender.com')}${path}`;
 const auth=()=>window.tomtomAuth?window.tomtomAuth():null;
 async function req(path,opts={}){const r=await fetch(api(path),{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({error:'پاسخ نامعتبر'}));if(!r.ok)throw new Error(d.error||'خطا');return d}
 function esc(x){return String(x).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
 function roleLabel(r){return {leader:'👑 رهبر',deputy:'🛡️ قائم‌مقام',veteran:'⭐ پیشکسوت',member:'🌱 تازه‌وارد'}[r]||'🌱 تازه‌وارد'}
 function openClan(){if(typeof openHomePanelNav==='function')openHomePanelNav(clanPanel); else {clanPanel.classList.add('show');clanPanel.setAttribute('aria-hidden','false')} loadClan()}
 async function loadClan(){const a=auth();if(!a){clanBody.innerHTML='<div class="room-message">برای استفاده از کلن‌ها ابتدا وارد حساب شوید.</div>';return}try{const d=await req(`/api/clan?username=${encodeURIComponent(a.username)}&token=${encodeURIComponent(a.token)}`);renderClan(d.clan)}catch(e){clanBody.innerHTML='<div class="room-message">'+esc(e.message)+'</div>'}}
 function renderClan(c){
   if(!c){clanBody.innerHTML=`<div class="clan-create-box"><h3>ساخت یا پیدا کردن کلن</h3><p>ساخت کلن از لیگ طلایی (ریتینگ ۱۲۰۰) فعال می‌شود.</p><div class="clan-form"><input id="clanNameInput" class="text-input" placeholder="نام کلن"><input id="clanTagInput" class="text-input" maxlength="6" placeholder="TAG"><select id="clanBadgeInput" class="text-input"><option>♜</option><option>♞</option><option>♛</option><option>⚔️</option><option>🐺</option><option>🦅</option><option>🔥</option><option>👑</option></select><button id="createClanBtn" class="primary-btn">🏰 ساخت کلن</button></div><hr class="panel-sep"><div class="clan-search"><input id="clanSearchInput" class="text-input" placeholder="جستجوی نام یا تگ کلن"><button id="searchClanBtn" class="secondary-btn">جستجو</button></div><div id="clanSearchResults"></div></div>`; $('createClanBtn').onclick=createClan;$('searchClanBtn').onclick=searchClans;return}
   const me=auth()?.username||''; const meObj=(c.members||[]).find(x=>x.username===me); const canManage=meObj&&(meObj.role==='leader'||meObj.role==='deputy'); const memberRows=(c.members||[]).map(m=>`<div class="clan-member"><span class="presence ${m.online?'on':''}"></span><div><b>${esc(m.name||m.username)}</b><small>${roleLabel(m.role)} • ${m.attacks||0}/3 حمله</small></div>${canManage&&m.username!==c.leader?`<select class="clan-role-select" data-user="${esc(m.username)}"><option value="member" ${m.role==='member'?'selected':''}>تازه‌وارد</option><option value="veteran" ${m.role==='veteran'?'selected':''}>پیشکسوت</option><option value="deputy" ${m.role==='deputy'?'selected':''}>قائم‌مقام</option></select>`:(m.username===c.leader?'👑':'')}</div>`).join('');
   const war=c.war; const warBox=war?`<div class="clan-war-box"><b>⚔️ جنگ کلن فعال</b><p>مقابل: <b>${esc(war.opponent||'کلن مقابل')}</b></p><div class="war-score">امتیاز شما: ${war.score?.[c.id]||0}</div><button id="findWarOpponent" class="primary-btn">⚔️ پیدا کردن حریف آنلاین</button><button id="openClanChat" class="secondary-btn">💬 چت کلن</button></div>`:`<div class="clan-war-box"><b>⚔️ جنگ کلن</b><p>هر جنگ ۳۰ دقیقه است و هر عضو حداکثر ۳ رقابت دارد.</p><button id="startClanWar" class="primary-btn">⚔️ شروع جنگ تصادفی</button><button id="openClanChat" class="secondary-btn">💬 چت کلن</button></div>`;
   clanBody.innerHTML=`<div class="clan-header"><div class="clan-badge">${esc(c.badge)}</div><div><h3>${esc(c.name)} <small>[${esc(c.tag)}]</small></h3><p>سطح ${c.level} • XP ${c.xp}/${c.nextXp} • ${c.memberCount}/50 عضو</p></div></div>${warBox}<div class="clan-members-head"><b>اعضا</b><small>🟢 آنلاین • 🔴 آفلاین</small></div><div class="clan-members">${memberRows}</div>`;
   $('openClanChat').onclick=openClanChat;if($('startClanWar'))$('startClanWar').onclick=startWar;if($('findWarOpponent'))$('findWarOpponent').onclick=findWarOpponent;document.querySelectorAll('.clan-role-select').forEach(x=>x.onchange=()=>changeRole(x.dataset.user,x.value));
 }
 async function createClan(){const a=auth();try{const d=await req('/api/clan/create',{method:'POST',body:JSON.stringify({...a,name:$('clanNameInput').value,tag:$('clanTagInput').value,badge:$('clanBadgeInput').value})});renderClan(d.clan)}catch(e){alert(e.message)}}
 async function searchClans(){const q=$('clanSearchInput').value.trim();const box=$('clanSearchResults');try{const d=await req('/api/clan/search?q='+encodeURIComponent(q));box.innerHTML=d.clans.length?d.clans.map(c=>`<div class="clan-search-row"><div><b>${esc(c.badge)} ${esc(c.name)}</b><small>[${esc(c.tag)}] • سطح ${c.level} • ${c.memberCount}/50</small></div><button class="secondary-btn join-clan-btn" data-id="${c.id}">عضویت</button></div>`).join(''):'<div class="room-message">کلنی پیدا نشد.</div>';box.querySelectorAll('.join-clan-btn').forEach(b=>b.onclick=()=>joinClan(b.dataset.id))}catch(e){box.textContent=e.message}}
 async function changeRole(username,role){const a=auth();try{const d=await req('/api/clan/role',{method:'POST',body:JSON.stringify({...a,username,role})});renderClan(d.clan)}catch(e){alert(e.message)}}
 async function joinClan(id){const a=auth();try{const d=await req('/api/clan/join',{method:'POST',body:JSON.stringify({...a,clanId:id})});renderClan(d.clan)}catch(e){alert(e.message)}}
 async function startWar(){const a=auth();try{const d=await req('/api/clan/war/start',{method:'POST',body:JSON.stringify(a)});renderClan(d.clan);alert('جنگ کلن شروع شد؛ ۳۰ دقیقه فرصت دارید.')}catch(e){alert(e.message)}}
 async function findWarOpponent(){if(typeof onlineRequest!=='function'){alert('اتصال آنلاین آماده نیست.');return}try{await onlineRequest('clan_war_match',{username:auth()?.username},15000)}catch(e){alert(e.message)}}
 function openClanChat(){if(typeof openHomePanelNav==='function')openHomePanelNav(clanChatPanel);else {clanChatPanel.classList.add('show');clanChatPanel.setAttribute('aria-hidden','false')}}
 const form=$('clanChatForm');if(form)form.addEventListener('submit',e=>{e.preventDefault();const input=$('clanChatInput'),t=input.value.trim();if(!t)return;if(typeof sendOnline==='function'&&sendOnline({type:'clan_chat',text:t})){addClanChat('شما',t,true);input.value=''}});
 function addClanChat(name,text,me=false){const box=$('clanChatMessages');if(!box)return;box.querySelector('.chat-empty')?.remove();const el=document.createElement('div');el.className='chat-msg'+(me?' me':'');el.innerHTML='<b>'+esc(me?'شما':name)+'</b><span>'+esc(text)+'</span>';box.appendChild(el);box.scrollTop=box.scrollHeight}
 window.tomtomClanChat=addClanChat; window.tomtomLoadClan=loadClan;
 $('homeClanBtn')?.addEventListener('click',openClan);$('closeClan')?.addEventListener('click',()=>typeof closeCurrentPanel==='function'&&closeCurrentPanel());$('closeClanChat')?.addEventListener('click',()=>typeof closeCurrentPanel==='function'&&closeCurrentPanel());
 setInterval(()=>{if(clanPanel?.classList.contains('show'))loadClan()},15000);
})();

(function(){
 const api=path=>`${(typeof serverBase==='function'?serverBase():'https://tomtom-chess.onrender.com')}${path}`;
 window.tomtomClanResult=async function(result){
   const a=window.tomtomAuth?window.tomtomAuth():null;if(!a)return;
   try{await fetch(api('/api/clan/attack'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...a,result})});if(window.tomtomLoadClan)window.tomtomLoadClan()}catch(e){console.warn('clan attack',e.message)}
 };
 document.querySelectorAll('.emoji-row button').forEach(btn=>btn.addEventListener('click',()=>{const row=btn.parentElement,target=document.getElementById(row.dataset.target);if(target){target.value+=btn.textContent;target.focus()}}));
})();
