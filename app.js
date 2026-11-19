// Preschool Runs — installable phone app (Supabase)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ───────────────────────── helpers ───────────────────────── */
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const [k,v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()){
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}
const $app = document.getElementById('app');
const pad = n => String(n).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fromIso = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay()+6)%7)); };
const todayIso = () => iso(new Date());
function isoWeek(d){ const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-day); const y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil(((t-y0)/864e5+1)/7); }
const fmtDay = s => fromIso(s).toLocaleDateString('en-GB',{weekday:'short', day:'numeric', month:'short'});
const fmtLong = s => fromIso(s).toLocaleDateString('en-GB',{weekday:'long', day:'numeric', month:'long'});
function ago(ts){ const s=(Date.now()-ts)/1000; if (s<60) return 'just now'; if (s<3600) return Math.floor(s/60)+' min ago'; if (s<86400) return Math.floor(s/3600)+' h ago'; const d=new Date(ts); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ls = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} } };

let toastTimer;
function toast(msg){
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const t = h('div',{class:'toast'}, msg); document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.remove(), 3500);
}
function closeSheet(){ document.getElementById('layer').replaceChildren(); }
function sheet(...content){
  const bg = h('div',{class:'sheet-bg', onclick:e=>{ if (e.target===bg) closeSheet(); }},
    h('div',{class:'sheet'}, h('div',{class:'grab'}), ...content));
  document.getElementById('layer').replaceChildren(bg);
}
async function copy(text, msg){
  try{ await navigator.clipboard.writeText(text); toast(msg || 'Copied'); }
  catch(e){ toast('Couldn’t copy — press and hold the text to copy it'); }
}

/* ───────────────────────── connect ───────────────────────── */
const CONF = self.APP_CONFIG || {};
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const sb = createClient(CONF.supabaseUrl, CONF.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; render(); });
window.addEventListener('appinstalled', () => { installPrompt = null; render(); });

/* ───────────────────────── state ───────────────────────── */
const COLORS = ['#E07A5F','#3D8BB8','#5E9E7E','#9B6FB0','#D99A2B','#D16BA5'];
const KIND = { drop:{label:'Drop-off', icon:'🌅', verb:'dropped off'}, pick:{label:'Pick-up', icon:'🏡', verb:'picked up'} };
const DEFAULT_CONFIG = { child:'', preschool:'', dropTime:'08:00', pickTime:'16:00', duration:30,
  template:'Hi! {child} will be {verb} by {name} on {day}.' };
const S = {
  uid:null, email:null, phase:'loading', // loading | auth | verify | denied | app
  members:{}, membersLoaded:false, slots:{}, events:[], config:{}, priv:null, privLoaded:false, pushOn:false,
  weekStart: monday(new Date()), tab: location.hash === '#activity' ? 'activity' : 'week',
  startedAt: Date.now(), lastSeenShown:null, channel:null,
};
const cfg = () => {
  const c = S.config || {};
  return { ...DEFAULT_CONFIG,
    ...(c.child != null ? {child:c.child} : {}), ...(c.preschool != null ? {preschool:c.preschool} : {}),
    ...(c.drop_time ? {dropTime:c.drop_time} : {}), ...(c.pick_time ? {pickTime:c.pick_time} : {}),
    ...(c.duration ? {duration:c.duration} : {}), ...(c.template ? {template:c.template} : {}) };
};
const member = id => S.members[id] || null;
const realName = id => member(id)?.name || 'Someone';
const nameOf = id => id === S.uid ? 'You' : realName(id);
const colorOf = id => member(id)?.color || '#8A8594';
const childName = () => cfg().child || 'our little one';
const slotTime = kind => kind === 'drop' ? cfg().dropTime : cfg().pickTime;
function avatar(id, size){
  const n = realName(id);
  return h('span',{class:'dot', style:`background:${colorOf(id)};${size?`width:${size}px;height:${size}px`:''}`}, (n[0]||'?').toUpperCase());
}

/* ───────────────────────── auth ───────────────────────── */
let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY'){ setTimeout(openNewPassword, 300); }
  setTimeout(() => onSession(session), 0);
});
async function onSession(session){
  const user = session?.user;
  if (!user){ stopData(); S.uid = null; S.phase = S.phase === 'verify' ? 'verify' : 'auth'; return render(); }
  if (S.uid === user.id && started) return;
  S.uid = user.id; S.email = user.email;
  const { data: ok, error } = await sb.rpc('is_family');
  if (error){ console.warn(error); }
  if (ok === false){ S.phase = 'denied'; return render(); }
  S.phase = 'app'; render(); startData();
}
async function doSignOut(){
  try{ const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if (sub) await sb.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); }catch(e){}
  await sb.auth.signOut(); S.phase = 'auth'; render();
}
function authErr(e){
  const m = (e?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Wrong email or password.';
  if (m.includes('email not confirmed')) return 'Confirm your email first — tap the link we sent you.';
  if (m.includes('already registered')) return 'That email already has an account — sign in instead.';
  if (m.includes('password should be') || m.includes('at least')) return 'Use at least 6 characters.';
  if (m.includes('rate limit') || m.includes('security purposes')) return 'Too many tries. Wait a few minutes and try again.';
  if (m.includes('invalid') && m.includes('email')) return 'That email doesn’t look right.';
  if (m.includes('fetch') || m.includes('network')) return 'No internet connection.';
  return e?.message || 'Something went wrong. Try again.';
}
function authView(){
  let mode = 'signin';
  const email = h('input',{type:'email', autocomplete:'email', placeholder:'Email', inputmode:'email', value:S.email||''});
  const pw = h('input',{type:'password', autocomplete:'current-password', placeholder:'Password'});
  const err = h('div',{class:'err'});
  const go = h('button',{class:'btn'}, 'Sign in');
  const seg = h('div',{class:'seg'});
  const drawSeg = () => {
    seg.replaceChildren(
      h('button',{class: mode==='signin'?'on':'', onclick:()=>{ mode='signin'; drawSeg(); }}, 'Sign in'),
      h('button',{class: mode==='create'?'on':'', onclick:()=>{ mode='create'; drawSeg(); }}, 'Create account'));
    go.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    pw.setAttribute('autocomplete', mode === 'signin' ? 'current-password' : 'new-password');
    pw.placeholder = mode === 'signin' ? 'Password' : 'Choose a password (6+ characters)';
    err.textContent = '';
  };
  drawSeg();
  go.addEventListener('click', async () => {
    err.textContent = ''; go.disabled = true;
    const em = email.value.trim().toLowerCase();
    try{
      if (mode === 'signin'){
        const { error } = await sb.auth.signInWithPassword({ email: em, password: pw.value }); if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email: em, password: pw.value, options: { emailRedirectTo: APP_URL } });
        if (error) throw error;
        S.email = em;
        if (!data.session){ S.phase = 'verify'; render(); }
      }
    }catch(e){ err.textContent = authErr(e); }
    go.disabled = false;
  });
  const forgot = h('button',{class:'linkbtn', style:'font-size:13px;margin-top:12px', onclick: async ()=>{
    const em = email.value.trim().toLowerCase();
    if (!em){ err.textContent = 'Type your email first.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: APP_URL });
    if (error) err.textContent = authErr(error); else toast('Check your email for a reset link');
  }}, 'Forgot password?');
  return [h('div',{class:'auth'},
    h('img',{src:'icons/icon-192.png', alt:''}), h('h1',null,'Preschool Runs'),
    h('p',{class:'sub'},'Drop-offs and pick-ups for the whole family'),
    h('div',{class:'card'}, seg,
      h('div',{class:'field'}, email), h('div',{class:'field'}, pw), err, go,
      h('div',{style:'text-align:center'}, forgot)))];
}
function verifyView(){
  const err = h('div',{class:'err'});
  return [h('div',{class:'auth'},
    h('img',{src:'icons/icon-192.png', alt:''}), h('h1',null,'Check your email'),
    h('div',{class:'card'},
      h('p',{style:'margin-top:0;font-size:15px;line-height:1.45'}, 'We sent a link to ', h('b',null,S.email||'your email'), '. Tap it to confirm it’s you, then come back here and sign in.'),
      h('div',{class:'hint', style:'margin:0 0 14px'}, 'Can’t find it? Look in Spam / Junk. It comes from Supabase Auth.'),
      err,
      h('button',{class:'btn', onclick:()=>{ S.phase = 'auth'; render(); }}, 'I’ve confirmed — sign in'),
      h('button',{class:'btn ghost', onclick: async ()=>{
        const { error } = await sb.auth.resend({ type:'signup', email:S.email, options:{ emailRedirectTo: APP_URL } });
        if (error) err.textContent = authErr(error); else toast('Sent again');
      }}, 'Send the email again')))];
}
function deniedView(){
  return [h('div',{class:'auth'},
    h('img',{src:'icons/icon-192.png', alt:''}), h('h1',null,'Not on the family list'),
    h('div',{class:'card'},
      h('p',{style:'margin-top:0;font-size:15px;line-height:1.45'}, h('b',null,S.email), ' isn’t one of the family emails allowed in this app. Ask whoever set it up to add it.'),
      h('button',{class:'btn ghost', onclick:doSignOut}, 'Sign out')))];
}
function openNewPassword(){
  const pw = h('input',{type:'password', autocomplete:'new-password', placeholder:'New password (6+ characters)'});
  sheet(h('h2',null,'Choose a new password'), h('div',{class:'field'}, pw),
    h('button',{class:'btn', onclick: async ()=>{
      const { error } = await sb.auth.updateUser({ password: pw.value });
      if (error) toast(authErr(error)); else { closeSheet(); toast('Password changed'); }
    }}, 'Save'));
}

/* ───────────────────────── live data ───────────────────────── */
const evFrom = r => ({ type:r.type, date:r.date, kind:r.kind, userId:r.user_id, prevUserId:r.prev_user_id, at:Number(r.at) });
async function loadConfig(){ const { data } = await sb.from('config').select('*').eq('id',1).maybeSingle(); if (data) S.config = data; render(); }
async function loadMembers(){
  const { data, error } = await sb.from('members').select('user_id,name,color'); if (error) return;
  const m = {}; for (const r of data) m[r.user_id] = { name:String(r.name), color:String(r.color||'#8A8594') };
  S.members = m; S.membersLoaded = true; maybeOnboard(); render();
}
async function loadSlots(){
  const { data, error } = await sb.from('slots').select('date,kind,user_id,at').gte('date', iso(addDays(new Date(), -45))); if (error) return;
  const s = {}; for (const r of data) s[`${r.date}_${r.kind}`] = { userId:r.user_id, date:r.date, kind:r.kind, at:Number(r.at) };
  S.slots = s; render();
}
async function loadEvents(){
  const { data, error } = await sb.from('events').select('type,date,kind,user_id,prev_user_id,at').order('at', { ascending:false }).limit(80);
  if (!error){ S.events = data.map(evFrom); render(); }
}
async function loadPriv(){
  const { data } = await sb.from('user_state').select('last_seen,cal_token').eq('user_id', S.uid).maybeSingle();
  S.priv = data ? { ...data, last_seen: data.last_seen == null ? null : Number(data.last_seen) } : {};
  if (!S.privLoaded){
    S.privLoaded = true;
    if (S.lastSeenShown == null) S.lastSeenShown = S.priv.last_seen ?? Date.now();
    if (!data) { await sb.rpc('mark_seen'); return loadPriv(); }
    if (S.tab === 'activity') openActivity();
  }
  render();
}
async function loadAll(){ await Promise.all([loadConfig(), loadMembers(), loadSlots(), loadEvents(), loadPriv()]); }
function stopData(){ if (S.channel){ sb.removeChannel(S.channel); S.channel = null; } started = false; }
function startData(){
  if (started) return; started = true;
  loadAll(); refreshPushState();
  const t = {};
  const later = (k, fn) => { clearTimeout(t[k]); t[k] = setTimeout(fn, 250); };
  S.channel = sb.channel('family')
    .on('postgres_changes', { event:'*', schema:'public', table:'slots' }, () => later('s', loadSlots))
    .on('postgres_changes', { event:'*', schema:'public', table:'members' }, () => later('m', loadMembers))
    .on('postgres_changes', { event:'*', schema:'public', table:'config' }, () => later('c', loadConfig))
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'events' }, p => {
      const e = evFrom(p.new || {});
      if (e.userId && e.userId !== S.uid && document.visibilityState === 'visible')
        toast(`🔔 ${realName(e.userId)} ${e.type==='cancelled'?'cancelled':'booked'} ${KIND[e.kind]?.label.toLowerCase()} on ${fmtDay(e.date)}`);
      later('e', loadEvents);
    })
    .subscribe();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.phase === 'app'){ S.startedAt = Date.now(); loadAll(); }
});
window.addEventListener('hashchange', () => { if (location.hash === '#activity'){ S.tab = 'activity'; openActivity(); } });
function unseen(){
  const last = S.priv?.last_seen;
  if (last == null) return [];
  return S.events.filter(e => e.at > last && e.userId !== S.uid);
}
function openActivity(){
  S.lastSeenShown = S.priv?.last_seen ?? S.lastSeenShown;
  if (S.uid && S.privLoaded) sb.rpc('mark_seen').then(loadPriv);
  render();
}

/* ───────────────────────── bookings ───────────────────────── */
function writeFailed(e){
  console.warn(e);
  const m = (e?.message || '').toLowerCase();
  if (m.includes('not allowed') || e?.code === '42501') toast('Not allowed — is your email on the family list?');
  else if (m.includes('fetch') || m.includes('network')) toast('You seem to be offline — try again when you have signal');
  else toast('Couldn’t save — try again');
}
async function book(date, kind, takeover){
  const { data, error } = await sb.rpc('book_slot', { p_date: date, p_kind: kind, p_takeover: !!takeover });
  if (error) return writeFailed(error);
  await Promise.all([loadSlots(), loadEvents()]);
  if (data === 'ok') openMine(date, kind, true);
  else if (data === 'past') toast('That day has passed');
  else if (String(data).startsWith('taken:')) toast(`${realName(String(data).slice(6))} just took this one`);
}
async function cancel(date, kind){
  const { data, error } = await sb.rpc('cancel_slot', { p_date: date, p_kind: kind });
  if (error) return writeFailed(error);
  closeSheet(); await Promise.all([loadSlots(), loadEvents()]);
  toast(data === 'ok' ? 'Cancelled — the family has been notified' : 'This booking isn’t yours any more');
}

/* ───────────────────────── preschool text ───────────────────────── */
function preschoolMsg(date, kind, uid){
  return cfg().template
    .replaceAll('{child}', childName()).replaceAll('{verb}', KIND[kind].verb)
    .replaceAll('{name}', realName(uid)).replaceAll('{day}', fmtLong(date)).replaceAll('{time}', slotTime(kind));
}
function weekSummary(){
  const lines = [`${childName()} – week ${isoWeek(S.weekStart)}`];
  for (let i=0;i<5;i++){
    const d = iso(addDays(S.weekStart,i));
    const dr = S.slots[`${d}_drop`]?.userId, pk = S.slots[`${d}_pick`]?.userId;
    lines.push(`${fmtDay(d)}: drop-off ${dr?realName(dr):'—'}, pick-up ${pk?realName(pk):'—'}`);
  }
  return lines.join('\n');
}

/* ───────────────────────── notifications ───────────────────────── */
function b64ToBytes(s){ const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
const notifState = () => {
  if (!('Notification' in window) || !('PushManager' in window)) return isIOS && !standalone() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return S.pushOn ? 'on' : 'off';
};
async function refreshPushState(){
  try{
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted'){ S.pushOn = false; return render(); }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub){ const j = sub.toJSON(); await sb.rpc('save_push_subscription', { p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth }); }
    S.pushOn = !!sub; render();
  }catch(e){ console.warn('push state', e); }
}
async function enableNotifications(){
  if (isIOS && !standalone()) return showInstallHelp('Notifications on iPhone only work once the app is on your Home Screen.');
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser can’t show notifications');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Notifications are blocked — allow them in your phone’s settings');
  try{
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64ToBytes(CONF.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth });
    if (error) throw error;
    S.pushOn = true; closeSheet(); toast('🔔 Notifications are on for this phone'); render();
  }catch(e){ console.warn('push', e); toast('Couldn’t turn on notifications — try again'); }
}

/* ───────────────────────── calendar feed ───────────────────────── */
async function ensureCalToken(){
  if (S.priv?.cal_token) return S.priv.cal_token;
  const { data, error } = await sb.rpc('ensure_cal_token'); if (error) throw error;
  S.priv = { ...(S.priv||{}), cal_token: data }; return data;
}
async function openCalendar(){
  let token;
  try{ token = await ensureCalToken(); }catch(e){ return writeFailed(e); }
  let scope = 'mine';
  const body = h('div');
  const draw = () => {
    const https = `${CONF.supabaseUrl}/functions/v1/cal/${S.uid}/${token}/${scope}.ics`;
    const webcal = https.replace(/^https?:/, 'webcal:');
    const name = scope === 'mine' ? 'My preschool runs' : 'Preschool runs (family)';
    body.replaceChildren(
      h('div',{class:'seg'},
        h('button',{class: scope==='mine'?'on':'', onclick:()=>{ scope='mine'; draw(); }}, 'Only my runs'),
        h('button',{class: scope==='family'?'on':'', onclick:()=>{ scope='family'; draw(); }}, 'Whole family plan')),
      h('a',{class:'btn', href:webcal}, '📅 Add to iPhone / Apple Calendar'),
      h('a',{class:'btn ghost', href:'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal), target:'_blank', rel:'noopener'}, '📅 Add to Google Calendar'),
      h('a',{class:'btn ghost', href:'https://outlook.office.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + encodeURIComponent(name), target:'_blank', rel:'noopener'}, '📅 Add to Outlook (work / Microsoft 365)'),
      h('a',{class:'btn ghost', href:'https://outlook.live.com/calendar/0/addfromweb?url=' + encodeURIComponent(https) + '&name=' + encodeURIComponent(name), target:'_blank', rel:'noopener'}, '📅 Add to Outlook.com (personal)'),
      h('button',{class:'btn ghost', onclick:()=>copy(https, 'Calendar link copied')}, '🔗 Copy calendar link'),
      h('div',{class:'hint', style:'margin-top:12px'},
        'Do this once. New bookings appear and cancelled ones disappear on their own. iPhone checks for changes about every hour; Google Calendar can take several hours. ',
        'On Android, if the Google button doesn’t work, tap Copy, then on calendar.google.com choose Other calendars ＋ → From URL. Keep this link private.')
    );
  };
  draw();
  sheet(h('h2',null,'Show runs in your calendar'), h('p',{class:'sub'},'Subscribe once and your bookings stay in sync.'), body,
    h('div',{style:'height:10px'}), h('button',{class:'btn ghost', onclick:closeSheet}, 'Close'));
}

/* ───────────────────────── install ───────────────────────── */
function showInstallHelp(lead){
  sheet(h('h2',null,'Put the app on your Home Screen'),
    lead ? h('p',{class:'sub'}, lead) : null,
    isIOS
      ? h('ol',{class:'steps'}, h('li',null,'Open this page in ', h('b',null,'Safari'), '.'), h('li',null,'Tap the ', h('b',null,'Share'), ' button (square with an arrow ⬆).'), h('li',null,'Choose ', h('b',null,'Add to Home Screen'), ', then ', h('b',null,'Add'), '.'), h('li',null,'Open Preschool Runs from the new icon and sign in again.'))
      : h('ol',{class:'steps'}, h('li',null,'Open this page in ', h('b',null,'Chrome'), '.'), h('li',null,'Tap the ', h('b',null,'⋮'), ' menu.'), h('li',null,'Choose ', h('b',null,'Install app'), ' (or ', h('b',null,'Add to Home screen'), ').')),
    installPrompt ? h('button',{class:'btn', onclick: async ()=>{ closeSheet(); installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); }}, 'Install now') : null,
    h('button',{class:'btn ghost', onclick:closeSheet}, 'Close'));
}

/* ───────────────────────── sheets ───────────────────────── */
function openMine(date, kind, justBooked){
  sheet(
    h('h2',null, justBooked ? '✓ Booked!' : `Your ${KIND[kind].label.toLowerCase()}`),
    h('p',{class:'sub'}, `${KIND[kind].icon} ${KIND[kind].label} · ${fmtLong(date)} · ${slotTime(kind)}`),
    justBooked ? h('div',{class:'hint', style:'margin:-6px 2px 12px'}, 'The family gets a notification. If you’ve subscribed your calendar, it will show up there too.') : null,
    h('div',{class:'section-title', style:'margin-top:4px'}, 'Tell the preschool'),
    h('div',{class:'msgbox'}, preschoolMsg(date,kind,S.uid)),
    h('button',{class:'btn ghost', onclick:()=>copy(preschoolMsg(date,kind,S.uid), 'Copied — paste it in the preschool app')}, '📋 Copy message for the preschool app'),
    S.priv?.cal_token ? null : h('button',{class:'btn ghost', onclick:()=>{ closeSheet(); openCalendar(); }}, '📅 Show my runs in my calendar'),
    h('div',{style:'height:14px'}),
    h('button',{class:'btn danger', onclick:()=>cancel(date,kind)}, 'Cancel this booking'),
    h('button',{class:'btn ghost', onclick:closeSheet}, 'Close'));
}
function openOthers(date, kind, uid){
  const past = date < todayIso();
  sheet(
    h('div',{style:'display:flex;align-items:center;gap:10px;margin-bottom:6px'}, avatar(uid,34), h('h2',{style:'margin:0'}, `${realName(uid)} has this one`)),
    h('p',{class:'sub'}, `${KIND[kind].icon} ${KIND[kind].label} · ${fmtLong(date)} · ${slotTime(kind)}`),
    h('div',{class:'msgbox'}, preschoolMsg(date,kind,uid)),
    h('button',{class:'btn ghost', onclick:()=>copy(preschoolMsg(date,kind,uid), 'Copied — paste it in the preschool app')}, '📋 Copy message for the preschool app'),
    (!past && member(S.uid)) ? h('button',{class:'btn', onclick:()=>{ closeSheet(); book(date,kind,true); }}, 'I’ll take it over instead') : null,
    h('button',{class:'btn ghost', onclick:closeSheet}, 'Close'));
}
function openProfile(first){
  const cur = member(S.uid) || {};
  let color = cur.color || COLORS[Object.keys(S.members).length % COLORS.length];
  const input = h('input',{value:cur.name||'', placeholder:'e.g. Mamá, Papá, Abuela…', maxlength:24});
  const sw = h('div',{class:'swatches'});
  const drawSw = () => sw.replaceChildren(...COLORS.map(c => h('button',{class:'sw'+(c===color?' on':''), style:`background:${c}`, 'aria-label':'colour', onclick:()=>{ color=c; drawSw(); }})));
  drawSw();
  const save = async () => {
    const name = input.value.trim().slice(0,24);
    if (!name) return toast('Add your name first');
    try{ const { error } = await sb.from('members').upsert({ user_id:S.uid, name, color }); if (error) throw error; await loadMembers(); closeSheet(); toast(first ? `Welcome, ${name}!` : 'Saved'); if (first) setTimeout(()=>onboardingNext(), 400); }
    catch(e){ writeFailed(e); }
  };
  sheet(
    h('h2',null, first ? 'Who are you?' : 'Your name & colour'),
    h('p',{class:'sub'}, 'This is how the rest of the family sees your bookings.'),
    h('div',{class:'field'}, h('label',null,'Name'), input,
      h('div',{class:'chips'}, ...['Mamá','Papá','Abuela','Abuelo','Mom','Dad','Grandma','Grandpa'].map(n => h('button',{class:'chip', onclick:()=>{ input.value=n; }}, n)))),
    h('div',{class:'field'}, h('label',null,'Colour'), sw),
    h('button',{class:'btn', onclick:save}, first ? 'Next' : 'Save'));
}
function onboardingNext(){
  sheet(h('h2',null,'Two quick things'),
    h('p',{class:'sub'},'So you hear about changes and see your runs in your calendar.'),
    h('button',{class:'btn', onclick:async ()=>{ await enableNotifications(); }}, '🔔 Turn on notifications'),
    h('button',{class:'btn ghost', onclick:()=>{ closeSheet(); openCalendar(); }}, '📅 Show my runs in my calendar'),
    h('button',{class:'btn ghost', onclick:closeSheet}, 'Later'));
}
let onboarded = false;
function maybeOnboard(){
  if (onboarded || !S.uid || !S.membersLoaded) return;
  onboarded = true;
  if (!member(S.uid)) openProfile(true);
}

/* ───────────────────────── views ───────────────────────── */
function slotButton(date, kind){
  const uid = S.slots[`${date}_${kind}`]?.userId;
  const past = date < todayIso();
  const canBook = !!member(S.uid);
  const head = h('div',{class:'k'}, h('span',null, `${KIND[kind].icon} ${KIND[kind].label}`), h('span',null, slotTime(kind)));
  if (uid){
    const mine = uid === S.uid;
    return h('button',{class:'slot taken'+(mine?' mine':''), style:`background:${colorOf(uid)}`, onclick:()=> mine ? openMine(date,kind) : openOthers(date,kind,uid)},
      head, h('div',{class:'who'}, avatar(uid,22), h('span',null,nameOf(uid))));
  }
  return h('button',{class:'slot open', disabled: (past || !canBook) ? true : null, onclick:()=>{ if (!past && canBook) book(date,kind,false); }},
    head, h('div',{class:'who'}, past ? h('span',{class:'muted'},'—') : (canBook ? '+ Take it' : h('span',{class:'muted'},'Open'))));
}
function nextSchoolDay(){
  let d = new Date();
  // after pick-up time on a weekday, look ahead to the next school day
  const [ph, pm] = String(cfg().pickTime).split(':').map(Number);
  if (d.getHours()*60 + d.getMinutes() > (ph*60 + pm + 60)) d = addDays(d, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  return iso(d);
}
function heroCard(){
  const d = nextSchoolDay(), isToday = d === todayIso();
  const canBook = !!member(S.uid);
  const row = kind => {
    const uid = S.slots[`${d}_${kind}`]?.userId;
    return h('div',{class:'hero-row' + (uid ? '' : ' is-empty')},
      h('div',{class:'hero-ic'}, KIND[kind].icon),
      h('div',{class:'hero-txt'},
        h('div',{class:'hero-k'}, `${KIND[kind].label} · ${slotTime(kind)}`),
        uid ? h('div',{class:'hero-who'}, avatar(uid,22), nameOf(uid)) : h('div',{class:'hero-who'}, 'Nobody yet')),
      uid ? h('button',{class:'hero-btn ghost', onclick:()=> uid === S.uid ? openMine(d,kind) : openOthers(d,kind,uid)}, 'Details')
          : (canBook ? h('button',{class:'hero-btn', onclick:()=>book(d,kind,false)}, 'I’ll do it') : null));
  };
  return h('section',{class:'hero'},
    h('div',{class:'hero-top'},
      h('div',null,
        h('div',{class:'hero-eyebrow'}, isToday ? 'Today' : 'Next up · ' + fromIso(d).toLocaleDateString('en-GB',{weekday:'long'})),
        h('div',{class:'hero-date'}, fromIso(d).toLocaleDateString('en-GB',{day:'numeric', month:'long'}))),
      h('div',{class:'hero-art'}, isToday ? '☀️' : '🌙')),
    row('drop'), row('pick'));
}
function weekView(){
  const out = [];
  const news = unseen();
  if (news.length) out.push(h('button',{class:'banner news', onclick:()=>{ S.tab='activity'; openActivity(); }},
    h('span',{class:'pulse'}), h('div',null, h('b',null, `${news.length} new change${news.length>1?'s':''}`), ' from the family'), h('span',{class:'linkbtn'}, 'See →')));
  if (!standalone() && ls.get('hideInstall') !== '1') out.push(h('div',{class:'banner'},
    h('div',null, '📲 Add Preschool Runs to your Home Screen'),
    h('button',{class:'linkbtn', onclick:()=>showInstallHelp()}, 'How')));

  out.push(heroCard());

  const ws = S.weekStart, we = addDays(ws,4);
  const thisWeek = iso(monday(new Date())) === iso(ws);
  let filled = 0;
  for (let i=0;i<5;i++){ const d = iso(addDays(ws,i)); if (S.slots[`${d}_drop`]) filled++; if (S.slots[`${d}_pick`]) filled++; }
  out.push(h('div',{class:'weeknav'},
    h('button',{'aria-label':'Previous week', onclick:()=>{ S.weekStart = addDays(S.weekStart,-7); render(); }}, '‹'),
    h('div',{class:'label'}, h('b',null, thisWeek ? 'This week' : `Week ${isoWeek(ws)}`),
      h('span',null, `${ws.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${we.toLocaleDateString('en-GB',{day:'numeric',month:'short'})}`),
      thisWeek ? null : h('button',{class:'today-link', onclick:()=>{ S.weekStart = monday(new Date()); render(); }}, 'Back to this week')),
    h('button',{'aria-label':'Next week', onclick:()=>{ S.weekStart = addDays(S.weekStart,7); render(); }}, '›')));
  out.push(h('div',{class:'cover'},
    h('div',{class:'cover-top'}, h('b',null, `${filled} of 10 runs covered`), h('span',null, filled === 10 ? 'All set 🎉' : `${10-filled} open`)),
    h('div',{class:'bar'}, h('i',{style:`width:${filled*10}%`}))));

  const t = todayIso();
  for (let i=0;i<5;i++){
    const d = iso(addDays(ws,i)), dt = fromIso(d);
    out.push(h('div',{class:'day'+(d===t?' today':'')+(d<t?' past':'')},
      h('div',{class:'dayhead'},
        h('div',{class:'daynum'}, h('small',null, dt.toLocaleDateString('en-GB',{weekday:'short'})), String(dt.getDate())),
        h('div',{class:'dayname'}, dt.toLocaleDateString('en-GB',{weekday:'long'}), d===t ? h('span',{class:'tag'}, 'Today') : null)),
      h('div',{class:'slots'}, slotButton(d,'drop'), slotButton(d,'pick'))));
  }
  out.push(h('button',{class:'btn ghost', style:'margin-top:8px', onclick:()=>sheet(
    h('h2',null,'This week for the preschool'),
    h('p',{class:'sub'},'Paste it into the preschool’s app or a message to the teachers.'),
    h('div',{class:'msgbox'}, weekSummary()),
    h('button',{class:'btn', onclick:()=>copy(weekSummary(), 'Copied — paste it in the preschool app')}, '📋 Copy'),
    h('button',{class:'btn ghost', onclick:closeSheet}, 'Close'))}, '📋 Week summary for the preschool'));
  return out;
}
function activityView(){
  const seen = S.lastSeenShown;
  const out = [h('div',{class:'section-title', style:'margin-top:4px'}, 'Bookings & cancellations')];
  if (!S.events.length){ out.push(h('div',{class:'card empty'}, 'Nothing yet. When someone books or cancels, it shows up here.')); return out; }
  const card = h('div',{class:'card', style:'padding:4px 14px'});
  for (const e of S.events){
    const k = KIND[e.kind]?.label.toLowerCase() || 'slot';
    const who = e.userId === S.uid ? 'You' : realName(e.userId);
    let text;
    if (e.type === 'cancelled') text = `${who} cancelled ${k} on ${fmtDay(e.date)}`;
    else if (e.type === 'takeover') text = `${who} took over ${k} on ${fmtDay(e.date)} from ${e.prevUserId===S.uid?'you':realName(e.prevUserId)}`;
    else text = `${who} booked ${k} on ${fmtDay(e.date)}`;
    const isNew = seen != null && e.at > seen && e.userId !== S.uid;
    card.appendChild(h('div',{class:'event'}, avatar(e.userId),
      h('div',{class:'txt'}, (e.type==='cancelled'?'❌ ':'✅ ') + text, isNew ? h('span',{class:'new'},'NEW') : null, h('div',{class:'time'}, ago(e.at)))));
  }
  out.push(card);
  return out;
}
function settingsView(){
  const c = cfg();
  const f = {
    child: h('input',{value:c.child, placeholder:'Child’s name'}),
    preschool: h('input',{value:c.preschool, placeholder:'Preschool'}),
    dropTime: h('input',{type:'time', value:c.dropTime}),
    pickTime: h('input',{type:'time', value:c.pickTime}),
    template: h('textarea',null, c.template),
  };
  const save = async () => {
    const next = { child:f.child.value.trim().slice(0,40), preschool:f.preschool.value.trim().slice(0,60),
      dropTime:f.dropTime.value||'08:00', pickTime:f.pickTime.value||'16:00', duration:30,
      template:f.template.value.trim().slice(0,300) || DEFAULT_CONFIG.template };
    try{
      const { error } = await sb.from('config').update({ child:next.child, preschool:next.preschool, drop_time:next.dropTime,
        pick_time:next.pickTime, duration:next.duration, template:next.template, updated_at:new Date().toISOString() }).eq('id', 1);
      if (error) throw error; await loadConfig(); toast('Saved for everyone');
    }catch(e){ writeFailed(e); }
  };
  const ns = notifState();
  const notifLine = {
    on: h('span',{class:'ok'}, 'On for this phone'),
    off: h('button',{class:'linkbtn', onclick:enableNotifications}, 'Turn on'),
    blocked: h('span',{class:'muted', style:'font-size:13px'}, 'Blocked — allow in phone settings'),
    'install-first': h('button',{class:'linkbtn', onclick:()=>showInstallHelp('Notifications on iPhone only work once the app is on your Home Screen.')}, 'Install first'),
    unsupported: h('span',{class:'muted', style:'font-size:13px'}, 'Not supported here'),
  }[ns];
  const ids = Object.keys(S.members);
  const row = (label, right) => h('div',{style:'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0'}, h('b',null,label), right);
  return [
    h('div',{class:'section-title', style:'margin-top:4px'}, 'You'),
    h('div',{class:'card'},
      row(member(S.uid) ? h('span',{style:'display:flex;align-items:center;gap:10px'}, avatar(S.uid,30), realName(S.uid)) : 'Not set up', h('button',{class:'linkbtn', onclick:()=>openProfile(!member(S.uid))}, 'Edit')),
      row('🔔 Notifications', notifLine),
      row('📅 Calendar', h('button',{class:'linkbtn', onclick:openCalendar}, S.priv?.cal_token ? 'Links' : 'Set up')),
      standalone() ? null : row('📲 Home Screen', h('button',{class:'linkbtn', onclick:()=>showInstallHelp()}, 'Install'))),
    h('div',{class:'section-title'}, 'Family'),
    h('div',{class:'card'}, ids.length ? h('div',{class:'members'}, ...ids.map(id => h('div',{class:'member'}, avatar(id,24), realName(id)))) : h('div',{class:'muted'},'No one yet.')),
    h('div',{class:'section-title'}, 'Preschool details (shared)'),
    h('div',{class:'card'},
      h('div',{class:'row2'}, h('div',{class:'field'}, h('label',null,'Child'), f.child), h('div',{class:'field'}, h('label',null,'Preschool'), f.preschool)),
      h('div',{class:'row2'}, h('div',{class:'field'}, h('label',null,'Drop-off'), f.dropTime), h('div',{class:'field'}, h('label',null,'Pick-up'), f.pickTime)),
      h('div',{class:'field'}, h('label',null,'Message for the preschool'), f.template,
        h('div',{class:'hint'}, 'Placeholders: {child} {verb} {name} {day} {time}. Write it in Swedish if the teachers prefer.')),
      h('button',{class:'btn', onclick:save}, 'Save')),
    h('div',{style:'text-align:center;margin-top:18px'},
      h('div',{class:'hint'}, `Signed in as ${S.email}`),
      h('button',{class:'linkbtn', style:'margin-top:8px', onclick:doSignOut}, 'Sign out')),
  ];
}

/* ───────────────────────── render ───────────────────────── */
function render(){
  const nav = document.getElementById('tabsnav');
  if (S.phase !== 'app'){
    nav.hidden = true;
    $app.replaceChildren(...(S.phase === 'auth' ? authView() : S.phase === 'verify' ? verifyView() : S.phase === 'denied' ? deniedView() : [h('div',{class:'card empty'},'Loading…')]));
    return;
  }
  // keep focus/typing in settings from being wiped by live updates
  if (S.tab === 'settings' && $app.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) { drawTabs(); return; }
  const me = member(S.uid);
  const hr = new Date().getHours();
  const hello = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const header = h('header',{class:'top'},
    h('div',{class:'brand'},
      h('small',null, me ? `${hello}, ${realName(S.uid)}` : 'Preschool Runs'),
      h('h1',null, S.tab === 'activity' ? 'Activity' : S.tab === 'settings' ? 'Settings' : (cfg().child ? `${cfg().child}’s week` : 'This week')),
      cfg().preschool && S.tab === 'week' ? h('span',{class:'school'}, '🏫 ' + cfg().preschool) : null),
    me ? h('button',{class:'mechip', 'aria-label':'My settings', onclick:()=>{ S.tab='settings'; render(); }}, avatar(S.uid, 40)) : null);
  const body = S.tab === 'activity' ? activityView() : S.tab === 'settings' ? settingsView() : weekView();
  $app.replaceChildren(header, ...body);
  drawTabs();
}
function drawTabs(){
  const nav = document.getElementById('tabsnav'); nav.hidden = false;
  const n = unseen().length;
  const tab = (id, ic, label, badge) => h('button',{class:'tab'+(S.tab===id?' on':''), onclick:()=>{
      S.tab = id; if (location.hash) history.replaceState(null,'',location.pathname + location.search);
      if (id === 'activity') openActivity(); else render(); window.scrollTo(0,0); }},
    h('span',{class:'ic'}, ic), label, badge ? h('span',{class:'badge'}, String(badge)) : null);
  document.getElementById('tabs').replaceChildren(tab('week','🗓️','Week'), tab('activity','🔔','Activity', n), tab('settings','⚙️','Settings'));
}
render();
