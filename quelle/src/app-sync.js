/* ============================================================
   Finanzübersicht C · Android-App (A1) · Abgleich mit OneDrive und Google Drive
   Läuft NACH dem Hauptskript und benutzt dessen Mischregeln (lokZusammenfuehren) unverändert.

   Drei mögliche Ziele, alle gleichrangig:
     ms   Tresordatei in OneDrive        (verschlüsselt)
     g    Tresordatei in Google Drive    (verschlüsselt)
     l6   Datendatei der lokalen Fassung in OneDrive (Klartext, wahlweise)

   Ein Abgleich: ausstehende Änderungen schreiben → alle Ziele lesen und entschlüsseln →
   Datensatz für Datensatz zusammenführen → falls sich hier etwas ändert, den Bestand neu
   aufbauen → jedes Ziel, das vom Ergebnis abweicht, neu schreiben (mit ETag-Prüfung).
   ============================================================ */
(function(){
'use strict';
const FUA = window.FUA;
const KONFIG = Object.assign({ msClientId:'', msTenant:'common', googleClientId:'', redirectUri:'',
                               appSchema:'de.vanwuellen.finanzc' }, window.FUA_KONFIG||{});
const EP = Object.assign({
  msAuth:  'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
  msToken: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
  graph:   'https://graph.microsoft.com/v1.0',
  gAuth:   'https://accounts.google.com/o/oauth2/v2/auth',
  gApi:    'https://www.googleapis.com/drive/v3',
  gUpload: 'https://www.googleapis.com/upload/drive/v3'
}, KONFIG.endpunkte||{});

const TRESOR_DATEI = 'Finanzuebersicht-C-App.fuct';
const TRESOR_TYP   = 'finanzuebersicht-c-tresor';
const L6_DATEI     = 'Finanzuebersicht-C-Daten.json';
const SPEICHER_TYP = 'finanzuebersicht-c-speicher';
const ITER = 600000;
const MS_SCOPE = 'Files.ReadWrite offline_access';
const G_SCOPE  = 'https://www.googleapis.com/auth/drive.file';

/* ---------- Einstellungen und Schlüssel (IndexedDB, Datensatz 'sync') ---------- */
const SY = {
  einst:{ ms:{aktiv:false, ordner:'Finanzübersicht C'}, g:{aktiv:false, ordner:'Finanzübersicht C'},
          l6:{aktiv:false, ordner:''}, auto:true, msClientId:'', googleClientId:'', msTenant:'', redirect:'' },
  tresor:null,          // {salt, iter} — kanonisches Schlüsselsalz
  keys:{},              // salt → CryptoKey (nicht exportierbar)
  tok:{ ms:null, g:null },
  stand:{ ms:{}, g:{}, l6:{} },
  sicherung:{ ms:'', g:'' },
  gIds:{}
};
let PASS = null;        // Passphrase, nur für diese Sitzung im Arbeitsspeicher
async function syLaden(){
  const s = await FUA.idbGet('sync');
  if(s){
    Object.assign(SY, s);
    SY.einst = Object.assign({}, {ms:{aktiv:false, ordner:'Finanzübersicht C'}, g:{aktiv:false, ordner:'Finanzübersicht C'},
      l6:{aktiv:false, ordner:''}, auto:true}, s.einst||{});
    SY.stand = Object.assign({ms:{}, g:{}, l6:{}}, s.stand||{});
    SY.tok = Object.assign({ms:null, g:null}, s.tok||{});
  }
}
const sySichern = () => FUA.idbSet('sync', SY);
const cfg = k => (SY.einst[k]||'') || KONFIG[k] || '';
const tenant = () => cfg('msTenant') || 'common';
function redirectUri(){
  if(SY.einst.redirect) return SY.einst.redirect;
  if(KONFIG.redirectUri) return KONFIG.redirectUri;
  return new URL('oauth.html', location.href).href.replace(/[?#].*$/,'');
}

/* ---------- Hilfen ---------- */
const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);
function b64(bytes){ let s=''; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000)); return btoa(s); }
function unb64(s){ const b=atob(s), a=new Uint8Array(b.length); for(let i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return a; }
const b64url = bytes => b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const zufall = n => crypto.getRandomValues(new Uint8Array(n));
const heute = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
/** JSON mit sortierten Schlüsseln — zwei gleiche Stände ergeben denselben Text. */
function stabil(o){
  if(o===null || typeof o!=='object') return JSON.stringify(o);
  if(Array.isArray(o)) return '['+o.map(stabil).join(',')+']';
  return '{'+Object.keys(o).filter(k=>o[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stabil(o[k])).join(',')+'}';
}
const sig = st => stabil({docs:st.docs||{}, weg:st.weg||{}});
class Fehler extends Error{ constructor(code, msg){ super(msg||code); this.code=code; } }

async function gzip(text){
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(bytes){
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(s).text();
}

/* ---------- Verschlüsselung: PBKDF2-SHA256 (600.000 Runden) → AES-256-GCM ---------- */
async function ableiten(pass, salt, iter){
  const basis = await crypto.subtle.importKey('raw', enc(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt:unb64(salt), iterations:iter||ITER},
    basis, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function schluesselFuer(salt, iter){
  if(SY.keys[salt]) return SY.keys[salt];
  if(!PASS) throw new Fehler('PASSPHRASE', 'Passphrase nötig');
  const k = await ableiten(PASS, salt, iter);
  SY.keys[salt] = k; await sySichern();
  return k;
}
const AAD = enc(TRESOR_TYP+'/1');
async function verschluesseln(st){
  if(!SY.tresor) throw new Fehler('PASSPHRASE', 'Keine Passphrase festgelegt');
  const key = await schluesselFuer(SY.tresor.salt, SY.tresor.iter);
  const innen = JSON.stringify({typ:SPEICHER_TYP, v:1, ts:new Date().toISOString(), geraet:GERAET,
    herkunft:'Android-App Finanzübersicht C', docs:st.docs, stempel:st.stempel, weg:st.weg});
  const iv = zufall(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:AAD}, key, await gzip(innen)));
  return JSON.stringify({typ:TRESOR_TYP, v:1, ts:new Date().toISOString(), geraet:GERAET,
    kdf:{name:'PBKDF2-SHA256', iter:SY.tresor.iter, salt:SY.tresor.salt}, chiffre:'AES-256-GCM', gz:true,
    iv:b64(iv), daten:b64(ct)});
}
async function entschluesseln(text){
  let o; try{ o = JSON.parse(text); }catch(e){ throw new Fehler('FORMAT', 'Tresordatei ist kein JSON'); }
  if(!o || o.typ!==TRESOR_TYP || !o.kdf) throw new Fehler('FORMAT', 'Keine Tresordatei');
  const key = await schluesselFuer(o.kdf.salt, o.kdf.iter);
  let roh;
  try{ roh = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(o.iv), additionalData:AAD}, key, unb64(o.daten)); }
  catch(e){ delete SY.keys[o.kdf.salt]; await sySichern(); throw new Fehler('FALSCH', 'Die Passphrase passt nicht zu dieser Datei'); }
  const innen = JSON.parse(o.gz ? await gunzip(new Uint8Array(roh)) : dec(roh));
  return {docs:innen.docs||{}, stempel:innen.stempel||{}, weg:innen.weg||{}, kdf:o.kdf};
}

/** Alles Ausstehende sicher ablegen. flush() stellt sich zurück, solange der Tagespunkt den alten
    Stand liest (erste Änderung des Tages) — dann erst warten, sonst ginge die Änderung beim
    Schließen der App oder beim Weiterleiten zur Anmeldung verloren. */
async function allesSchreiben(){
  for(let i=0; i<80 && typeof PUNKT_LAEUFT!=='undefined' && PUNKT_LAEUFT; i++) await new Promise(r=>setTimeout(r,100));
  try{ clearTimeout(flushTimer); await flush(); }catch(e){}
}

/* ---------- Anmeldung (OAuth) ---------- */
const nativ = () => FUA.istNativ();
async function sha256(s){ return new Uint8Array(await crypto.subtle.digest('SHA-256', enc(s))); }
async function anmelden(pid){
  const id = pid==='ms' ? cfg('msClientId') : cfg('googleClientId');
  if(!id) throw new Fehler('KONFIG', (pid==='ms'?'Microsoft':'Google')+'-Client-ID fehlt — siehe Einstellungen unten im Reiter Abgleich');
  const state = pid+'.'+(nativ()?'n':'w')+'.'+b64url(zufall(12));
  let url;
  if(pid==='ms'){
    const verifier = b64url(zufall(48));
    localStorage.setItem('fua_pkce', JSON.stringify({pid, state, verifier, redirect:redirectUri()}));
    url = EP.msAuth.replace('{tenant}', tenant())+'?'+new URLSearchParams({
      client_id:id, response_type:'code', redirect_uri:redirectUri(), response_mode:'query',
      scope:MS_SCOPE, state, code_challenge:b64url(await sha256(verifier)), code_challenge_method:'S256',
      prompt:'select_account'});
  } else {
    localStorage.setItem('fua_pkce', JSON.stringify({pid, state, redirect:redirectUri()}));
    url = EP.gAuth+'?'+new URLSearchParams({client_id:id, redirect_uri:redirectUri(), response_type:'token',
      scope:G_SCOPE, state, include_granted_scopes:'true'});
  }
  await allesSchreiben();          // nichts Ungesichertes zurücklassen
  if(nativ()){
    const B = FUA.plugin('Browser');
    if(B) { await B.open({url}); return; }
  }
  location.assign(url);
}
/** Rückkehr aus der Anmeldung — Parameter aus Suchteil und Fragment. */
async function rueckkehr(q, h){
  const p = new URLSearchParams((q||'').replace(/^\?/,'')+'&'+(h||'').replace(/^#/,''));
  let merk=null; try{ merk=JSON.parse(localStorage.getItem('fua_pkce')||'null'); }catch(e){}
  localStorage.removeItem('fua_pkce');
  if(!merk || p.get('state')!==merk.state) throw new Fehler('STATE', 'Anmeldung nicht zuordenbar — bitte erneut anmelden');
  if(p.get('error')) throw new Fehler('ABGELEHNT', p.get('error_description')||p.get('error'));
  if(merk.pid==='ms'){
    const r = await fetch(EP.msToken.replace('{tenant}', tenant()), {method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:cfg('msClientId'), grant_type:'authorization_code', code:p.get('code')||'',
        redirect_uri:merk.redirect, code_verifier:merk.verifier, scope:MS_SCOPE})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok || !j.access_token) throw new Fehler('TOKEN', j.error_description||('Token-Abruf fehlgeschlagen ('+r.status+')'));
    SY.tok.ms = {access:j.access_token, refresh:j.refresh_token||null, exp:Date.now()+((+j.expires_in||3600)-60)*1000};
    SY.einst.ms.aktiv = true;
    try{ const d = await msJson('GET', '/me/drive?$select=owner'); SY.tok.ms.konto = ((d.owner||{}).user||{}).displayName||''; }catch(e){}
  } else {
    const t = p.get('access_token');
    if(!t) throw new Fehler('TOKEN', 'Google hat kein Zugriffstoken geliefert');
    SY.tok.g = {access:t, exp:Date.now()+((+p.get('expires_in')||3600)-60)*1000};
    SY.einst.g.aktiv = true;
    try{ const d = await gJson('GET', EP.gApi+'/about?fields=user(displayName,emailAddress)');
      SY.tok.g.konto = (d.user||{}).emailAddress || (d.user||{}).displayName || ''; }catch(e){}
  }
  await sySichern();
  return merk.pid;
}
async function msTokenHolen(){
  const t = SY.tok.ms;
  if(!t) throw new Fehler('ANMELDUNG', 'OneDrive: nicht angemeldet');
  if(t.access && t.exp>Date.now()) return t.access;
  if(!t.refresh) throw new Fehler('ANMELDUNG', 'OneDrive: Anmeldung abgelaufen');
  const r = await fetch(EP.msToken.replace('{tenant}', tenant()), {method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:cfg('msClientId'), grant_type:'refresh_token', refresh_token:t.refresh, scope:MS_SCOPE})});
  const j = await r.json().catch(()=>({}));
  if(!r.ok || !j.access_token){ t.access=null; t.refresh=null; await sySichern(); throw new Fehler('ANMELDUNG', 'OneDrive: Anmeldung abgelaufen'); }
  Object.assign(t, {access:j.access_token, refresh:j.refresh_token||t.refresh, exp:Date.now()+((+j.expires_in||3600)-60)*1000});
  await sySichern();
  return t.access;
}
function gTokenHolen(){
  const t = SY.tok.g;
  if(!t || !t.access) throw new Fehler('ANMELDUNG', 'Google: nicht angemeldet');
  if(t.exp<=Date.now()) throw new Fehler('ANMELDUNG', 'Google: Anmeldung abgelaufen (gilt je eine Stunde)');
  return t.access;
}

/* ---------- OneDrive (Microsoft Graph) ---------- */
async function msFetch(method, pfad, opt){
  opt = opt||{};
  const tok = await msTokenHolen();
  const r = await fetch(pfad.startsWith('http')?pfad:EP.graph+pfad, {method,
    headers:Object.assign({Authorization:'Bearer '+tok}, opt.headers||{}), body:opt.body});
  if(r.status===401){ SY.tok.ms.exp=0; await sySichern(); throw new Fehler('ANMELDUNG', 'OneDrive: Anmeldung abgelaufen'); }
  return r;
}
async function msJson(method, pfad){ const r=await msFetch(method, pfad); if(!r.ok) throw new Fehler('HTTP', 'OneDrive '+r.status); return r.json(); }
const msPfad = (ordner, name) => [ ...String(ordner||'').split('/').filter(Boolean), name ].map(encodeURIComponent).join('/');
const MS = {
  id:'ms', name:'OneDrive',
  async lesen(ordner, name){
    const r = await msFetch('GET', '/me/drive/root:/'+msPfad(ordner,name)+'?$select=id,eTag,size,@microsoft.graph.downloadUrl');
    if(r.status===404) return null;
    if(!r.ok) throw new Fehler('HTTP', 'OneDrive '+r.status);
    const m = await r.json();
    const u = m['@microsoft.graph.downloadUrl'];
    const d = u ? await fetch(u) : await msFetch('GET', '/me/drive/items/'+encodeURIComponent(m.id)+'/content');
    if(!d.ok) throw new Fehler('HTTP', 'OneDrive-Download '+d.status);
    return {text:await d.text(), etag:m.eTag};
  },
  async schreiben(ordner, name, text, etag, ersetzen){
    const headers = {'Content-Type':'application/octet-stream'};
    let q = '';
    if(etag) headers['If-Match'] = etag;
    else q = '?@microsoft.graph.conflictBehavior='+(ersetzen?'replace':'fail');
    const r = await msFetch('PUT', '/me/drive/root:/'+msPfad(ordner,name)+':/content'+q, {headers, body:text});
    if(r.status===412 || r.status===409) throw new Fehler('KONFLIKT', 'OneDrive: Datei wurde inzwischen geändert');
    if(!r.ok) throw new Fehler('HTTP', 'OneDrive-Upload '+r.status);
    const j = await r.json().catch(()=>({}));
    return j.eTag || null;
  }
};

/* ---------- Google Drive (drive.file: die App sieht nur, was sie selbst angelegt hat) ---------- */
async function gFetch(method, url, opt){
  opt = opt||{};
  const r = await fetch(url, {method, headers:Object.assign({Authorization:'Bearer '+gTokenHolen()}, opt.headers||{}), body:opt.body});
  if(r.status===401){ SY.tok.g.exp=0; await sySichern(); throw new Fehler('ANMELDUNG', 'Google: Anmeldung abgelaufen'); }
  return r;
}
async function gJson(method, url, opt){ const r=await gFetch(method, url, opt); if(!r.ok) throw new Fehler('HTTP', 'Google '+r.status); return r.json(); }
const gq = s => String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
async function gOrdner(ordner, anlegen){
  const name = ordner || 'Finanzübersicht C';
  if(SY.gIds[name]) return SY.gIds[name];
  const l = await gJson('GET', EP.gApi+'/files?'+new URLSearchParams({spaces:'drive', fields:'files(id,name)',
    q:`name='${gq(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`}));
  let id = (l.files||[])[0] && l.files[0].id;
  if(!id && anlegen){
    const n = await gJson('POST', EP.gApi+'/files?fields=id', {headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name, mimeType:'application/vnd.google-apps.folder'})});
    id = n.id;
  }
  if(id){ SY.gIds[name]=id; await sySichern(); }
  return id||null;
}
async function gDatei(ordnerId, name){
  const l = await gJson('GET', EP.gApi+'/files?'+new URLSearchParams({spaces:'drive', fields:'files(id,version)',
    q:`name='${gq(name)}' and '${gq(ordnerId)}' in parents and trashed=false`}));
  return (l.files||[])[0] || null;
}
const G = {
  id:'g', name:'Google Drive',
  async lesen(ordner, name){
    const oid = await gOrdner(ordner, false); if(!oid) return null;
    const f = await gDatei(oid, name); if(!f) return null;
    const r = await gFetch('GET', EP.gApi+'/files/'+encodeURIComponent(f.id)+'?alt=media');
    if(!r.ok) throw new Fehler('HTTP', 'Google-Download '+r.status);
    return {text:await r.text(), etag:String(f.version)};
  },
  async schreiben(ordner, name, text, etag, ersetzen){
    const oid = await gOrdner(ordner, true);
    const f = await gDatei(oid, name);
    if(f && !ersetzen && String(f.version)!==String(etag)) throw new Fehler('KONFLIKT', 'Google: Datei wurde inzwischen geändert');
    if(f){
      const j = await gJson('PATCH', EP.gUpload+'/files/'+encodeURIComponent(f.id)+'?uploadType=media&fields=version',
        {headers:{'Content-Type':'application/octet-stream'}, body:text});
      return String(j.version);
    }
    const grenze = 'fua'+b64url(zufall(9));
    const body = `--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`+
      JSON.stringify({name, parents:[oid], mimeType:'application/octet-stream'})+
      `\r\n--${grenze}\r\nContent-Type: application/octet-stream\r\n\r\n`+text+`\r\n--${grenze}--`;
    const j = await gJson('POST', EP.gUpload+'/files?uploadType=multipart&fields=id,version',
      {headers:{'Content-Type':'multipart/related; boundary='+grenze}, body});
    return String(j.version);
  }
};
const DIENST = {ms:MS, g:G};

/* ---------- Ziele ---------- */
function ziele(){
  const z = [];
  if(SY.einst.ms.aktiv && SY.tok.ms) z.push({id:'ms', d:MS, ordner:SY.einst.ms.ordner, datei:TRESOR_DATEI, verschl:true, name:'OneDrive'});
  if(SY.einst.g.aktiv && SY.tok.g)  z.push({id:'g',  d:G,  ordner:SY.einst.g.ordner,  datei:TRESOR_DATEI, verschl:true, name:'Google Drive'});
  if(SY.einst.l6.aktiv && SY.tok.ms) z.push({id:'l6', d:MS, ordner:SY.einst.l6.ordner||SY.einst.ms.ordner, datei:L6_DATEI, verschl:false, name:'Datendatei L6'});
  return z;
}

/* ---------- Status ---------- */
const ST = { laeuft:false, zuletzt:null, fehler:{}, meldung:'', naechst:null };
const STATUS_HOERER = [];
function melden(){ STATUS_HOERER.forEach(f=>{ try{ f(); }catch(e){} }); }

/* ---------- Bestand neu aufbauen (wie nach dem Einlesen einer Datendatei) ---------- */
async function neuAufbauen(){
  if(!MAND){ location.reload(); return; }
  DIRTY.clear(); UNDO.length=0; REDO.length=0;
  const altMonat = UI.monat;
  await mandsLaden();
  if(!MAND || !mFinden(MAND.id)) MAND = mSichtbar()[0]||MANDS[0]||MAND;
  S.meta=null; S.accounts=[]; S.turnus=[]; S.vorlagen=[]; S.vorgemerkt=[]; S.budgets=[]; S.months={};
  await loadAll();
  reindex(); migrationDatenmodell(); rueckFrischen();
  UI.monat = (altMonat && S.months[altMonat]) ? altMonat : (openMonths().slice(-1)[0] || monthKeys().slice(-1)[0] || thisYM());
  renderMandbox(); renderHeaderStat();
  refresh();
}
const modalOffen = () => { const o=document.getElementById('ov'); return !!(o && o.classList.contains('on')); };

/* ---------- Der Abgleich ---------- */
let NOCHMAL = false, autoTimer = null;
async function abgleichen(opt){
  opt = opt||{};
  const zl = ziele();
  if(!zl.length){ ST.meldung='Kein Speicherort verbunden'; melden(); return {ok:false}; }
  if(ST.laeuft){ NOCHMAL=true; return {ok:false}; }
  if(modalOffen() && !opt.trotzDialog){ planen(8000); return {ok:false, verschoben:true}; }
  if(!navigator.onLine){ ST.meldung='offline'; melden(); return {ok:false}; }
  ST.laeuft=true; ST.fehler={}; ST.meldung='Abgleich läuft …'; melden();
  const bericht = {gelesen:[], geschrieben:[], uebernommen:false, fehler:{}};
  try{
    await allesSchreiben();
    if(zl.some(z=>z.verschl) && !SY.tresor){
      // Noch keine Passphrase: prüfen, ob schon ein Tresor existiert — sonst wartet der Abgleich.
      throw new Fehler('PASSPHRASE', 'Passphrase festlegen, bevor abgeglichen wird');
    }
    const lokal = FUA.abbild();
    const ziel = FUA.clone(lokal);
    const fern = {};
    for(const z of zl){
      try{
        const r = await z.d.lesen(z.ordner, z.datei);
        if(!r){ fern[z.id]={st:null, etag:null}; continue; }
        let st;
        if(z.verschl) st = await entschluesseln(r.text);
        else{ const o=JSON.parse(r.text);
          if(!o || o.typ!==SPEICHER_TYP) throw new Fehler('FORMAT', 'Keine Datendatei der lokalen Fassung');
          st = {docs:o.docs||{}, stempel:o.stempel||{}, weg:o.weg||{}}; }
        fern[z.id] = {st, etag:r.etag};
        bericht.gelesen.push(z.id);
      }catch(e){ ST.fehler[z.id]=e; bericht.fehler[z.id]=e.message; }
    }
    for(const z of zl){ const f=fern[z.id]; if(f && f.st) lokZusammenfuehren(ziel, FUA.clone(f.st)); }
    const neuSig = sig(ziel);
    if(neuSig !== sig(lokal)){
      if(modalOffen() && !opt.trotzDialog){ ST.laeuft=false; planen(8000); return {ok:false, verschoben:true}; }
      await FUA.uebernehmen(ziel);
      await neuAufbauen();
      bericht.uebernommen = true;
    }
    const tag = heute();
    let klartext = null, tresortext = null;
    for(const z of zl){
      const f = fern[z.id]; if(!f) continue;                          // Lesen fehlgeschlagen → nicht blind schreiben
      if(f.st && sig(f.st)===neuSig && !(z.verschl && f.st.kdf && f.st.kdf.salt!==SY.tresor.salt)) {
        SY.stand[z.id] = {ts:new Date().toISOString(), etag:f.etag}; continue;
      }
      try{
        let text;
        if(z.verschl) text = tresortext = tresortext || await verschluesseln(ziel);
        else text = klartext = klartext || JSON.stringify({typ:SPEICHER_TYP, v:1, ts:new Date().toISOString(),
          geraet:GERAET, herkunft:'Android-App Finanzübersicht C', docs:ziel.docs, stempel:ziel.stempel, weg:ziel.weg});
        const etag = await z.d.schreiben(z.ordner, z.datei, text, f.etag, false);
        SY.stand[z.id] = {ts:new Date().toISOString(), etag};
        bericht.geschrieben.push(z.id);
        if(z.verschl && SY.sicherung[z.id]!==tag){
          try{
            const sp = z.id==='ms' ? (z.ordner?z.ordner+'/':'')+'Sicherungen' : z.ordner;
            await z.d.schreiben(sp, 'Finanzuebersicht-C-App-'+tag+'.fuct', text, null, true);
            SY.sicherung[z.id] = tag;
          }catch(e){}
        }
      }catch(e){
        if(e.code==='KONFLIKT' && !opt.wiederholt){ ST.laeuft=false; await sySichern(); return await abgleichen(Object.assign({}, opt, {wiederholt:true})); }
        ST.fehler[z.id]=e; bericht.fehler[z.id]=e.message;
      }
    }
    for(const z of zl) if(!ST.fehler[z.id]) SY.stand[z.id] = Object.assign(SY.stand[z.id]||{}, {ok:new Date().toISOString()});
    ST.zuletzt = new Date();
    const nf = Object.keys(ST.fehler).length;
    ST.meldung = nf ? Object.values(ST.fehler).map(e=>e.message).join(' · ') : 'abgeglichen';
    await sySichern();
    bericht.ok = !nf;
    return bericht;
  }catch(e){
    ST.fehler.allg = e; ST.meldung = e.message; bericht.fehler.allg=e.message; bericht.ok=false;
    return bericht;
  }finally{
    ST.laeuft=false; melden();
    if(NOCHMAL){ NOCHMAL=false; planen(1500); }
  }
}
function planen(ms){
  clearTimeout(autoTimer);
  if(!SY.einst.auto) return;
  ST.naechst = Date.now()+ms;
  autoTimer = setTimeout(()=>{ ST.naechst=null; abgleichen(); }, ms);
}

/* ---------- Passphrase ---------- */
/** Passphrase festlegen oder bestätigen. Liegt schon ein Tresor in einem verbundenen Speicher,
    muss sie ihn öffnen — sonst entstünden zwei Tresore mit verschiedenen Schlüsseln. */
async function passphraseSetzen(pass){
  if(!pass || pass.length<10) throw new Fehler('KURZ', 'Die Passphrase braucht mindestens 10 Zeichen');
  PASS = pass;
  let gefunden = null;
  for(const z of ziele().filter(z=>z.verschl)){
    let r=null;
    try{ r = await z.d.lesen(z.ordner, z.datei); }
    catch(e){ PASS=null; throw new Fehler(e.code||'LESEN', z.name+' ließ sich nicht lesen ('+e.message+') — ohne diesen Blick würde womöglich ein zweiter Tresor mit anderem Schlüssel entstehen. Bitte später erneut.'); }
    if(!r) continue;
    const o = JSON.parse(r.text);
    delete SY.keys[o.kdf.salt];
    await entschluesseln(r.text);                     // wirft FALSCH, wenn sie nicht passt
    if(!gefunden) gefunden = {salt:o.kdf.salt, iter:o.kdf.iter};
  }
  if(gefunden) SY.tresor = gefunden;
  else if(!SY.tresor) SY.tresor = {salt:b64(zufall(16)), iter:ITER};
  await schluesselFuer(SY.tresor.salt, SY.tresor.iter);
  await sySichern();
  return !!gefunden;
}
async function sperren(){ SY.keys = {}; PASS = null; await sySichern(); melden(); }
async function abmelden(pid){
  SY.tok[pid]=null; SY.einst[pid].aktiv=false; if(pid==='g') SY.gIds={};
  if(pid==='ms') SY.einst.l6.aktiv=false;
  await sySichern(); melden();
}

/* ---------- Start: Rückkehr aus der Anmeldung, Auslöser für den Abgleich ---------- */
async function start(){
  await FUA.BEREIT;
  await syLaden();
  let angemeldet = null, fehler = null;
  try{
    const r = localStorage.getItem('fua_oauth');
    if(r){ localStorage.removeItem('fua_oauth'); const o=JSON.parse(r);
      if(Date.now()-(o.t||0) < 10*60*1000) angemeldet = await rueckkehr(o.q, o.h); }
    else if(/[?&#](code|access_token|error)=/.test(location.search+location.hash) && localStorage.getItem('fua_pkce')){
      angemeldet = await rueckkehr(location.search, location.hash);
      history.replaceState(null, '', location.pathname);
    }
  }catch(e){ fehler = e; }
  const App = FUA.plugin('App');
  if(nativ() && App){
    App.addListener('appUrlOpen', async ev=>{
      if(!ev || !ev.url || ev.url.indexOf(KONFIG.appSchema+'://oauth')!==0) return;
      try{ const B=FUA.plugin('Browser'); if(B) B.close().catch(()=>{}); }catch(e){}
      const u = ev.url.slice(ev.url.indexOf('://oauth')+8);
      const qi = u.indexOf('?'), hi = u.indexOf('#');
      const q = qi<0 ? '' : u.slice(qi, hi>qi?hi:undefined), h = hi<0 ? '' : u.slice(hi);
      try{ const pid = await rueckkehr(q, h); FUA_SYNC.nachAnmeldung(pid); }
      catch(e){ toast(e.message, 'bad'); }
    });
    App.addListener('appStateChange', s=>{ if(s && s.isActive) planen(1500); });
  }
  FUA.aufAenderung(()=>planen(10000));
  window.addEventListener('online', ()=>planen(1500));
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') planen(1500); else allesSchreiben(); });
  window.addEventListener('pagehide', ()=>{ allesSchreiben(); });
  setInterval(()=>{ if(document.visibilityState==='visible' && !ST.laeuft) planen(500); }, 5*60*1000);
  melden();
  return {angemeldet, fehler};
}

window.FUA_SYNC = {
  SY, ST, KONFIG, allesSchreiben, TRESOR_DATEI, L6_DATEI, start, abgleichen, planen, anmelden, abmelden, rueckkehr,
  passphraseSetzen, sperren, redirectUri, sySichern, ziele, verschluesseln, entschluesseln, DIENST,
  hatSchluessel: () => !!(SY.tresor && SY.keys[SY.tresor.salt]),
  aufStatus: f => STATUS_HOERER.push(f),
  nachAnmeldung: null,
  /** Datendatei (Klartext) der lokalen Fassung aus OneDrive holen — für den Einlese-Dialog. */
  async l6Holen(){
    const r = await MS.lesen(SY.einst.l6.ordner||SY.einst.ms.ordner, L6_DATEI);
    if(!r) throw new Fehler('FEHLT', L6_DATEI+' liegt nicht im Ordner „'+(SY.einst.l6.ordner||SY.einst.ms.ordner)+'"');
    return JSON.parse(r.text);
  },
  /** Einen Tresor aus einer Datei (z. B. einer Tagessicherung) entschlüsseln. */
  async tresorZuDatendatei(text){
    const st = await entschluesseln(text);
    return JSON.stringify({typ:SPEICHER_TYP, v:1, ts:new Date().toISOString(), geraet:GERAET,
      herkunft:'Entschlüsselter Tresor', docs:st.docs, stempel:st.stempel, weg:st.weg});
  }
};
})();
