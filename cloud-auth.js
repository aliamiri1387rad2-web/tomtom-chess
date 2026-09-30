'use strict';
(function(){
  const cfg=window.TOMTOM_FIREBASE_CONFIG||{};
  const ready=!!cfg.apiKey && !String(cfg.apiKey).startsWith('PASTE_') && !!cfg.projectId;
  const state={enabled:false,app:null,auth:null,db:null,user:null,confirmation:null,recaptcha:null};
  window.tomtomCloudAuth=state;
  function msg(t){const e=document.getElementById('authMessage');if(e)e.textContent=t||'';}
  function valid(){return ready&&window.firebase&&firebase.auth&&firebase.firestore;}
  function safeUser(u){return {uid:u.uid,name:u.displayName||'TOMTOM PLAYER',email:u.email||'',phone:u.phoneNumber||''};}
  async function saveCloudProfile(extra={}){
    if(!state.db||!state.user)return;
    const ref=state.db.collection('users').doc(state.user.uid);
    await ref.set({...extra,...safeUser(state.user),updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
  }
  function applyUser(u){
    if(!u)return;
    state.user=u;
    const name=u.displayName||'TOMTOM PLAYER';
    if(typeof profile!=='undefined'){profile.name=name;try{localStorage.setItem('tomtom_cloud_uid',u.uid)}catch(_){};if(typeof saveProfileData==='function')saveProfileData();}
    const s=document.getElementById('authState'),d=document.getElementById('authDot');
    if(s){s.textContent=`${name} • حساب ابری`;} if(d)d.classList.add('connected');
    const n=document.getElementById('authName');if(n)n.value=name;
    const un=document.getElementById('authUsername');if(un&&u.email)un.value=u.email;
  }
  async function init(){
    if(!valid()){if(!ready)msg('برای Google و شماره موبایل، تنظیمات Firebase هنوز وارد نشده است.');return false;}
    try{
      state.app=firebase.initializeApp(cfg);state.auth=firebase.auth();state.db=firebase.firestore();state.enabled=true;
      state.auth.onAuthStateChanged(async u=>{state.user=u||null;if(u){applyUser(u);try{await saveCloudProfile({name:u.displayName||'TOMTOM PLAYER',rating:profile?.rating||1200,wins:profile?.wins||0,losses:profile?.losses||0,draws:profile?.draws||0,level:profile?.level||1,xp:profile?.xp||0})}catch(e){console.warn('cloud profile',e)}}else{const d=document.getElementById('authDot');if(d)d.classList.remove('connected')}});
      return true;
    }catch(e){console.error(e);msg('راه‌اندازی حساب ابری ناموفق بود.');return false;}
  }
  async function google(){
    if(!state.enabled)return msg('اول تنظیمات Firebase را کامل کنید.');
    try{const p=new firebase.auth.GoogleAuthProvider();const r=await state.auth.signInWithPopup(p);applyUser(r.user);await saveCloudProfile({name:r.user.displayName||'TOMTOM PLAYER'});msg('ورود با Google موفق بود.')}catch(e){msg(e.message||'ورود با Google انجام نشد.');}
  }
  async function startPhone(){
    if(!state.enabled)return msg('اول تنظیمات Firebase را کامل کنید.');
    const phone=(document.getElementById('phoneInput')?.value||'').trim();
    if(!/^\+[1-9]\d{7,14}$/.test(phone))return msg('شماره را با کد کشور وارد کنید؛ مثال: +989121234567');
    try{
      if(!state.recaptcha)state.recaptcha=new firebase.auth.RecaptchaVerifier('phoneRecaptcha',{size:'invisible'});
      state.confirmation=await state.auth.signInWithPhoneNumber(phone,state.recaptcha);msg('کد تأیید پیامک شد. کد را وارد کنید.');
      document.getElementById('phoneCodeWrap')?.classList.add('show');
    }catch(e){console.error(e);msg(e.message||'ارسال کد انجام نشد.');}
  }
  async function verifyPhone(){
    if(!state.confirmation)return msg('ابتدا شماره موبایل را ارسال کنید.');
    const code=(document.getElementById('phoneCode')?.value||'').trim();
    if(!/^\d{6}$/.test(code))return msg('کد تأیید باید ۶ رقمی باشد.');
    try{const r=await state.confirmation.confirm(code);applyUser(r.user);await saveCloudProfile({name:document.getElementById('authName')?.value?.trim()||r.user.displayName||'TOMTOM PLAYER'});msg('ورود با شماره موبایل موفق بود.')}catch(e){msg(e.message||'کد تأیید نادرست است.');}
  }
  async function logout(){if(state.auth)await state.auth.signOut();state.user=null;try{localStorage.removeItem('tomtom_cloud_uid')}catch(_){}msg('از حساب ابری خارج شدید.');}
  async function syncResult(result){
    if(!state.db||!state.user)return;
    try{
      const ref=state.db.collection('users').doc(state.user.uid);const snap=await ref.get();const old=snap.exists?snap.data():{};
      const rating=Math.max(100,Number(old.rating??profile.rating??1200)+(result==='win'?12:result==='loss'?-10:0));
      const data={name:profile.name,rating,wins:Number(old.wins||0)+(result==='win'?1:0),losses:Number(old.losses||0)+(result==='loss'?1:0),draws:Number(old.draws||0)+(result==='draw'?1:0),level:Number(old.level||1),xp:Number(old.xp||0)+(result==='win'?35:result==='loss'?8:18),updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
      while(data.xp>=100){data.xp-=100;data.level++;}
      await ref.set(data,{merge:true});
    }catch(e){console.warn('cloud result',e)}
  }
  state.init=init;state.google=google;state.startPhone=startPhone;state.verifyPhone=verifyPhone;state.logout=logout;state.syncResult=syncResult;
  document.addEventListener('DOMContentLoaded',()=>{init();document.getElementById('googleLoginBtn')?.addEventListener('click',google);document.getElementById('phoneSendBtn')?.addEventListener('click',startPhone);document.getElementById('phoneVerifyBtn')?.addEventListener('click',verifyPhone);document.getElementById('cloudLogoutBtn')?.addEventListener('click',logout);});
})();
