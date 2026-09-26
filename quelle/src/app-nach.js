/* ============================================================
   Finanzübersicht C · Android-App (A1) · Oberfläche der App-Teile
   Läuft NACH dem Hauptskript und nach app-sync.js. Fügt zwei Reiter hinzu —
   „Finanzplan" (die vier Ziele aus der Finanzplanung, live aus den Kontosalden gerechnet) und
   „Abgleich" (OneDrive, Google Drive, Verschlüsselung) — und passt die Kopfzeile an.
   ============================================================ */
(function(){
'use strict';
const FS = window.FUA_SYNC, SY = FS.SY, ST = FS.ST;

/* ---------- Reiter ---------- */
TABS.splice(1, 0, ['plan','Finanzplan']);
TABS.splice(TABS.findIndex(t=>t[0]==='daten'), 0, ['sync','Abgleich']);

/* ---------- Kopfzeile: Zustand des Abgleichs statt „Artifact-Datenbank" ---------- */
const hhmm = d => d ? String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0') : '';
function syncChip(){
  const zl = FS.ziele();
  const tip = t => ` title="${esc(t)}"`;
  if(ST.laeuft) return `<button class="chip" data-act="tab" data-k="sync"${tip('Abgleich läuft')}>gleicht ab …</button>`;
  if(!zl.length) return `<button class="chip" data-act="tab" data-k="sync"${tip('Daten liegen nur auf diesem Gerät — im Reiter Abgleich OneDrive oder Google verbinden')}>nur Gerät</button>`;
  const f = Object.values(ST.fehler);
  if(f.some(e=>e.code==='PASSPHRASE') || (zl.some(z=>z.verschl) && !FS.hatSchluessel()))
    return `<button class="chip alarm" data-act="tab" data-k="sync">Passphrase nötig</button>`;
  if(f.some(e=>e.code==='ANMELDUNG')) return `<button class="chip alarm" data-act="tab" data-k="sync"${tip(ST.meldung)}>Anmeldung nötig</button>`;
  if(ST.meldung==='offline') return `<button class="chip" data-act="tab" data-k="sync"${tip('Kein Netz — Änderungen bleiben auf dem Gerät und gehen beim nächsten Netzkontakt raus')}>offline</button>`;
  if(f.length) return `<button class="chip alarm" data-act="tab" data-k="sync"${tip(ST.meldung)}>Abgleich gestört</button>`;
  if(ST.zuletzt) return `<button class="chip acc" data-act="tab" data-k="sync"${tip('Zuletzt abgeglichen um '+hhmm(ST.zuletzt))}>synchron ${hhmm(ST.zuletzt)}</button>`;
  return `<button class="chip" data-act="tab" data-k="sync">bereit</button>`;
}
renderHeaderStat = function(){
  const h = document.getElementById('hstat'); if(!h) return;
  const off = S.meta ? openMonths() : [];
  const o = off.length ? `<span class="chip open">${off.length} Monat${off.length>1?'e':''} offen</span>` : '';
  h.innerHTML = o + syncChip();
  renderUndoBtns();
};
FS.aufStatus(()=>{ renderHeaderStat(); if(cur==='sync' && !modalOffen()) refresh(); });
const modalOffen = () => { const o=document.getElementById('ov'); return !!(o && o.classList.contains('on')); };

/* ---------- Daten-Reiter: Speicherort beschreiben ---------- */
const datenAlt = V.daten;
V.daten = function(){
  datenAlt();
  document.querySelectorAll('#v .kv').forEach(kv=>{
    const k = kv.querySelector('.k'); if(!k) return;
    if(k.textContent==='Artifact-Datenbank'){ k.textContent='Speicher auf diesem Gerät';
      kv.querySelector('.v').innerHTML = FUA.spiegelOk() ? '<span class="chip closed">IndexedDB</span>' : '<span class="chip alarm">nicht verfügbar</span>'; }
    if(k.textContent==='Pfad in der Datenbank') k.textContent='Pfad im Bestand';
  });
};

/* ============================================================
   Finanzplan — die vier Ziele, live aus den Kontosalden
   Rechenweg wie im Finanzplan vom 21.09.2026 (Monatsverzinsung (1+r)^(1/12)−1, erst Wachstum,
   dann Sparrate; Annuitätenkredite mit Sondertilgung im Dezember). Parameter liegen im Mandanten
   unter state/plan und gleichen sich mit ab.
   ============================================================ */
/* Keine persönlichen Zahlen im Quelltext: Die Web-App liegt öffentlich abrufbar im Netz. Die
   Parameter kommen aus der Datei finanz-stammdaten.json der Finanzplanung (einmal einlesen) und
   liegen danach verschlüsselt im Bestand. PLAN_LEER ist nur das Gerüst. */
const PLAN_LEER = {
  quelle:'eigene Eingabe',
  ruecklage:{ ziel:0, maxMonate:24, anstehend:0, rate:0, konten:[], abzug:[], ersatzIst:0, ersatzAbzug:0 },
  haus:{ zieljahr:new Date().getFullYear()+10, guthaben:[], ersatzGuthaben:0 },
  kredite:[],
  etf:{ konten:[], ersatzStart:0, rate:0, ziel50:0, stichtag50:(new Date().getFullYear()+5)+'-12',
        zielRente:0, stichtagRente:(new Date().getFullYear()+20)+'-12',
        rendite:0.05, szenarien:[0.03,0.05,0.07], inflation:0.02 }
};
/** finanz-stammdaten.json (Finanzplanung) → Parameter des Finanzplans. */
function stammdatenZuPlan(o){
  if(!o || !o.ziele || !o.salden) throw new Error('Das ist keine finanz-stammdaten.json');
  const namen = grp => Object.keys((o.salden||{})[grp]||{}).filter(k=>!k.startsWith('_'));
  const alleSalden = {}; Object.values(o.salden).forEach(g=>{ if(g && typeof g==='object') Object.entries(g).forEach(([k,v])=>{ if(!k.startsWith('_') && typeof v==='number') alleSalden[k]=v; }); });
  const kontoMit = wert => Object.keys(alleSalden).find(k=>Math.abs(alleSalden[k]-wert)<0.005) || '';
  const zr = o.ziele.ruecklage_tagesgeld||{}, zh = o.ziele.haus_3a_schuldenfrei||{}, z3 = o.ziele.etf_50_geburtstag||{}, z4 = o.ziele.etf_renteneintritt||{};
  const sp = (o.plan_sparraten||[])[0]||{}, an = o.annahmen||{};
  const kredite = (zh.umfasst||Object.keys(o.kredite||{})).map(id=>{
    const k = (o.kredite||{})[id]; if(!k) return null;
    const rest = +k.restschuld||0, tj = +k.tilgung_jaehrlich||0;
    const st = +k.sondertilgung_jahr || tj;
    let stAb = +k.sondertilgung_ab_jahr || 0;
    if(!stAb && tj && k.letzte_rate) stAb = +String(k.letzte_rate).slice(0,4) - Math.ceil(rest/tj) + 1;
    return { name:k.bezeichnung||id, konto:kontoMit(-rest), rest, zins:+k.sollzins||0, rate:+k.rate_monatlich||0,
      st, stMonat:+k.sondertilgung_monat||12, stAb:stAb||new Date().getFullYear()+1,
      frei: r2((+k.rate_monatlich||0) + st/12), zinsbindung:k.zinsbindung_bis||'' };
  }).filter(Boolean);
  return {
    quelle:'finanz-stammdaten.json, Stand '+deD(o.stand||''),
    ruecklage:{ ziel:+zr.zielbetrag||0, maxMonate:24, anstehend:+zr.abzug_anstehende_ausgaben||0,
      rate:+sp.ruecklage_monatlich||0, konten:namen('tagesgeld_festgeld'),
      abzug: zr.abzug_kreditkarte ? [kontoMit(-zr.abzug_kreditkarte)].filter(Boolean) : [],
      ersatzIst:+zr.ist_brutto||0, ersatzAbzug:+zr.abzug_kreditkarte||0 },
    haus:{ zieljahr:+zh.zieljahr||PLAN_LEER.haus.zieljahr,
      guthaben: Object.keys(alleSalden).filter(k=>/guthaben/i.test(k) && alleSalden[k]>0),
      ersatzGuthaben: r2((+zh.gesamtschuld||0)-(+zh.gesamtschuld_netto_nach_bausparguthaben||+zh.gesamtschuld||0)) },
    kredite,
    etf:{ konten:z3.basis||[], ersatzStart:+((o.salden.depots||{})._etf_ohne_krypto)||0,
      rate:+sp.etf_monatlich||+((o.sparplaene_etf||{})._summe)||0,
      ziel50:+z3.zielbetrag||0, stichtag50:z3.stichtag||PLAN_LEER.etf.stichtag50,
      zielRente:+z4.zielbetrag||0, stichtagRente:z4.stichtag||(o.person||{}).renteneintritt||PLAN_LEER.etf.stichtagRente,
      rendite:+an.rendite_etf_planwert||0.05, szenarien:an.rendite_etf_szenarien||[0.03,0.05,0.07], inflation:+an.inflation||0.02 }
  };
}
let PLAN = null, PLAN_M = null, PLAN_LAEDT = false, PLAN_DA = false;
const planPfad = () => mP('state/plan');
async function planLaden(){
  PLAN_LAEDT = true;
  try{
    const d = await DB.doc(planPfad()).get();
    PLAN_DA = d.exists;
    PLAN = d.exists ? Object.assign(clone(PLAN_LEER), d.data()) : null;
  }catch(e){ PLAN = null; PLAN_DA = false; }
  PLAN_M = MAND ? MAND.id+'|'+MAND.zweig : '';
  PLAN_LAEDT = false;
}
async function planSpeichern(){ PLAN_DA = true; await DB.doc(planPfad()).set(clone(PLAN)); }
function stammdatenEinlesen(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange=async()=>{
    const fl=inp.files&&inp.files[0]; if(!fl) return;
    try{ PLAN = stammdatenZuPlan(JSON.parse(await fl.text())); await planSpeichern(); refresh(); toast('Stammdaten übernommen'); }
    catch(e){ toast(e.message||'Datei ließ sich nicht lesen','bad'); }
  };
  inp.click();
}

/** Konto im Bestand finden — exakt, sonst ohne Zusatz in Klammern (Excel: „BSpk T03 T08 (Guthaben)"). */
function kontoName(n){
  if(ACC[n]) return n;
  const k = String(n||'').replace(/\s*\([^)]*\)\s*$/,'').trim();
  if(k && ACC[k]) return k;
  const l = k.toLowerCase().replace(/[^a-z0-9äöüß]/g,'');
  return Object.keys(ACC).find(a=>a.toLowerCase().replace(/[^a-z0-9äöüß]/g,'')===l) || null;
}
/** Saldo eines Kontos, falls es im Bestand existiert — sonst null. */
const saldo = n => { const k=kontoName(n); return k ? accBalance(k,'alle') : null; };
function summe(namen){
  let s=0, gef=0; const fehlt=[];
  (namen||[]).forEach(n=>{ const v=saldo(n); if(v==null) fehlt.push(n); else { s+=v; gef++; } });
  return {s:r2(s), gef, fehlt};
}
const monAb = (ym,n) => addM(ym,n);
const mDiff = (a,b) => (+b.slice(0,4)-+a.slice(0,4))*12 + (+b.slice(5,7)-+a.slice(5,7));

/** Kredit bis zur Tilgung rechnen: Zinsen monatlich, Rate monatlich, Sondertilgung im Stichmonat. */
function kreditLauf(k, rest, start){
  let R=rest, ym=start, zins=0, n=0;
  while(R>0.005 && n<600){
    ym=monAb(ym,1); n++;
    const i=R*(k.zins||0)/12; zins+=i; R=R+i-(k.rate||0);
    if(k.st && +ym.slice(5,7)===(k.stMonat||12) && +ym.slice(0,4)>=(k.stAb||0)) R-=k.st;
  }
  return {ende: R<=0.005 ? ym : null, zinsen:r2(zins)};
}
function planRechnen(){
  const P = PLAN, heuteYM = thisYM();
  const o = {start:heuteYM};
  // Ziel 1 — Rücklage
  const rk = summe(P.ruecklage.konten), ab = summe(P.ruecklage.abzug);
  const ist = rk.gef ? rk.s : P.ruecklage.ersatzIst;
  const abzugKarte = ab.gef ? Math.max(0, -ab.s) : P.ruecklage.ersatzAbzug;
  const eff = r2(ist - abzugKarte - (P.ruecklage.anstehend||0));
  const luecke = Math.max(0, r2(P.ruecklage.ziel - eff));
  const mon1 = luecke<=0 ? 0 : (P.ruecklage.rate>0 ? Math.ceil(luecke/P.ruecklage.rate - 1e-9) : Infinity);
  const voll = mon1===Infinity ? null : (mon1===0 ? heuteYM : monAb(heuteYM, mon1));
  o.z1 = {ist, abzugKarte, anstehend:P.ruecklage.anstehend, eff, luecke, monate:mon1, voll, live:!!rk.gef, fehlt:rk.fehlt};
  // Ziel 2 — Haus schuldenfrei
  o.kredite = P.kredite.map(k=>{
    const v = saldo(k.konto);
    const rest = v!=null ? Math.max(0, -v) : k.rest;
    const l = kreditLauf(k, rest, heuteYM);
    const ohne = k.st ? kreditLauf(Object.assign({}, k, {st:0}), rest, heuteYM) : null;
    return Object.assign({}, k, {restIst:r2(rest), live:v!=null, ende:l.ende, zinsen:l.zinsen,
      ersparnis: ohne && ohne.ende ? r2(ohne.zinsen-l.zinsen) : null, endeOhne: ohne?ohne.ende:null});
  });
  const gs = summe(P.haus.guthaben);
  o.z2 = { gesamt:r2(o.kredite.reduce((s,k)=>s+k.restIst,0)), guthaben: gs.gef ? gs.s : P.haus.ersatzGuthaben,
           frei: o.kredite.every(k=>k.ende) ? o.kredite.map(k=>k.ende).sort().slice(-1)[0] : null };
  // Sparratenplan: Grundrate, ab Rücklage voll plus Rücklagerate, nach jeder Tilgung plus freie Rate
  const stufen = [{ab:monAb(heuteYM,1), etf:P.etf.rate, rueck: luecke>0 ? P.ruecklage.rate : 0, grund:'Grundrate; Gehaltsplus in die Rücklage'}];
  const ereig = [];
  if(voll && luecke>0) ereig.push({ab:monAb(voll,1), plus:P.ruecklage.rate, rueckAus:true, grund:'Rücklage voll ('+deM(voll)+') — Gehaltsplus geht ins Depot'});
  o.kredite.forEach(k=>{ if(k.ende && k.frei) ereig.push({ab:monAb(k.ende,1), plus:k.frei, grund:k.name+' getilgt ('+deM(k.ende)+')'}); });
  ereig.sort((a,b)=>a.ab.localeCompare(b.ab));
  let etf=P.etf.rate, rueck=stufen[0].rueck;
  ereig.forEach(e=>{
    etf=r2(etf+e.plus); if(e.rueckAus) rueck=0;
    const l=stufen[stufen.length-1];
    if(l.ab===e.ab){ l.etf=etf; l.rueck=rueck; l.grund+=' · '+e.grund; }
    else stufen.push({ab:e.ab, etf, rueck, grund:e.grund});
  });
  o.stufen = stufen;
  const rateIn = ym => { let r=0; stufen.forEach(s=>{ if(ym>=s.ab) r=s.etf; }); return r; };
  // Ziel 3 und 4 — ETF
  const es = summe(P.etf.konten);
  const start = es.gef ? es.s : P.etf.ersatzStart;
  o.etfStart = start; o.etfLive = !!es.gef;
  const ende = P.etf.stichtagRente;
  o.szen = P.etf.szenarien.map(r=>{
    const i = Math.pow(1+r,1/12)-1;
    let v=start, ym=heuteYM, h50=null, hR=null, v50=null, vR=null; const reihe=[{ym, v}];
    while(ym<ende){
      ym=monAb(ym,1); v=v*(1+i)+rateIn(ym);
      if(!h50 && v>=P.etf.ziel50) h50=ym;
      if(!hR && v>=P.etf.zielRente) hR=ym;
      if(ym===P.etf.stichtag50) v50=v;
      if(ym===ende) vR=v;
      reihe.push({ym, v});
    }
    if(heuteYM>=P.etf.stichtag50) v50=null;
    return {r, h50, hR, v50:v50==null?null:r2(v50), vR:vR==null?null:r2(vR), reihe};
  });
  o.plan = o.szen.find(s=>Math.abs(s.r-P.etf.rendite)<1e-9) || o.szen[Math.floor(o.szen.length/2)];
  const jahre = mDiff(heuteYM, ende)/12;
  o.kaufkraft = f => r2(f/Math.pow(1+P.etf.inflation, jahre));
  // Ampel
  const amp = (termin, stichtag, gelbMon) => !termin ? 'rot' : termin<=stichtag ? 'gruen'
    : (mDiff(stichtag, termin)<=gelbMon ? 'gelb' : 'rot');
  o.ampel = {
    z1: mon1<=P.ruecklage.maxMonate ? 'gruen' : (mon1<=P.ruecklage.maxMonate+12 ? 'gelb' : 'rot'),
    z2: amp(o.z2.frei, P.haus.zieljahr+'-12', 12),
    z3: amp(o.plan.h50, P.etf.stichtag50, 0) === 'gruen' ? 'gruen' : (o.szen.some(s=>s.h50 && s.h50<=P.etf.stichtag50) ? 'gelb' : 'rot'),
    z4: amp(o.plan.hR, P.etf.stichtagRente, 0) === 'gruen' ? 'gruen' : (o.szen.some(s=>s.hR && s.hR<=P.etf.stichtagRente) ? 'gelb' : 'rot')
  };
  return o;
}
const AMPEL = {gruen:['closed','grün'], gelb:['open','gelb'], rot:['alarm','rot']};
const ampChip = a => `<span class="chip ${AMPEL[a][0]}">${AMPEL[a][1]}</span>`;
const pct = r => (r*100).toLocaleString('de-DE',{maximumFractionDigits:1})+' %';
function planKurve(o){
  const W=640, H=230, L=58, R=10, T=12, B=26;
  const reihen=o.szen.map(s=>s.reihe);
  const n=reihen[0].length; if(n<2) return '';
  const max=Math.max(PLAN.etf.zielRente*1.1, ...reihen.map(r=>r[r.length-1].v));
  const x=i=>L+(W-L-R)*i/(n-1), y=v=>T+(H-T-B)*(1-v/max);
  const farbe=['var(--s3)','var(--accent)','var(--s4)'];
  const linien=reihen.map((r,j)=>`<polyline fill="none" stroke="${farbe[j%3]}" stroke-width="${o.szen[j]===o.plan?2.4:1.4}"
     points="${r.filter((_,i)=>i%3===0||i===n-1).map(p=>x(r.indexOf(p)).toFixed(1)+','+y(p.v).toFixed(1)).join(' ')}"/>`).join('');
  const hl=(v,t)=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line2)" stroke-dasharray="4 4"/>
     <text x="${L+4}" y="${y(v)-4}">${t}</text>`;
  const achs=[]; for(let v=0; v<=max; v+=Math.max(100000, Math.round(max/5/100000)*100000))
    achs.push(`<text x="${L-6}" y="${y(v)+3}" text-anchor="end">${(v/1000).toLocaleString('de-DE')} T</text>`);
  const jahr=[]; reihen[0].forEach((p,i)=>{ if(p.ym.endsWith('-01') && +p.ym.slice(0,4)%4===0)
    jahr.push(`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${p.ym.slice(0,4)}</text>`); });
  const i50=reihen[0].findIndex(p=>p.ym===PLAN.etf.stichtag50);
  const v50 = i50>=0 ? `<line x1="${x(i50)}" x2="${x(i50)}" y1="${T}" y2="${H-B}" stroke="var(--line2)" stroke-dasharray="2 3"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"
      aria-label="ETF-Projektion bis ${deM(PLAN.etf.stichtagRente)}">
    <line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" stroke="var(--line2)"/>
    ${achs.join('')}${jahr.join('')}${v50}
    ${hl(PLAN.etf.ziel50, f0(PLAN.etf.ziel50))}${hl(PLAN.etf.zielRente, f0(PLAN.etf.zielRente))}
    ${linien}</svg>
    <div class="legend">${o.szen.map((s,j)=>`<span><i class="dot" style="background:${farbe[j%3]}"></i>${pct(s.r)}${s===o.plan?' (Plan)':''}</span>`).join('')}</div>`;
}
V.plan = function(){
  if(!S.meta){ el().innerHTML='<div class="empty">Noch keine Daten.</div>'; return; }
  const key = MAND ? MAND.id+'|'+MAND.zweig : '';
  if(PLAN_M!==key){
    el().innerHTML='<div class="empty">Finanzplan wird geladen …</div>';
    if(!PLAN_LAEDT) planLaden().then(()=>{ if(cur==='plan') refresh(); });
    return;
  }
  if(!PLAN){
    el().innerHTML = `<div class="ptitle">Finanzplan</div>
      <div class="psub">Die vier Ziele der Finanzplanung, live gerechnet mit den Salden dieses Bestands.</div>
      <div class="panel pad" style="max-width:640px">
        <h3 class="sect">Einrichten</h3>
        <p class="mnote">Lies einmal die Datei <strong>finanz-stammdaten.json</strong> aus der Finanzplanung ein — sie bringt
          Zielbeträge, Stichtage, Kredite, Sparraten und Renditeannahmen mit. Danach liegen die Parameter im Bestand und
          gleichen sich verschlüsselt mit den anderen Geräten ab. Die Datei selbst wird nicht aufbewahrt.</p>
        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:14px">
          <button class="btn" data-fua="stammdaten">Stammdaten einlesen …</button>
          <button class="btn gh" data-fua="planleer">Leer beginnen</button></div>
      </div>`;
    return;
  }
  const o = planRechnen(), P = PLAN;
  const liveHinweis = (live, fehlt) => live ? '' :
    `<div class="mnote">Konten nicht im Bestand gefunden — Wert aus ${esc(P.quelle)}${fehlt&&fehlt.length?': '+esc(fehlt.join(', ')):''}</div>`;
  const kachel = (titel, amp, wert, sub) => `<div class="tile"><div class="lbl">${titel}</div>
    <div class="val">${wert}</div><div class="sub">${ampChip(amp)} ${sub}</div></div>`;
  el().innerHTML = `
  <div class="ptitle">Finanzplan</div>
  <div class="psub">Die vier Ziele, gerechnet mit den heutigen Salden aus diesem Bestand. Parameter aus der
    Finanzplanung (${esc(P.quelle)}), änderbar unter <em>Parameter</em>. Modellrechnung, keine Anlageberatung.</div>

  <div class="tiles" style="margin-bottom:16px">
    ${kachel('Rücklage '+f0(P.ruecklage.ziel), o.ampel.z1, o.z1.voll?deM(o.z1.voll):'—',
      o.z1.luecke>0?`noch ${f0(o.z1.luecke)} · ${o.z1.monate} Mon.`:'erreicht')}
    ${kachel('Haus schuldenfrei '+P.haus.zieljahr, o.ampel.z2, o.z2.frei?deM(o.z2.frei):'—', `Restschuld ${f0(o.z2.gesamt)}`)}
    ${kachel('ETF '+f0(P.etf.ziel50)+' bis '+deM(P.etf.stichtag50), o.ampel.z3, o.plan.h50?deM(o.plan.h50):'—',
      o.plan.v50!=null?`am Stichtag ${f0(o.plan.v50)}`:'Stichtag vorbei')}
    ${kachel('ETF '+f0(P.etf.zielRente)+' bis '+deM(P.etf.stichtagRente), o.ampel.z4, o.plan.hR?deM(o.plan.hR):'—',
      o.plan.vR!=null?`am Stichtag ${f0(o.plan.vR)}`:'')}
  </div>

  <div class="cols c-11">
    <div class="panel pad">
      <h3 class="sect">Ziel 1 · Rücklage auf Tagesgeld</h3>
      <div class="kv"><span class="k">Tages-/Festgeld</span><span class="v">${f(o.z1.ist)}</span></div>
      <div class="kv"><span class="k">− offene Kreditkarte</span><span class="v">${f(o.z1.abzugKarte)}</span></div>
      <div class="kv"><span class="k">− anstehende größere Ausgaben</span><span class="v">${f(o.z1.anstehend)}</span></div>
      <div class="kv"><span class="k"><strong>= verfügbar</strong></span><span class="v ${sgn(o.z1.eff)}"><strong>${f(o.z1.eff)}</strong></span></div>
      <div class="kv"><span class="k">Lücke zum Ziel</span><span class="v">${f(o.z1.luecke)}</span></div>
      <div class="kv"><span class="k">Rate</span><span class="v">${f(P.ruecklage.rate)} / Monat</span></div>
      <div class="kv"><span class="k">voll</span><span class="v">${o.z1.voll?deML(o.z1.voll):'—'}</span></div>
      ${liveHinweis(o.z1.live, o.z1.fehlt)}
    </div>
    <div class="panel pad">
      <h3 class="sect">Ziel 2 · Haus schuldenfrei</h3>
      <div class="tw"><table><thead><tr><th>Verbindlichkeit</th><th class="n">Restschuld</th><th class="n">Zins</th><th>getilgt</th></tr></thead>
      <tbody>${o.kredite.map(k=>`<tr><td>${esc(k.name)}${k.live?'':' <span class="mnote">(Stammdaten)</span>'}</td>
        <td class="n">${f(k.restIst)}</td><td class="n">${pct(k.zins)}</td><td>${k.ende?deM(k.ende):'—'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Gesamt</td><td class="n">${f(o.z2.gesamt)}</td><td></td><td>${o.z2.frei?deM(o.z2.frei):'—'}</td></tr></tfoot></table></div>
      ${o.kredite.filter(k=>k.ersparnis).map(k=>`<p class="mnote" style="margin-top:8px">${esc(k.name)}: Sondertilgung
        ${f0(k.st)} je ${MONL[(k.stMonat||12)-1]} ab ${k.stAb} zieht das Ende von ${deM(k.endeOhne)} auf ${deM(k.ende)}
        und spart ${f(k.ersparnis)} Zinsen${k.zinsbindung?` — ${k.ende<k.zinsbindung?'vor':'nach'} dem Ende der Zinsbindung (${deM(k.zinsbindung)})`:''}.</p>`).join('')}
      <p class="mnote">Bausparguthaben: ${f(o.z2.guthaben)} · netto ${f(o.z2.gesamt-o.z2.guthaben)}</p>
    </div>
  </div>

  <div class="panel pad" style="margin-top:16px">
    <h3 class="sect">Ziel 3 und 4 · ETF-Depot</h3>
    <p class="mnote" style="margin:-4px 0 10px">Startwert ${f(o.etfStart)} (${esc(P.etf.konten.join(' + '))}, ohne Krypto)${o.etfLive?'':' — aus den Stammdaten'}.
      Brutto, vor Vorabpauschale und Abgeltungsteuer.</p>
    ${planKurve(o)}
    <div class="tw" style="margin-top:12px"><table><thead><tr><th>Rendite p. a.</th><th class="n">Wert ${deM(P.etf.stichtag50)}</th>
      <th>${f0(P.etf.ziel50)} erreicht</th><th class="n">Wert ${deM(P.etf.stichtagRente)}</th><th>${f0(P.etf.zielRente)} erreicht</th></tr></thead>
      <tbody>${o.szen.map(s=>`<tr${s===o.plan?' style="font-weight:700"':''}><td>${pct(s.r)}${s===o.plan?' (Plan)':''}</td>
        <td class="n">${s.v50!=null?f(s.v50):'—'}</td><td>${s.h50?deML(s.h50):'—'}</td>
        <td class="n">${s.vR!=null?f(s.vR):'—'}</td><td>${s.hR?deML(s.hR):'—'}</td></tr>`).join('')}</tbody></table></div>
    <p class="mnote" style="margin-top:8px">${f0(P.etf.zielRente)} im ${deML(P.etf.stichtagRente)} entsprechen bei
      ${pct(P.etf.inflation)} Inflation rund ${f0(o.kaufkraft(P.etf.zielRente))} heutiger Kaufkraft; der Planwert
      ${o.plan.vR!=null?f0(o.plan.vR):'—'} rund ${o.plan.vR!=null?f0(o.kaufkraft(o.plan.vR)):'—'}.</p>
  </div>

  <div class="panel pad" style="margin-top:16px">
    <h3 class="sect">Sparratenplan</h3>
    <div class="tw"><table><thead><tr><th>ab</th><th class="n">ETF / Monat</th><th class="n">Rücklage / Monat</th><th>Grund</th></tr></thead>
    <tbody>${o.stufen.map(s=>`<tr><td>${deM(s.ab)}</td><td class="n">${f(s.etf)}</td><td class="n">${f(s.rueck)}</td>
      <td style="white-space:normal;min-width:240px">${esc(s.grund)}</td></tr>`).join('')}</tbody></table></div>
    <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:14px">
      <button class="btn gh" data-fua="planparam">Parameter …</button>
      <button class="btn gh" data-fua="stammdaten">Stammdaten neu einlesen …</button>
    </div>
  </div>`;
};
function planParamModal(){
  const P = PLAN;
  const zahl = (id, lbl, v, step) => `<label class="fld">${lbl}<input type="number" step="${step||'0.01'}" id="pp_${id}" value="${v}"></label>`;
  const txt = (id, lbl, v) => `<label class="fld">${lbl}<input type="text" id="pp_${id}" value="${esc(v)}"></label>`;
  const kontoWahl = (id, lbl, liste) => `<label class="fld full">${lbl}<select id="pp_${id}" multiple size="5" style="height:auto">
    ${accSorted().map(a=>`<option${liste.includes(a.name)?' selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`;
  openModal(`<div class="modal wide">
    <h3>Parameter des Finanzplans</h3>
    <p class="lead">Gilt für den Mandanten ${esc(MAND?MAND.name:'')}. Kontenlisten: mehrere mit Strg/langem Antippen wählen.</p>
    <div class="fg">
      ${zahl('rziel','Rücklage: Ziel', P.ruecklage.ziel)}${zahl('rrate','Rücklage: Rate / Monat', P.ruecklage.rate)}
      ${zahl('ranst','Anstehende größere Ausgaben', P.ruecklage.anstehend)}${zahl('rmax','Rücklage: grün bis (Monate)', P.ruecklage.maxMonate, '1')}
      ${kontoWahl('rkonten','Rücklage: Tagesgeldkonten', P.ruecklage.konten)}
      ${kontoWahl('rabzug','Rücklage: abzuziehende Kreditkarten', P.ruecklage.abzug)}
      ${zahl('hjahr','Haus schuldenfrei bis (Jahr)', P.haus.zieljahr, '1')}<div></div>
      ${P.kredite.map((k,i)=>`<div class="full sect" style="margin:6px 0 -4px">${esc(k.name)} · Konto ${esc(k.konto)}</div>
        ${zahl('kz'+i,'Sollzins (z. B. 0,0238)', k.zins, '0.0001')}${zahl('kr'+i,'Rate / Monat', k.rate)}
        ${zahl('ks'+i,'Sondertilgung / Jahr', k.st)}${zahl('ka'+i,'Sondertilgung ab Jahr', k.stAb, '1')}
        ${zahl('kf'+i,'nach Tilgung frei / Monat', k.frei)}<div></div>`).join('')}
      <div class="full sect" style="margin:6px 0 -4px">ETF</div>
      ${kontoWahl('ekonten','ETF-Depots', P.etf.konten)}
      ${zahl('erate','Grund-Sparrate / Monat', P.etf.rate)}${zahl('erend','Planrendite (z. B. 0,05)', P.etf.rendite, '0.001')}
      ${zahl('ez50','Ziel 3: Betrag', P.etf.ziel50)}${txt('es50','Ziel 3: Stichtag (JJJJ-MM)', P.etf.stichtag50)}
      ${zahl('ezr','Ziel 4: Betrag', P.etf.zielRente)}${txt('esr','Ziel 4: Stichtag (JJJJ-MM)', P.etf.stichtagRente)}
      ${zahl('einfl','Inflation (z. B. 0,02)', P.etf.inflation, '0.001')}
    </div>
    <div class="mact"><div><button class="btn gh" data-act="cancel">Abbrechen</button></div>
      <div class="r"><button class="btn" data-fua="planok">Übernehmen</button></div></div>
  </div>`);
}
async function planParamOk(){
  const n = id => { const v=parseFloat(String(val('pp_'+id)).replace(',','.')); return isNaN(v)?0:v; };
  const multi = id => { const s=document.getElementById('pp_'+id); return s?[...s.selectedOptions].map(o=>o.value):[]; };
  const ym = (id, alt) => /^\d{4}-\d{2}$/.test(val('pp_'+id).trim()) ? val('pp_'+id).trim() : alt;
  const P = PLAN;
  P.ruecklage.ziel=n('rziel'); P.ruecklage.rate=n('rrate'); P.ruecklage.anstehend=n('ranst'); P.ruecklage.maxMonate=Math.round(n('rmax'))||24;
  P.ruecklage.konten=multi('rkonten'); P.ruecklage.abzug=multi('rabzug');
  P.haus.zieljahr=Math.round(n('hjahr'))||P.haus.zieljahr;
  P.kredite.forEach((k,i)=>{ k.zins=n('kz'+i); k.rate=n('kr'+i); k.st=n('ks'+i); k.stAb=Math.round(n('ka'+i)); k.frei=n('kf'+i); });
  P.etf.konten=multi('ekonten'); P.etf.rate=n('erate'); P.etf.rendite=n('erend');
  if(!P.etf.szenarien.some(r=>Math.abs(r-P.etf.rendite)<1e-9)) P.etf.szenarien=[P.etf.rendite-0.02, P.etf.rendite, P.etf.rendite+0.02].map(x=>Math.round(x*1000)/1000);
  P.etf.ziel50=n('ez50'); P.etf.stichtag50=ym('es50', P.etf.stichtag50); P.etf.zielRente=n('ezr'); P.etf.stichtagRente=ym('esr', P.etf.stichtagRente);
  P.etf.inflation=n('einfl');
  closeModal(); await planSpeichern(); refresh(); toast('Parameter übernommen');
}

window.FUA_PLAN = { rechnen:planRechnen, leer:PLAN_LEER, ausStammdaten:stammdatenZuPlan, laden:planLaden,
  get plan(){ return PLAN; }, set plan(v){ PLAN=v; } };

/* ============================================================
   Reiter Abgleich
   ============================================================ */
const zeit = iso => { if(!iso) return '—'; const d=new Date(iso); return deD(iso.slice(0,10))+' '+hhmm(d); };
V.sync = function(){
  const zl = FS.ziele(), e = SY.einst;
  const fehl = id => ST.fehler[id] ? `<div class="note crit" style="margin:8px 0 0">${esc(ST.fehler[id].message)}</div>` : '';
  const tokInfo = t => !t ? '<span class="chip">nicht verbunden</span>'
    : `<span class="chip closed">verbunden</span> ${esc(t.konto||'')}`;
  const nativ = FUA.istNativ();
  el().innerHTML = `
  <div class="ptitle">Abgleich</div>
  <div class="psub">Der Bestand liegt auf diesem Gerät und wird mit OneDrive und Google Drive gleichrangig abgeglichen —
    Datensatz für Datensatz, nach denselben Regeln wie der Austausch mit der lokalen Fassung. In der Cloud liegt er
    <strong>verschlüsselt</strong> (AES-256, Schlüssel aus deiner Passphrase).</div>

  <div class="panel pad" style="margin-bottom:16px">
    <h3 class="sect">Zustand</h3>
    <div class="kv"><span class="k">Abgleich</span><span class="v" style="font-family:var(--sans)">${syncChip()}</span></div>
    <div class="kv"><span class="k">Zuletzt</span><span class="v">${ST.zuletzt?zeit(ST.zuletzt.toISOString()):'in dieser Sitzung noch nicht'}</span></div>
    <div class="kv"><span class="k">Verbundene Speicherorte</span><span class="v">${zl.length?esc(zl.map(z=>z.name).join(', ')):'keine'}</span></div>
    ${ST.fehler.allg?`<div class="note crit" style="margin-top:8px">${esc(ST.fehler.allg.message)}</div>`:''}
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px">
      <input type="checkbox" data-fuachg="auto" ${e.auto?'checked':''}> automatisch abgleichen (beim Öffnen, nach Änderungen, alle 5 Minuten)</label>
    <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:14px">
      <button class="btn" data-fua="jetzt" ${zl.length&&!ST.laeuft?'':'disabled'}>Jetzt abgleichen</button>
    </div>
  </div>

  <div class="cols c-11">
    <div class="panel pad">
      <h3 class="sect">OneDrive</h3>
      <div class="kv"><span class="k">Konto</span><span class="v" style="font-family:var(--sans)">${tokInfo(SY.tok.ms)}</span></div>
      <label class="fld" style="margin-top:10px">Ordner in OneDrive<input type="text" data-fuachg="msordner" value="${esc(e.ms.ordner)}"></label>
      <div class="kv" style="margin-top:8px"><span class="k">Datei</span><span class="v" style="font-family:var(--sans)">${esc(FS.TRESOR_DATEI)}</span></div>
      <div class="kv"><span class="k">Zuletzt geschrieben/gelesen</span><span class="v">${zeit((SY.stand.ms||{}).ok||(SY.stand.ms||{}).ts)}</span></div>
      ${fehl('ms')}
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px">
        <button class="btn${SY.tok.ms?' gh':''}" data-fua="anmelden" data-pid="ms">${SY.tok.ms?'Neu anmelden':'Mit OneDrive verbinden'}</button>
        ${SY.tok.ms?'<button class="btn gh" data-fua="abmelden" data-pid="ms">Trennen</button>':''}
      </div>
    </div>
    <div class="panel pad">
      <h3 class="sect">Google Drive</h3>
      <div class="kv"><span class="k">Konto</span><span class="v" style="font-family:var(--sans)">${tokInfo(SY.tok.g)}</span></div>
      <label class="fld" style="margin-top:10px">Ordner in Google Drive<input type="text" data-fuachg="gordner" value="${esc(e.g.ordner)}"></label>
      <div class="kv" style="margin-top:8px"><span class="k">Datei</span><span class="v" style="font-family:var(--sans)">${esc(FS.TRESOR_DATEI)}</span></div>
      <div class="kv"><span class="k">Zuletzt geschrieben/gelesen</span><span class="v">${zeit((SY.stand.g||{}).ok||(SY.stand.g||{}).ts)}</span></div>
      ${SY.tok.g && SY.tok.g.exp<=Date.now()?'<div class="note warn" style="margin:8px 0 0">Die Google-Anmeldung gilt je eine Stunde. Ein Tippen auf „Neu anmelden" erneuert sie — meist ohne Passworteingabe.</div>':''}
      ${fehl('g')}
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px">
        <button class="btn${SY.tok.g?' gh':''}" data-fua="anmelden" data-pid="g">${SY.tok.g?'Neu anmelden':'Mit Google verbinden'}</button>
        ${SY.tok.g?'<button class="btn gh" data-fua="abmelden" data-pid="g">Trennen</button>':''}
      </div>
      <p class="mnote" style="margin-top:10px">Die App sieht in Google Drive nur den Ordner und die Dateien, die sie selbst anlegt (Berechtigung <em>drive.file</em>).</p>
    </div>
  </div>

  <div class="cols c-11" style="margin-top:16px">
    <div class="panel pad">
      <h3 class="sect">Verschlüsselung</h3>
      <div class="kv"><span class="k">Passphrase</span><span class="v" style="font-family:var(--sans)">${
        !SY.tresor?'<span class="chip alarm">noch nicht festgelegt</span>'
        : FS.hatSchluessel()?'<span class="chip closed">Schlüssel auf diesem Gerät</span>':'<span class="chip alarm">Gerät gesperrt</span>'}</span></div>
      <div class="kv"><span class="k">Verfahren</span><span class="v" style="font-family:var(--sans)">PBKDF2-SHA256 · 600.000 Runden · AES-256-GCM</span></div>
      <div class="note warn" style="margin-top:10px">Es gibt <strong>keinen</strong> Weg zurück, wenn die Passphrase verloren geht —
        weder über Microsoft noch über Google. Schreib sie auf und leg sie in den Finanzen-Ordner. Die Daten auf diesem Gerät
        bleiben davon unberührt, und die Datendatei der lokalen Fassung ist nicht betroffen.</div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px">
        <button class="btn${FS.hatSchluessel()?' gh':''}" data-fua="pass">${!SY.tresor?'Passphrase festlegen …':FS.hatSchluessel()?'Passphrase erneut eingeben …':'Entsperren …'}</button>
        ${FS.hatSchluessel()?'<button class="btn gh" data-fua="sperren">Gerät sperren</button>':''}
        <button class="btn gh" data-fua="tresoroeffnen">Tresordatei entschlüsseln …</button>
      </div>
      <p class="mnote" style="margin-top:10px"><em>Gerät sperren</em> löscht den Schlüssel von diesem Gerät; der Abgleich ruht,
        bis die Passphrase wieder eingegeben wird. <em>Tresordatei entschlüsseln</em> macht aus einer Tagessicherung
        (Ordner <em>Sicherungen</em>) eine Datendatei, die der Daten-Reiter einlesen kann.</p>
    </div>
    <div class="panel pad">
      <h3 class="sect">Lokale Fassung (PC)</h3>
      <p class="mnote" style="margin:-4px 0 10px">Die lokale Fassung auf dem PC führt <strong>${esc(FS.L6_DATEI)}</strong> im
        OneDrive-Ordner — unverschlüsselt. Die App kann diese Datei als dritten Spiegel mitführen; dann sieht der PC,
        was am Handy gebucht wurde, und umgekehrt.</p>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px">
        <input type="checkbox" data-fuachg="l6" ${e.l6.aktiv?'checked':''} ${SY.tok.ms?'':'disabled'}> Datendatei der lokalen Fassung mit abgleichen (Klartext)</label>
      <label class="fld" style="margin-top:10px">Ordner der lokalen Fassung in OneDrive<input type="text" data-fuachg="l6ordner"
        value="${esc(e.l6.ordner)}" placeholder="${esc(e.ms.ordner)} (wie oben)"></label>
      ${fehl('l6')}
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px">
        <button class="btn gh" data-fua="l6lesen" ${SY.tok.ms?'':'disabled'}>Einmal einlesen …</button>
      </div>
      <p class="mnote" style="margin-top:10px"><em>Einmal einlesen</em> öffnet denselben Dialog wie im Daten-Reiter
        (Zusammenführen oder Ersetzen) — der Weg, um den Bestand vom PC zum ersten Mal aufs Handy zu holen.</p>
    </div>
  </div>

  <details class="panel pad" style="margin-top:16px">
    <summary class="sect" style="cursor:pointer;margin:0">Einrichtung (Client-IDs, Weiterleitung)</summary>
    <p class="mnote" style="margin:10px 0">Einmalig in Azure und in der Google Cloud Console anzulegen — siehe Anleitung
      <em>EINRICHTUNG.md</em>. Leer gelassen gelten die Werte aus <em>config.js</em>.</p>
    <div class="fg">
      <label class="fld full">Microsoft Client-ID (Azure-App)<input type="text" data-fuachg="msClientId" value="${esc(e.msClientId||'')}" placeholder="${esc(FS.KONFIG.msClientId||'xxxxxxxx-xxxx-…')}"></label>
      <label class="fld">Microsoft Tenant<input type="text" data-fuachg="msTenant" value="${esc(e.msTenant||'')}" placeholder="${esc(FS.KONFIG.msTenant||'common')}"></label>
      <div></div>
      <label class="fld full">Google Client-ID<input type="text" data-fuachg="googleClientId" value="${esc(e.googleClientId||'')}" placeholder="${esc(FS.KONFIG.googleClientId||'….apps.googleusercontent.com')}"></label>
      <label class="fld full">Weiterleitungsadresse (Redirect-URI)<input type="text" data-fuachg="redirect" value="${esc(e.redirect||'')}" placeholder="${esc(FS.redirectUri())}"></label>
    </div>
    <p class="mnote" style="margin-top:10px">Diese Adresse muss in Azure (Plattform <em>Single-Page-Anwendung</em>) und bei Google
      (<em>Autorisierte Weiterleitungs-URIs</em>) exakt so eingetragen sein. ${nativ?'In der Android-App ist es die Adresse der gehosteten Web-App.':''}
      Gerät: ${esc(GERAET)} · ${nativ?'Android-App':'Web-App'}.</p>
  </details>`;
};

function passModal(){
  const neu = !SY.tresor;
  openModal(`<div class="modal">
    <h3>${neu?'Passphrase festlegen':'Passphrase eingeben'}</h3>
    <p class="lead">${neu?'Mit ihr wird der Bestand verschlüsselt, bevor er in OneDrive und Google Drive landet. Auf jedem weiteren Gerät gibst du dieselbe ein.'
      :'Dieselbe Passphrase wie auf den anderen Geräten.'} Mindestens 10 Zeichen; ein Satz aus mehreren Wörtern ist besser als ein kurzes Passwort.</p>
    <div class="fg">
      <label class="fld full">Passphrase<input type="password" id="fua_p1" autocomplete="new-password"></label>
      <label class="fld full">Wiederholen<input type="password" id="fua_p2" autocomplete="new-password"></label>
    </div>
    <p class="mnote" id="fua_pmeld" style="margin-top:10px"></p>
    <div class="mact"><div><button class="btn gh" data-act="cancel">Abbrechen</button></div>
      <div class="r"><button class="btn" data-fua="passok">Übernehmen</button></div></div>
  </div>`);
}
async function passOk(btn){
  const p1=val('fua_p1'), p2=val('fua_p2'), m=document.getElementById('fua_pmeld');
  if(p1!==p2){ m.textContent='Die beiden Eingaben stimmen nicht überein.'; return; }
  btn.disabled=true; m.textContent='Schlüssel wird abgeleitet und gegen vorhandene Tresore geprüft …';
  try{
    const gab = await FS.passphraseSetzen(p1);
    closeModal(); toast(gab?'Passphrase passt — vorhandener Tresor wird geöffnet':'Passphrase festgelegt');
    FS.abgleichen();
  }catch(e){ btn.disabled=false; m.textContent=e.message; }
}
async function tresorOeffnen(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.fuct,.json,application/json,application/octet-stream';
  inp.onchange=async()=>{
    const fl=inp.files&&inp.files[0]; if(!fl) return;
    try{
      const txt = await FS.tresorZuDatendatei(await fl.text());
      LOKDATEI = {o:JSON.parse(txt), name:fl.name+' (entschlüsselt)'};
      lokImportModal();
    }catch(e){ toast(e.message||'Datei ließ sich nicht öffnen','bad'); }
  };
  inp.click();
}

/* ---------- Ereignisse ---------- */
const FUACT = {
  jetzt: async () => { const b = await FS.abgleichen({trotzDialog:true});
    if(b && b.ok) toast(b.uebernommen?'Abgeglichen — neue Daten übernommen':'Abgeglichen'); else if(b && b.fehler) toast(ST.meldung,'bad'); },
  anmelden: async d => { try{ await FS.anmelden(d.pid); }catch(e){ toast(e.message,'bad'); } },
  abmelden: d => ask({titel:(d.pid==='ms'?'OneDrive':'Google Drive')+' trennen?', ok:'Trennen',
    text:'Die Daten auf diesem Gerät und in der Cloud bleiben liegen; es wird nur nicht mehr abgeglichen.',
    onOk: async()=>{ await FS.abmelden(d.pid); refresh(); }}),
  pass: () => passModal(),
  passok: (d, b) => passOk(b),
  sperren: () => ask({titel:'Gerät sperren?', ok:'Sperren', text:'Der Schlüssel wird von diesem Gerät gelöscht. Der Abgleich ruht, bis die Passphrase wieder eingegeben wird. Die Daten hier bleiben.',
    onOk: async()=>{ await FS.sperren(); refresh(); }}),
  tresoroeffnen: () => tresorOeffnen(),
  l6lesen: async () => {
    try{ toast('Datendatei wird aus OneDrive geholt …'); const o = await FS.l6Holen();
      LOKDATEI = {o, name:FS.L6_DATEI+' (OneDrive)'}; lokImportModal(); }
    catch(e){ toast(e.message,'bad'); }
  },
  planparam: () => planParamModal(),
  planok: () => planParamOk(),
  stammdaten: () => stammdatenEinlesen(),
  planleer: async () => { PLAN = clone(PLAN_LEER); await planSpeichern(); refresh(); planParamModal(); },
  fab: () => { if(S.meta) txnModal(thisYM(), null); }
};
document.addEventListener('click', e=>{
  const a = e.target.closest && e.target.closest('[data-fua]'); if(!a) return;
  const fn = FUACT[a.dataset.fua]; if(!fn) return;
  e.preventDefault(); fn(a.dataset, a, e);
});
document.addEventListener('change', async e=>{
  const t = e.target; const k = t.dataset && t.dataset.fuachg; if(!k) return;
  const v = t.type==='checkbox' ? t.checked : t.value.trim();
  if(k==='auto') SY.einst.auto = v;
  else if(k==='msordner'){ SY.einst.ms.ordner = v || 'Finanzübersicht C'; }
  else if(k==='gordner'){ SY.einst.g.ordner = v || 'Finanzübersicht C'; }
  else if(k==='l6') SY.einst.l6.aktiv = v;
  else if(k==='l6ordner') SY.einst.l6.ordner = v;
  else SY.einst[k] = v;
  await FS.sySichern();
  if(k==='l6' && v) FS.abgleichen();
  toast('Gespeichert');
});

/* ---------- Handy: Schaltfläche für eine neue Buchung ---------- */
const fab = document.createElement('button');
fab.className='fua-fab'; fab.dataset.fua='fab'; fab.title='Neue Buchung'; fab.setAttribute('aria-label','Neue Buchung'); fab.textContent='+';
document.body.appendChild(fab);

/* ---------- Leerer Start: Weg zu den Daten anbieten ---------- */
function leerHinweis(){
  const m = document.getElementById('main');
  if(!m || S.meta || document.getElementById('fua-leer')) return;
  const p = m.querySelector('.panel'); if(!p || !/Noch keine Daten/.test(p.textContent)) return;
  const d = document.createElement('div');
  d.id='fua-leer'; d.className='panel pad'; d.style.cssText='max-width:600px;margin:0 auto 40px';
  d.innerHTML = `<div class="sect">Daten auf dieses Handy holen</div>
    <p class="mnote">Entweder mit OneDrive oder Google Drive verbinden, wo ein anderes Gerät schon einen Tresor abgelegt hat,
      oder die Datendatei der lokalen Fassung einlesen (Reiter <em>Daten</em> → <em>Datendatei einlesen</em>, oder im Reiter
      <em>Abgleich</em> direkt aus OneDrive).</p>
    <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px">
      <button class="btn" data-act="tab" data-k="sync">Abgleich einrichten</button>
      <button class="btn gh" data-act="implokal">Datendatei einlesen …</button></div>`;
  p.after(d);
}

/* ---------- Start ---------- */
(async function(){
  const r = await FS.start();
  FS.nachAnmeldung = pid => {
    toast((pid==='ms'?'OneDrive':'Google Drive')+' verbunden');
    if(!FS.hatSchluessel()){ show('sync'); passModal(); } else { FS.abgleichen(); if(cur==='sync') refresh(); }
  };
  let n=0; const warte = setInterval(()=>{ leerHinweis(); if(++n>40) clearInterval(warte); }, 250);
  if(r.fehler) toast(r.fehler.message,'bad');
  if(r.angemeldet){
    setTimeout(()=>{ show('sync'); FS.nachAnmeldung(r.angemeldet); }, 400);
  } else if(FS.ziele().length) FS.planen(2500);
  renderHeaderStat();
})();

/* ---------- Service Worker (nur Web-App) ---------- */
if(!FUA.istNativ() && 'serviceWorker' in navigator && location.protocol==='https:'){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
})();
