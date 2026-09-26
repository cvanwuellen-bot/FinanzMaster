/* ============================================================
   Finanzübersicht C · Android-App (A1) · Speicherschicht
   Läuft VOR dem Hauptskript. Bildet die schmale Plattform-Schnittstelle nach, die das Tool
   benutzt — claude.use('db') und claude.use('downloads') —, und legt den Bestand als flaches
   Abbild {docs, stempel, weg} in der IndexedDB dieses Geräts ab. Das Format ist dasselbe wie in
   der Datendatei der lokalen Fassung (L6); die Mischregeln des Hauptskripts (lok…) greifen
   deshalb unverändert.
   Am Hauptskript ist keine Zeile Rechnung geändert.
   ============================================================ */
(function(){
'use strict';

const IDB_NAME = 'FinanzAppC', IDB_KV = 'kv', IDB_DOCS = 'docs';
const FRIST_IDB = 4000, FRIST_START = 12000;

const clone = o => o===undefined ? undefined : JSON.parse(JSON.stringify(o));
const jetztS = () => Math.floor(Date.now()/1000);
const geraet = () => { try{ return localStorage.getItem('fuc_geraet') || 'app'; }catch(e){ return 'app'; } };
const istPunkt = p => /(^|\/)punkte(\/|$)/.test(p);

/* ---------- IndexedDB als Schlüssel-Wert-Ablage, jede Operation mit Frist ---------- */
let IDB = null;
function mitFrist(p, ms, ersatz){
  return Promise.race([p, new Promise(r=>setTimeout(()=>r(ersatz), ms))]);
}
function idbOeffnen(){
  if(IDB) return Promise.resolve(IDB);
  const p = new Promise(res=>{
    let rq;
    try{ rq = indexedDB.open(IDB_NAME, 2); }catch(e){ res(null); return; }
    rq.onupgradeneeded = () => {
      const db = rq.result;
      try{ if(!db.objectStoreNames.contains(IDB_KV)) db.createObjectStore(IDB_KV); }catch(e){}
      try{ if(!db.objectStoreNames.contains(IDB_DOCS)) db.createObjectStore(IDB_DOCS); }catch(e){}
    };
    rq.onsuccess = () => { IDB = rq.result; IDB.onversionchange = () => { try{ IDB.close(); }catch(e){} IDB=null; }; res(IDB); };
    rq.onerror = () => res(null);
    rq.onblocked = () => res(null);
  });
  return mitFrist(p, FRIST_IDB, null);
}
async function idbGet(k){
  const db = await idbOeffnen(); if(!db) return undefined;
  return mitFrist(new Promise(res=>{
    try{
      const rq = db.transaction(IDB_KV,'readonly').objectStore(IDB_KV).get(k);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(undefined);
    }catch(e){ res(undefined); }
  }), FRIST_IDB, undefined);
}
async function idbSet(k, v){
  const db = await idbOeffnen(); if(!db) return false;
  return mitFrist(new Promise(res=>{
    try{
      const tx = db.transaction(IDB_KV,'readwrite');
      tx.objectStore(IDB_KV).put(v, k);
      tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false);
    }catch(e){ res(false); }
  }), FRIST_IDB, false);
}

/** Eine Schreibtransaktion über beide Ablagen: Dokumente einzeln, Grabsteine als Ganzes.
    Jedes Dokument wird sofort geschrieben — nicht gesammelt —, damit nichts verloren geht, wenn
    die App kurz nach einer Änderung geschlossen wird oder zur Anmeldung weiterleitet. */
async function idbTx(arbeit){
  const db = await idbOeffnen(); if(!db) return false;
  return mitFrist(new Promise(res=>{
    try{
      const tx = db.transaction([IDB_DOCS, IDB_KV], 'readwrite');
      arbeit(tx.objectStore(IDB_DOCS), tx.objectStore(IDB_KV));
      tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false);
    }catch(e){ res(false); }
  }), FRIST_IDB, false);
}
async function idbAlleDocs(){
  const db = await idbOeffnen(); if(!db) return null;
  return mitFrist(new Promise(res=>{
    try{
      const st = db.transaction(IDB_DOCS,'readonly').objectStore(IDB_DOCS);
      const k = st.getAllKeys(), v = st.getAll();
      v.onsuccess = () => res({k:k.result||[], v:v.result||[]});
      v.onerror = () => res(null);
    }catch(e){ res(null); }
  }), FRIST_IDB*3, null);
}

/* ---------- Der Bestand ---------- */
const STORE = { docs:{}, stempel:{}, weg:{} };
let SPIEGEL_OK = false;          // IndexedDB erreichbar?
const HOERER = [];               // wer von Änderungen erfahren will (Abgleich)

async function laden(){
  const a = await idbAlleDocs();
  if(a && a.k.length){
    a.k.forEach((p,i)=>{ const e=a.v[i]; if(!e) return; STORE.docs[p]=e.d; if(e.st) STORE.stempel[p]=e.st; });
    STORE.weg = (await idbGet('weg')) || {};
  }
  SPIEGEL_OK = !!IDB;
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
}
const BEREIT = mitFrist(laden().catch(()=>{}), FRIST_START, null);

/** Den ganzen Bestand neu ablegen (nach dem Übernehmen eines zusammengeführten Stands). */
async function sichernJetzt(){
  return idbTx((docs, kv)=>{
    docs.clear();
    for(const p in STORE.docs) docs.put({d:STORE.docs[p], st:STORE.stempel[p]||null}, p);
    kv.put(STORE.weg, 'weg');
  });
}
/** Ein Dokument ablegen oder entfernen — sofort. */
function docSichern(p){
  return idbTx((docs, kv)=>{
    if(STORE.docs[p]===undefined) docs.delete(p); else docs.put({d:STORE.docs[p], st:STORE.stempel[p]||null}, p);
    kv.put(STORE.weg, 'weg');
  });
}
async function geaendert(pfad){
  await docSichern(pfad);
  if(!istPunkt(pfad)) HOERER.forEach(f=>{ try{ f(pfad); }catch(e){} });
}

/* ---------- Nachbildung der Artifact-Datenbank ---------- */
function schnappschuss(p){
  const d = STORE.docs[p];
  return { id: p.split('/').pop(), exists: d!==undefined, data: () => clone(d) };
}
const DBAPI = {
  doc(p){
    return {
      async get(){ await BEREIT; return schnappschuss(p); },
      async set(o){
        await BEREIT;
        STORE.docs[p] = clone(o);
        STORE.stempel[p] = {u:Date.now()/1000, dv:geraet()};   // Bruchteile: kein Gleichstand zweier Geräte
        delete STORE.weg[p];
        await geaendert(p);
      },
      async delete(){
        await BEREIT;
        if(STORE.docs[p]!==undefined){
          delete STORE.docs[p]; delete STORE.stempel[p];
          if(!istPunkt(p)) STORE.weg[p] = {u:Date.now()/1000, dv:geraet()};
          await geaendert(p);
        }
      }
    };
  },
  collection(p){
    return {
      async get(){
        await BEREIT;
        const pre = p.replace(/\/+$/,'') + '/';
        const docs = Object.keys(STORE.docs)
          .filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/'))
          .sort().map(schnappschuss);
        return { docs, size:docs.length, empty:!docs.length };
      }
    };
  }
};

/* ---------- Dateien ausgeben ---------- */
const istNativ = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
function plugin(name){
  const C = window.Capacitor; if(!C) return null;
  if(C.Plugins && C.Plugins[name]) return C.Plugins[name];
  try{ return C.registerPlugin ? C.registerPlugin(name) : null; }catch(e){ return null; }
}
async function blobZuB64(blob){
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s=''; for(let i=0;i<buf.length;i+=0x8000) s+=String.fromCharCode.apply(null, buf.subarray(i,i+0x8000));
  return btoa(s);
}
const DOWNLOADS = {
  async save({filename, data}){
    const blob = data instanceof Blob ? data : new Blob([data], {type:'application/octet-stream'});
    if(istNativ()){
      // In der App gibt es keinen Browser-Download: Datei in den App-Cache schreiben und über
      // das Android-Teilen-Menü weitergeben (Drive, OneDrive, Dateien, E-Mail …).
      const FS = plugin('Filesystem'), SH = plugin('Share');
      if(FS && SH){
        const r = await FS.writeFile({path:filename, data:await blobZuB64(blob), directory:'CACHE'});
        await SH.share({title:filename, files:[r.uri], dialogTitle:'Datei speichern oder teilen'});
        return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 30000);
  }
};

/* ---------- window.claude ---------- */
window.claude = {
  async use(name){
    if(name==='db'){ await BEREIT; return DBAPI; }
    if(name==='downloads') return DOWNLOADS;
    return null;
  }
};

/* ---------- Schnittstelle für die App-Teile nach dem Hauptskript ---------- */
window.FUA = {
  STORE, BEREIT, idbGet, idbSet, sichernJetzt, istPunkt, istNativ, plugin, clone,
  spiegelOk: () => SPIEGEL_OK,
  aufAenderung: f => HOERER.push(f),
  /** Einen zusammengeführten Stand übernehmen — Punkte dieses Geräts bleiben stehen. */
  uebernehmen(neu){
    const punkte = {}, pst = {};
    for(const p in STORE.docs) if(istPunkt(p)){ punkte[p]=STORE.docs[p]; pst[p]=STORE.stempel[p]; }
    STORE.docs = Object.assign({}, neu.docs, punkte);
    STORE.stempel = Object.assign({}, neu.stempel, pst);
    STORE.weg = Object.assign({}, neu.weg);
    return sichernJetzt();
  },
  /** Abbild ohne Wiederherstellungspunkte — das, was abgeglichen wird. */
  abbild(){
    const o = {docs:{}, stempel:{}, weg:{}};
    for(const p in STORE.docs) if(!istPunkt(p)){ o.docs[p]=STORE.docs[p]; if(STORE.stempel[p]) o.stempel[p]=STORE.stempel[p]; }
    for(const p in STORE.weg) if(!istPunkt(p)) o.weg[p]=STORE.weg[p];
    return clone(o);
  }
};
})();
