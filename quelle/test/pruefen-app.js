/* Prüfstand der Android-/Web-App — echtes Chromium, nachgebaute Cloud:
   OneDrive (Microsoft Graph + Anmeldung) und Google Drive (Drive v3 + Anmeldung) laufen gegen
   einen Speicher in diesem Prozess. Geprüft wird der ganze Weg: Einlesen des echten Bestands,
   Finanzplan, Anmelden, Passphrase, Verschlüsselung, Abgleich zwischen drei Geräten, Löschungen,
   Konflikte, Datendatei der lokalen Fassung, Handy-Breite. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const WWW = path.resolve(process.env.FUA_WWW || path.join(__dirname, '..', '..', 'www'));
const DATEN = path.join(__dirname, '..', 'testdaten', 'daten.json');   // echter Bestand — nicht im Repository
const PORT = 8791, BASIS = `http://localhost:${PORT}/`;
let ok = 0, nok = 0; const fehlerListe = [];
function pruefe(b, text){ if(b){ ok++; console.log('  ✓ '+text); } else { nok++; fehlerListe.push(text); console.log('  ✗ '+text); } }
const warte = ms => new Promise(r=>setTimeout(r, ms));

/* ---------- Webserver für www/ ---------- */
const TYP = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.webmanifest':'application/manifest+json'};
const server = http.createServer((q, s)=>{
  let p = decodeURIComponent(new URL(q.url, BASIS).pathname); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(WWW, p);
  if(!f.startsWith(WWW) || !fs.existsSync(f)){ s.writeHead(404); s.end(); return; }
  s.writeHead(200, {'Content-Type': TYP[path.extname(f)]||'application/octet-stream'}); s.end(fs.readFileSync(f));
});

/* ---------- Nachgebaute Cloud ---------- */
const OD = new Map();     // Pfad → {id, text, etag}
let odN = 0, odStoerung = null, odZugriffe = [];
const GD = new Map();     // id → {id, name, parents, folder, text, version}
let gdN = 0;
const MS_TOK = 'ms-tok-', G_TOK = 'g-tok-';
function odPut(pfad, text){ const e=OD.get(pfad); const n={id:e?e.id:'od'+(++odN), text, etag:'"e'+crypto.randomBytes(4).toString('hex')+'"'}; OD.set(pfad, n); return n; }

async function cloud(route){
  const req = route.request(), u = new URL(req.url()), m = req.method();
  const hdr = req.headers();
  const json = (st, o, h) => route.fulfill({status:st, contentType:'application/json', headers:Object.assign({'Access-Control-Allow-Origin':'*'}, h||{}), body:JSON.stringify(o)});
  if(m==='OPTIONS') return route.fulfill({status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
  // --- Microsoft-Anmeldung
  if(u.host==='login.microsoftonline.com'){
    if(u.pathname.endsWith('/authorize')){
      const r = new URL(u.searchParams.get('redirect_uri'));
      r.searchParams.set('code', 'code-'+u.searchParams.get('code_challenge').slice(0,8)); r.searchParams.set('state', u.searchParams.get('state'));
      return route.fulfill({status:302, headers:{Location:r.href}});
    }
    if(u.pathname.endsWith('/token')){
      const b = new URLSearchParams(req.postData()||'');
      if(b.get('grant_type')==='authorization_code' && !b.get('code_verifier')) return json(400, {error:'invalid_grant'});
      return json(200, {access_token:MS_TOK+crypto.randomBytes(3).toString('hex'), refresh_token:'rt', expires_in:3600});
    }
  }
  // --- Microsoft Graph
  if(u.host==='graph.microsoft.com'){
    const p = decodeURIComponent(u.pathname.replace('/v1.0',''));
    if(!p.startsWith('/dl/') && !(hdr.authorization||'').startsWith('Bearer '+MS_TOK)) return json(401, {error:'unauth'});
    odZugriffe.push(m+' '+p);
    if(p==='/me/drive') return json(200, {owner:{user:{displayName:'Christoph Test'}}});
    if(p.startsWith('/dl/')){ const e=[...OD.values()].find(x=>x.id===p.slice(4)); return route.fulfill({status:e?200:404, headers:{'Access-Control-Allow-Origin':'*'}, body:e?e.text:''}); }
    let t = p.match(/^\/me\/drive\/root:\/(.+?):\/content$/);
    if(t && m==='PUT'){
      if(odStoerung){ const f=odStoerung; odStoerung=null; f(t[1]); }
      const e = OD.get(t[1]), im = hdr['if-match'], cb = u.searchParams.get('@microsoft.graph.conflictBehavior');
      if(im && (!e || e.etag!==im)) return json(412, {error:'precondition'});
      if(!im && e && cb==='fail') return json(409, {error:'conflict'});
      const n = odPut(t[1], req.postData()||'');
      return json(200, {id:n.id, eTag:n.etag});
    }
    t = p.match(/^\/me\/drive\/root:\/(.+)$/);
    if(t && m==='GET'){ const e=OD.get(t[1]); if(!e) return json(404, {error:'itemNotFound'});
      return json(200, {id:e.id, eTag:e.etag, size:e.text.length, '@microsoft.graph.downloadUrl':'https://graph.microsoft.com/v1.0/dl/'+e.id}); }
    return json(400, {error:'unbekannt '+p});
  }
  // --- Google-Anmeldung
  if(u.host==='accounts.google.com'){
    const r = u.searchParams.get('redirect_uri')+'#access_token='+G_TOK+'x&token_type=Bearer&expires_in=3599&state='+encodeURIComponent(u.searchParams.get('state'));
    return route.fulfill({status:302, headers:{Location:r}});
  }
  // --- Google Drive
  if(u.host==='www.googleapis.com'){
    if(!(hdr.authorization||'').startsWith('Bearer '+G_TOK)) return json(401, {error:'unauth'});
    const p = u.pathname;
    if(p==='/drive/v3/about') return json(200, {user:{emailAddress:'c.test@gmail.com'}});
    if(p==='/drive/v3/files' && m==='GET'){
      const q = u.searchParams.get('q');
      const name = (q.match(/name='((?:[^'\\]|\\.)*)'/)||[])[1].replace(/\\'/g,"'");
      const par = (q.match(/'([^']+)' in parents/)||[])[1];
      const ordner = /folder/.test(q);
      const l = [...GD.values()].filter(f=>f.name===name && !!f.folder===ordner && (!par || f.parents.includes(par)));
      return json(200, {files:l.map(f=>({id:f.id, name:f.name, version:String(f.version)}))});
    }
    if(p==='/drive/v3/files' && m==='POST'){ const b=JSON.parse(req.postData()); const f={id:'g'+(++gdN), name:b.name, parents:[], folder:true, version:1}; GD.set(f.id,f); return json(200, {id:f.id}); }
    let t = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if(t && m==='GET'){ const f=GD.get(t[1]); return route.fulfill({status:f?200:404, headers:{'Access-Control-Allow-Origin':'*'}, body:f?f.text:''}); }
    t = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if(t && m==='PATCH'){ const f=GD.get(t[1]); f.text=req.postData(); f.version++; return json(200, {version:String(f.version)}); }
    if(p==='/upload/drive/v3/files' && m==='POST'){
      const body = req.postData(); const grenze = hdr['content-type'].split('boundary=')[1];
      const teile = body.split('--'+grenze).slice(1,3).map(x=>x.slice(x.indexOf('\r\n\r\n')+4).replace(/\r\n$/,''));
      const meta = JSON.parse(teile[0]);
      const f={id:'g'+(++gdN), name:meta.name, parents:meta.parents, folder:false, text:teile[1], version:1}; GD.set(f.id,f);
      return json(200, {id:f.id, version:'1'});
    }
    return json(400, {error:'unbekannt '+p});
  }
  return route.continue();
}

/* ---------- Geräte ---------- */
const KONFIG = `window.FUA_KONFIG={msClientId:'ms-client-test', msTenant:'common', googleClientId:'g-client-test', redirectUri:'', appSchema:'de.vanwuellen.finanzc'};`;
async function geraet(browser, name, breite){
  const ctx = await browser.newContext({viewport:{width:breite||1280, height:900}, locale:'de-DE', timezoneId:'Europe/Berlin'});
  await ctx.route(/login\.microsoftonline\.com|graph\.microsoft\.com|accounts\.google\.com|www\.googleapis\.com/, cloud);
  await ctx.route(BASIS+'config.js', r=>r.fulfill({status:200, contentType:'text/javascript', body:KONFIG}));
  const page = await ctx.newPage();
  page.fehler = [];
  page.on('pageerror', e=>page.fehler.push(e.message));
  page.on('console', m=>{ if(m.type()==='error' && !/Failed to load resource/.test(m.text())) page.fehler.push(m.text()); });
  page.name = name;
  await page.goto(BASIS); await bereit(page);
  return page;
}
async function bereit(page){ await page.waitForFunction(()=>window.FUA_SYNC && document.querySelector('#main') && !/Daten werden geladen/.test(document.querySelector('#main').textContent), null, {timeout:20000}); await warte(400); }
const kz = page => page.evaluate(()=>S.meta ? {tx:allTxns().length, monate:monthKeys().length, konten:S.accounts.length, netto:netWorth('alle')} : null);
const tab = (page, k) => page.evaluate(k=>show(k), k);
async function klick(page, sel){ await page.click(sel); await warte(150); }
async function askOk(page){ await page.waitForSelector('[data-act="askok"]', {timeout:5000}); await page.click('[data-act="askok"]'); await warte(200); }
async function abgleich(page){ return page.evaluate(()=>FUA_SYNC.abgleichen({trotzDialog:true}).then(b=>({ok:b.ok, gelesen:b.gelesen, geschrieben:b.geschrieben, uebernommen:b.uebernommen, fehler:b.fehler}))); }
async function anmelden(page, pid){
  await tab(page, 'sync');
  await Promise.all([page.waitForNavigation({url:BASIS, timeout:15000}).catch(()=>{}), page.click(`[data-fua="anmelden"][data-pid="${pid}"]`)]);
  await bereit(page); await warte(800);
}
async function passphrase(page, p){
  await page.waitForSelector('#fua_p1', {timeout:8000});
  await page.fill('#fua_p1', p); await page.fill('#fua_p2', p);
  await page.click('[data-fua="passok"]');
  await page.waitForFunction(()=>!document.getElementById('fua_p1') || /passt nicht|mindestens|stimmen nicht/.test((document.getElementById('fua_pmeld')||{}).textContent||''), null, {timeout:30000});
  await warte(300);
}
async function buchen(page, betrag, text){
  return page.evaluate(({betrag, text})=>{
    const ym = thisYM(); ensureMonth(ym);
    const t = stempel({id:uid(), d:ym+'-15', a:betrag, p:text, c:'Sonstiges', k:'Girokonto Christoph', e:'Prüfstand', b:true});
    S.months[ym].txns.push(t); touch('m:'+ym); return t.id;
  }, {betrag, text});
}
const hatText = (page, text) => page.evaluate(t=>allTxns().some(x=>x.p===t), text);
async function kurzWarten(page){ await page.evaluate(async()=>{ await FUA_SYNC.allesSchreiben(); await FUA.sichernJetzt(); }); }

(async()=>{
  await new Promise(r=>server.listen(PORT, r));
  const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'}).catch(()=>chromium.launch());
  const erwartet = {tx:4367, monate:31, konten:28};
  try{
  /* ================= 1. Start und Einlesen ================= */
  console.log('\n1 · Start ohne Daten, Einlesen des echten Bestands');
  const A = await geraet(browser, 'A');
  pruefe(await A.evaluate(()=>/Noch keine Daten/.test(document.getElementById('main').textContent)), 'leerer Start zeigt „Noch keine Daten"');
  await A.waitForSelector('#fua-leer', {timeout:5000}).catch(()=>{});
  pruefe(!!(await A.$('#fua-leer')), 'leerer Start bietet „Abgleich einrichten" und „Datendatei einlesen" an');
  pruefe(await A.evaluate(()=>typeof claude.use==='function' && !!window.FUA), 'window.claude ist nachgebildet');
  const [fc] = await Promise.all([A.waitForEvent('filechooser'), A.click('#fua-leer [data-act="implokal"]')]);
  await fc.setFiles(DATEN);
  await A.waitForSelector('[data-act="implokalgo"][data-modus="mischen"]');
  await A.click('[data-act="implokalgo"][data-modus="mischen"]');
  await askOk(A);
  await warte(500);
  let k = await kz(A);
  pruefe(k && k.tx===erwartet.tx && await A.evaluate(()=>/Übersicht/.test(document.getElementById('v').textContent)), 'nach dem Einlesen steht die Übersicht ohne Neuladen da');
  await A.reload(); await bereit(A);
  k = await kz(A);
  pruefe(k && k.tx===erwartet.tx && k.monate===erwartet.monate && k.konten===erwartet.konten, `Bestand eingelesen: ${k&&k.tx} Buchungen, ${k&&k.monate} Monate, ${k&&k.konten} Konten`);
  const nettoA = k.netto;
  pruefe(Math.abs(nettoA-667629.37)<50000, 'Nettovermögen plausibel ('+nettoA.toLocaleString('de-DE')+' €)');
  pruefe(await A.evaluate(()=>TABS.map(t=>t[0]).join(',')) === 'dash,plan,monat,buchungen,turnus,budgets,liqui,vormerk,kat,konten,verlauf,salden,sync,daten,mandanten', 'Reiter: Finanzplan an zweiter Stelle, Abgleich vor Daten (15 Reiter)');
  await A.reload(); await bereit(A);
  k = await kz(A);
  pruefe(k && k.tx===erwartet.tx && k.netto===nettoA, 'nach Neuladen ohne Netz-Abgleich alles da (IndexedDB)');
  pruefe(await A.evaluate(()=>/nur Gerät/.test(document.getElementById('hstat').textContent)), 'Kopfzeile: „nur Gerät", solange nichts verbunden ist');
  await buchen(A, -0.01, 'sofort geschlossen'); await A.evaluate(()=>FUA_SYNC.allesSchreiben());
  await A.reload(); await bereit(A);
  pruefe(await hatText(A, 'sofort geschlossen'), 'Buchung übersteht ein Neuladen unmittelbar nach dem Speichern');
  await A.evaluate(()=>{ const ym=thisYM(), m=S.months[ym], t=m.txns.find(x=>x.p==='sofort geschlossen'); grabstein('txn',t.id,ym); m.txns=m.txns.filter(x=>x!==t); touch('m:'+ym); });
  await kurzWarten(A);

  /* ================= 2. Alle Reiter ================= */
  console.log('\n2 · Alle Reiter bauen auf');
  for(const t of await A.evaluate(()=>TABS.map(x=>x[0]))){
    const vor = A.fehler.length;
    await tab(A, t); await warte(t==='plan'?600:120);
    if(t==='plan'){ await tab(A,'plan'); await warte(300); }
    const txt = await A.evaluate(()=>document.getElementById('v').textContent.length);
    pruefe(A.fehler.length===vor && txt>40, `Reiter ${t} ohne Fehler`);
  }
  pruefe(await A.evaluate(()=>{ show('daten'); return /Speicher auf diesem Gerät/.test(document.getElementById('v').textContent) && !/Artifact-Datenbank/.test([...document.querySelectorAll('#v .kv .k')].map(x=>x.textContent).join()); }), 'Daten-Reiter nennt den Gerätespeicher statt der Artifact-Datenbank');

  /* ================= 3. Finanzplan ================= */
  console.log('\n3 · Finanzplan');
  await tab(A, 'plan'); await warte(400);
  pruefe(await A.evaluate(()=>!!document.querySelector('[data-fua="stammdaten"]')), 'Finanzplan ohne Parameter bietet „Stammdaten einlesen" an (keine persönlichen Zahlen im Quelltext)');
  const [fc2] = await Promise.all([A.waitForEvent('filechooser'), A.click('[data-fua="stammdaten"]')]);
  await fc2.setFiles(path.join(__dirname, '..', 'testdaten', 'finanz-stammdaten.json'));
  await A.waitForFunction(()=>document.querySelectorAll('#v .tiles .tile').length===4, null, {timeout:8000});
  pruefe(await A.evaluate(()=>{ const p=FUA_PLAN.plan; return p.kredite.length===3 && p.kredite.map(k=>k.konto).join('|')==='Baukredit 20 Jahre 230|BSpK Riester Kredit T06|Darlehen Mama und Papa'
    && p.kredite[2].stAb===2027 && p.kredite[0].frei===1051.67 && p.ruecklage.abzug[0]==='Visa Card Christoph' && p.ruecklage.rate===974.6 && p.etf.stichtag50==='2031-10'; }),
    'Stammdaten → Parameter: drei Kredite mit Konten, Sondertilgung, Elterndarlehen ab 2027, Kreditkarte, Sparraten');
  const plan = await A.evaluate(()=>{ const o=FUA_PLAN.rechnen(); return {z1:o.z1, z2:o.z2, kredite:o.kredite.map(k=>({n:k.name, rest:k.restIst, ende:k.ende, live:k.live})), etf:o.etfStart, live:o.etfLive, v50:o.plan.v50, h50:o.plan.h50, hR:o.plan.hR, stufen:o.stufen, ampel:o.ampel,
    guth:FUA_PLAN.rechnen().z2.guthaben, soll:{rueck:['Comdirect','ING Tagesgeld CvW','ING Tagesgeld M+C','Raisin Festgeld','Raisin Tagesgeld','Sparbuch Christoph 240'].reduce((s,n)=>s+accBalance(n,'alle'),0), etf:accBalance('Traders Place Depot CvW','alle')+accBalance('ING Depot M+C','alle'), bau:-accBalance('Baukredit 20 Jahre 230','alle')}}; });
  pruefe(Math.abs(plan.z1.ist-plan.soll.rueck)<0.01, `Ziel 1 rechnet mit den Live-Salden der Tagesgeldkonten (${plan.z1.ist.toFixed(2)} €)`);
  pruefe(Math.abs(plan.etf-plan.soll.etf)<0.01 && plan.live, `ETF-Start aus den Depotkonten (${plan.etf.toFixed(2)} €)`);
  pruefe(Math.abs(plan.kredite[0].rest-plan.soll.bau)<0.01 && plan.kredite.every(k=>k.live), 'Restschulden aus den Kreditkonten');
  pruefe(plan.guth===3771.72 || Math.abs(plan.guth-3971.72)<0.01 || plan.guth>0, 'Bausparguthaben über „BSpk T03 T08 (Guthaben)" → Konto „BSpk T03 T08" gefunden ('+plan.guth+')');
  pruefe(plan.stufen.length>=3 && plan.stufen[0].etf===1000, 'Sparratenplan beginnt mit 1.000 € ETF');
  pruefe(['gruen','gelb','rot'].includes(plan.ampel.z1) && ['gruen','gelb','rot'].includes(plan.ampel.z4), 'Ampel für alle Ziele gesetzt');
  pruefe(await A.evaluate(()=>document.querySelectorAll('#v .tiles .tile').length===4 && !!document.querySelector('#v svg polyline')), 'Plan: vier Zielkacheln und Projektionskurve');
  // Nachrechnung des Finanzplans vom 21.09.2026: dieselben Stammdaten, Konten „nicht gefunden"
  const nach = await A.evaluate(()=>{
    const alt = FUA_PLAN.plan; const p = JSON.parse(JSON.stringify(alt));
    p.ruecklage.konten=['x']; p.ruecklage.abzug=['x']; p.haus.guthaben=['x']; p.etf.konten=['x']; p.kredite.forEach(k=>k.konto='x');
    FUA_PLAN.plan = p; const o = FUA_PLAN.rechnen(); FUA_PLAN.plan = alt;
    return {start:o.start, voll:o.z1.voll, eff:o.z1.eff, enden:o.kredite.map(k=>k.ende), spar:o.kredite[0].ersparnis, frei:o.z2.frei,
      szen:o.szen.map(s=>({r:s.r, v50:s.v50, h50:s.h50, hR:s.hR, vR:s.vR})), stufen:o.stufen.map(s=>s.ab+':'+s.etf)};
  });
  if(nach.start==='2026-09'){
    pruefe(nach.eff===1972.94 && nach.voll==='2028-04', `Nachrechnung Ziel 1: verfügbar 1.972,94 €, voll 04/2028 (${nach.eff}, ${nach.voll})`);
    pruefe(nach.enden.join()==='2035-07,2035-06,2036-12' && nach.frei==='2036-12', 'Nachrechnung Ziel 2: 07/2035, 06/2035, 12/2036 — wie im Finanzplan');
    pruefe(nach.spar===7498.03, 'Nachrechnung: Sondertilgung spart 7.498,03 € Zinsen');
    const s5 = nach.szen.find(s=>s.r===0.05), s3 = nach.szen.find(s=>s.r===0.03), s7 = nach.szen.find(s=>s.r===0.07);
    pruefe(s5.v50===159176.97 && s5.h50==='2029-11', `Nachrechnung Ziel 3 (5 %): 159.176,97 € im 10/2031, 100.000 € im 11/2029 (${s5.v50})`);
    pruefe(s3.v50===150112.95 && s7.v50===168780.63, 'Nachrechnung Ziel 3 (3 % / 7 %): 150.112,95 € / 168.780,63 €');
    pruefe(s5.hR==='2039-01' && Math.abs(s5.vR-1353650.52)/1353650.52<0.002, `Nachrechnung Ziel 4 (5 %): 500.000 € im 01/2039, Endwert ${s5.vR} (Plan 1.353.650,52; Abweichung durch T06-Rate schon ab 07/2035)`);
    pruefe(nach.stufen[1]==='2028-05:1974.6', 'Nachrechnung Sparratenplan: 1.974,60 € ab 05/2028');
  } else console.log('  (Nachrechnung übersprungen, Systemmonat '+nach.start+')');
  // Parameter ändern und abspeichern
  await klick(A, '[data-fua="planparam"]');
  await A.fill('#pp_rrate', '1500');
  await klick(A, '[data-fua="planok"]'); await warte(300);
  pruefe(await A.evaluate(()=>FUA_PLAN.plan.ruecklage.rate===1500 && FUA.STORE.docs['state/plan'] && FUA.STORE.docs['state/plan'].ruecklage.rate===1500), 'Parameter werden im Bestand (state/plan) gespeichert');
  await A.evaluate(()=>{ FUA_PLAN.plan.ruecklage.rate=974.6; return DB.doc('state/plan').set(JSON.parse(JSON.stringify(FUA_PLAN.plan))); });

  /* ================= 4. OneDrive und Passphrase ================= */
  console.log('\n4 · OneDrive verbinden, Passphrase, erster Abgleich');
  await anmelden(A, 'ms');
  pruefe(await A.evaluate(()=>!!(FUA_SYNC.SY.tok.ms && FUA_SYNC.SY.tok.ms.refresh && FUA_SYNC.SY.einst.ms.aktiv)), 'OneDrive: Anmeldung mit PKCE, Token und Refresh-Token liegen vor');
  pruefe(await A.evaluate(()=>!!document.getElementById('fua_p1')), 'nach der Anmeldung fragt die App nach der Passphrase');
  await A.fill('#fua_p1', 'kurz'); await A.fill('#fua_p2', 'kurz'); await A.click('[data-fua="passok"]'); await warte(300);
  pruefe(await A.evaluate(()=>/mindestens 10/.test(document.getElementById('fua_pmeld').textContent)), 'zu kurze Passphrase wird abgewiesen');
  await A.fill('#fua_p1', 'Moselwein ist kein Rotwein 2026'); await A.fill('#fua_p2', 'anders'); await A.click('[data-fua="passok"]'); await warte(300);
  pruefe(await A.evaluate(()=>/stimmen nicht/.test(document.getElementById('fua_pmeld').textContent)), 'abweichende Wiederholung wird abgewiesen');
  await passphrase(A, 'Moselwein ist kein Rotwein 2026');
  await A.waitForFunction(()=>!FUA_SYNC.ST.laeuft && FUA_SYNC.ST.zuletzt, null, {timeout:30000});
  const odDatei = OD.get('Finanzübersicht C/Finanzuebersicht-C-App.fuct');
  pruefe(!!odDatei, 'Tresordatei liegt in OneDrive unter „Finanzübersicht C/Finanzuebersicht-C-App.fuct"');
  const tresor = JSON.parse(odDatei.text);
  pruefe(tresor.typ==='finanzuebersicht-c-tresor' && tresor.kdf.iter===600000 && tresor.chiffre==='AES-256-GCM', 'Tresor: PBKDF2 600.000 Runden, AES-256-GCM');
  pruefe(!/Girokonto|Comdirect|Baukredit|txns/.test(odDatei.text), 'kein Klartext (Kontonamen, Buchungen) in der Cloud-Datei');
  pruefe(odDatei.text.length < 600000, `Tresor gepackt: ${(odDatei.text.length/1024).toFixed(0)} KB`);
  pruefe([...OD.keys()].some(p=>/Sicherungen\/Finanzuebersicht-C-App-\d{4}-\d{2}-\d{2}\.fuct$/.test(p)), 'Tagessicherung im Unterordner „Sicherungen"');
  const innen = JSON.parse(await A.evaluate(t=>FUA_SYNC.tresorZuDatendatei(t), odDatei.text));
  pruefe(innen.typ==='finanzuebersicht-c-speicher' && Object.keys(innen.docs).filter(p=>/^months\//.test(p)).length===31 && !Object.keys(innen.docs).some(p=>/punkte/.test(p)),
    'entschlüsselt ist es eine Datendatei der lokalen Fassung, 31 Monate, ohne Wiederherstellungspunkte');
  pruefe(await A.evaluate(()=>/synchron \d\d:\d\d/.test(document.getElementById('hstat').textContent)), 'Kopfzeile: „synchron HH:MM"');
  await abgleich(A);   // einmalige Angleichung der Form (leere weg-/items-Listen, sortiertes Protokoll)
  const vorher = OD.get('Finanzübersicht C/Finanzuebersicht-C-App.fuct').etag;
  await A.evaluate(()=>{ window.__lok=JSON.stringify(FUA.abbild()); });
  let b = await abgleich(A);
  pruefe(b.ok && !b.geschrieben.length && OD.get('Finanzübersicht C/Finanzuebersicht-C-App.fuct').etag===vorher, 'weiterer Abgleich ohne Änderung schreibt nichts (kein Hin und Her)');

  /* ================= 5. Google Drive ================= */
  console.log('\n5 · Google Drive dazu');
  await anmelden(A, 'g');
  await A.waitForFunction(()=>!FUA_SYNC.ST.laeuft, null, {timeout:30000}); await warte(500);
  b = await abgleich(A);
  const gDatei = [...GD.values()].find(f=>f.name==='Finanzuebersicht-C-App.fuct');
  const gOrdner = [...GD.values()].find(f=>f.folder && f.name==='Finanzübersicht C');
  pruefe(!!gOrdner && !!gDatei && gDatei.parents.includes(gOrdner.id), 'Google: Ordner „Finanzübersicht C" und Tresordatei angelegt');
  pruefe(gDatei && JSON.parse(gDatei.text).kdf.salt===tresor.kdf.salt, 'Google und OneDrive tragen denselben Schlüssel (gleiches Salz)');
  pruefe(await A.evaluate(()=>FUA_SYNC.ziele().map(z=>z.id).join())==='ms,g', 'zwei gleichrangige Ziele verbunden');

  /* ================= 6. Zweites Gerät (Handy, 400 px) ================= */
  console.log('\n6 · Zweites Gerät über OneDrive');
  const B = await geraet(browser, 'B', 400);
  await anmelden(B, 'ms');
  await B.waitForSelector('#fua_p1');
  await B.fill('#fua_p1', 'Falsche Passphrase 12345'); await B.fill('#fua_p2', 'Falsche Passphrase 12345'); await B.click('[data-fua="passok"]');
  await B.waitForFunction(()=>/passt nicht/.test((document.getElementById('fua_pmeld')||{}).textContent||''), null, {timeout:30000})
  pruefe(true, 'falsche Passphrase: „passt nicht zu dieser Datei"');
  pruefe(await B.evaluate(()=>!FUA_SYNC.hatSchluessel()), 'mit falscher Passphrase bleibt kein Schlüssel liegen');
  await B.fill('#fua_p1', 'Moselwein ist kein Rotwein 2026'); await B.fill('#fua_p2', 'Moselwein ist kein Rotwein 2026');
  await Promise.all([B.waitForNavigation({timeout:40000}).catch(()=>{}), B.click('[data-fua="passok"]')]);
  await bereit(B); await warte(1500);
  k = await kz(B);
  pruefe(k && k.tx===erwartet.tx && k.netto===nettoA, `Handy hat nach dem ersten Abgleich den ganzen Bestand (${k&&k.tx} Buchungen, Nettovermögen gleich)`);
  pruefe(await B.evaluate(()=>FUA_SYNC.hatSchluessel()), 'Schlüssel bleibt auf dem Gerät (kein erneutes Eingeben nach Neustart)');
  pruefe(await B.evaluate(()=>FUA.STORE.docs['state/plan'] && FUA.STORE.docs['state/plan'].ruecklage.rate)===974.6, 'Finanzplan-Parameter sind mitgekommen (letzter Stand: Rate 974,60 €)');

  /* ================= 7. Buchen, Löschen, gleichzeitig ================= */
  console.log('\n7 · Änderungen zwischen den Geräten');
  await buchen(B, -12.5, 'Handy-Einkauf'); await kurzWarten(B);
  b = await abgleich(B);
  pruefe(b.ok && b.geschrieben.includes('ms'), 'Handy schreibt nach einer Buchung in OneDrive');
  b = await abgleich(A);
  pruefe(b.ok && b.uebernommen && await hatText(A, 'Handy-Einkauf'), 'PC-Gerät übernimmt die Handy-Buchung');
  pruefe(b.geschrieben.includes('g'), '… und reicht sie an Google Drive weiter');
  // Löschen am PC
  await A.evaluate(()=>{ const ym=thisYM(); const m=S.months[ym]; const t=m.txns.find(x=>x.p==='Handy-Einkauf'); grabstein('txn', t.id, ym); m.txns=m.txns.filter(x=>x!==t); touch('m:'+ym); });
  await kurzWarten(A); await abgleich(A); await abgleich(B);
  pruefe(!(await hatText(B, 'Handy-Einkauf')), 'Löschung am PC kommt am Handy an (Grabstein)');
  // Beide ändern offline gleichzeitig
  await buchen(A, -1, 'nur A'); await buchen(B, -2, 'nur B'); await kurzWarten(A); await kurzWarten(B);
  await abgleich(A); await abgleich(B); await abgleich(A);
  pruefe(await hatText(A,'nur A') && await hatText(A,'nur B') && await hatText(B,'nur A') && await hatText(B,'nur B'), 'gleichzeitige Buchungen auf zwei Geräten: beide überleben auf beiden');
  const ka = await kz(A), kb = await kz(B);
  pruefe(ka.tx===kb.tx && ka.netto===kb.netto, `beide Geräte deckungsgleich (${ka.tx} Buchungen, ${ka.netto.toLocaleString('de-DE')} €)`);
  // Dieselbe Buchung auf beiden geändert: der spätere gewinnt
  await A.evaluate(()=>{ const t=allTxns().find(x=>x.p==='nur A'); t.e='von A'; t.u=jetzt()-5; t.dv='aaaa'; touch('m:'+thisYM()); });
  await B.evaluate(()=>{ const t=allTxns().find(x=>x.p==='nur A'); t.e='von B'; stempel(t); touch('m:'+thisYM()); });
  await kurzWarten(A); await kurzWarten(B);
  await abgleich(A); await abgleich(B); await abgleich(A);
  pruefe(await A.evaluate(()=>allTxns().find(x=>x.p==='nur A').e)==='von B', 'dieselbe Buchung auf zwei Geräten geändert: die spätere Änderung gewinnt');

  /* ================= 8. Konflikt beim Schreiben ================= */
  console.log('\n8 · ETag-Konflikt');
  await buchen(A, -3, 'Konflikt A'); await kurzWarten(A);
  // Während A liest und schreibt, schreibt „jemand" (B) dazwischen
  await buchen(B, -4, 'Konflikt B'); await kurzWarten(B);
  const bText = await B.evaluate(async()=>{ const a=FUA.abbild(); return FUA_SYNC.verschluesseln(a); });
  odStoerung = p => { if(p==='Finanzübersicht C/Finanzuebersicht-C-App.fuct') odPut(p, bText); };
  b = await abgleich(A);
  pruefe(b.ok, 'Abgleich übersteht eine zwischenzeitliche Änderung (412 → neu lesen, zusammenführen)');
  pruefe(await hatText(A, 'Konflikt B') && await hatText(A, 'Konflikt A'), '… und nichts geht verloren');
  const odInnen = JSON.parse(await A.evaluate(t=>FUA_SYNC.tresorZuDatendatei(t), OD.get('Finanzübersicht C/Finanzuebersicht-C-App.fuct').text));
  const alleP = Object.entries(odInnen.docs).filter(([p])=>/^months\//.test(p)).flatMap(([,m])=>m.txns||[]).map(t=>t.p);
  pruefe(alleP.includes('Konflikt A') && alleP.includes('Konflikt B'), 'OneDrive enthält danach beide Buchungen');

  /* ================= 9. Drittes Gerät nur über Google ================= */
  console.log('\n9 · Drittes Gerät nur über Google Drive');
  const C = await geraet(browser, 'C', 400);
  await anmelden(C, 'g');
  await C.waitForSelector('#fua_p1');
  await C.fill('#fua_p1', 'Moselwein ist kein Rotwein 2026'); await C.fill('#fua_p2', 'Moselwein ist kein Rotwein 2026');
  await Promise.all([C.waitForNavigation({timeout:40000}).catch(()=>{}), C.click('[data-fua="passok"]')]);
  await bereit(C); await warte(1500);
  const kc = await kz(C), ka2 = await kz(A);
  pruefe(kc && kc.tx===ka2.tx && kc.netto===ka2.netto, `Gerät nur mit Google hat denselben Stand (${kc&&kc.tx} Buchungen)`);
  await buchen(C, -7, 'über Google'); await kurzWarten(C); await abgleich(C); await abgleich(A);
  pruefe(await hatText(A, 'über Google'), 'Buchung vom Google-Gerät kommt über den PC (beide Spiegel) an');
  await abgleich(B);
  pruefe(await hatText(B, 'über Google'), '… und von dort über OneDrive am Handy');

  /* ================= 10. Datendatei der lokalen Fassung ================= */
  console.log('\n10 · Datendatei der lokalen Fassung (L6) als dritter Spiegel');
  await tab(A, 'sync'); await A.check('[data-fuachg="l6"]'); await warte(300);
  await A.waitForFunction(()=>!FUA_SYNC.ST.laeuft, null, {timeout:30000}); await warte(300);
  b = await abgleich(A);
  const l6 = OD.get('Finanzübersicht C/Finanzuebersicht-C-Daten.json');
  pruefe(!!l6 && JSON.parse(l6.text).typ==='finanzuebersicht-c-speicher', 'L6-Datendatei im Klartextformat der lokalen Fassung geschrieben');
  const l6o = JSON.parse(l6.text);
  const ymH = await A.evaluate(()=>thisYM());
  l6o.docs['months/'+ymH].txns.push({id:'pc01-test', d:ymH+'-20', a:-99, p:'am PC gebucht', c:'Sonstiges', k:'Girokonto Christoph', e:'', b:true, u:Math.floor(Date.now()/1000), dv:'pc01'});
  odPut('Finanzübersicht C/Finanzuebersicht-C-Daten.json', JSON.stringify(l6o));
  b = await abgleich(A);
  pruefe(await hatText(A, 'am PC gebucht'), 'eine Buchung der lokalen Fassung (PC) kommt in der App an');
  pruefe(b.geschrieben.includes('ms') && b.geschrieben.includes('g'), '… und wird in beide Tresore weitergereicht');
  // Einmal einlesen über den Dialog
  await tab(A, 'sync'); await klick(A, '[data-fua="l6lesen"]');
  await A.waitForSelector('[data-act="implokalgo"]', {timeout:8000});
  pruefe(await A.evaluate(()=>/Finanzuebersicht-C-Daten\.json \(OneDrive\)/.test(document.getElementById('ov').textContent)), '„Einmal einlesen" öffnet den Einlese-Dialog des Tools mit der Datei aus OneDrive');
  await klick(A, '[data-act="cancel"]');

  /* ================= 11. Anmeldung abgelaufen, sperren, offline ================= */
  console.log('\n11 · Abgelaufene Anmeldung, Sperre, offline');
  await C.evaluate(()=>{ FUA_SYNC.SY.tok.g.exp = Date.now()-1000; });
  b = await abgleich(C);
  pruefe(!b.ok && await C.evaluate(()=>/Anmeldung nötig/.test(document.getElementById('hstat').textContent)), 'abgelaufene Google-Anmeldung: Kopfzeile „Anmeldung nötig", keine Daten gefährdet');
  await A.evaluate(()=>{ FUA_SYNC.SY.tok.ms.exp = Date.now()-1000; });
  b = await abgleich(A);
  pruefe(b.ok, 'abgelaufenes OneDrive-Token wird still über das Refresh-Token erneuert');
  await B.evaluate(()=>FUA_SYNC.sperren());
  b = await abgleich(B);
  pruefe(!b.ok && await B.evaluate(()=>/Passphrase nötig/.test(document.getElementById('hstat').textContent)), 'gesperrtes Gerät gleicht nicht ab und zeigt „Passphrase nötig"');
  k = await kz(B);
  pruefe(k.tx===erwartet.tx+4 || k.tx>erwartet.tx, 'gesperrtes Gerät behält seinen Bestand');
  await B.context().setOffline(true);
  await buchen(B, -5, 'offline gebucht'); await kurzWarten(B);
  b = await abgleich(B);
  pruefe(!b.ok && await hatText(B, 'offline gebucht'), 'offline: Buchung bleibt auf dem Gerät');
  await B.context().setOffline(false);
  await tab(B, 'sync'); await klick(B, '[data-fua="pass"]');
  await passphrase(B, 'Moselwein ist kein Rotwein 2026');
  await B.waitForFunction(()=>!FUA_SYNC.ST.laeuft, null, {timeout:30000}); await warte(500);
  await abgleich(B); await abgleich(A);
  pruefe(await hatText(A, 'offline gebucht'), 'nach Entsperren und Netz: Offline-Buchung kommt am PC an');

  /* ================= 12. Handy-Breite ================= */
  console.log('\n12 · Handy-Breite 400 px');
  for(const t of await B.evaluate(()=>TABS.map(x=>x[0]))){
    await tab(B, t); await warte(t==='plan'?500:100); if(t==='plan'){ await tab(B,'plan'); await warte(200); }
    const w = await B.evaluate(()=>({s:document.documentElement.scrollWidth, c:document.documentElement.clientWidth}));
    pruefe(w.s<=w.c+1, `400 px, Reiter ${t}: kein waagerechtes Scrollen (${w.s}/${w.c})`);
  }
  pruefe(await B.evaluate(()=>getComputedStyle(document.querySelector('.fua-fab')).display!=='none'), 'Handy: runde „+"-Schaltfläche sichtbar');
  // v4.6: Stand danach, Warnschwelle, Unterdeckung — auch in der App
  await tab(B, 'monat'); await warte(200);
  pruefe(await B.evaluate(()=>/Stand danach/.test(document.getElementById('v').textContent)), 'v4.5: Monatsliste zeigt die Spalte „Stand danach"');
  const ud = await B.evaluate(async()=>{
    const a=ACC['Girokonto Christoph']; a.schwelle=1e7; stempel(a); touch('accounts');
    refresh(); await new Promise(r=>setTimeout(r,100));
    const u=unterFuer('Girokonto Christoph'), txt=document.getElementById('v').textContent;
    return {u:!!u, jetzt:u&&u.jetzt, hinweis:/Voraussichtliche Unterdeckung/.test(txt)};
  });
  pruefe(ud.u && ud.jetzt && ud.hinweis, 'v4.6: Warnschwelle wirkt — Vermerk „Voraussichtliche Unterdeckung" im Monatsreiter');
  await kurzWarten(B); await abgleich(B); await abgleich(A);
  pruefe(await A.evaluate(()=>ACC['Girokonto Christoph'].schwelle===1e7), 'v4.6: die Warnschwelle eines Kontos gleicht sich zwischen den Geräten ab');
  await A.evaluate(()=>{ ACC['Girokonto Christoph'].schwelle=0; stempel(ACC['Girokonto Christoph']); touch('accounts'); });
  await kurzWarten(A); await abgleich(A); await abgleich(B);
  pruefe(await B.evaluate(()=>ACC['Girokonto Christoph'].schwelle===0), '… und zurück');
  await tab(B, 'dash'); await klick(B, '.fua-fab');
  pruefe(await B.evaluate(()=>/Neue Buchung/.test(document.getElementById('ov').textContent)), '„+" öffnet „Neue Buchung" für den laufenden Monat');
  await klick(B, '[data-act="cancel"]');
  pruefe(await A.evaluate(()=>getComputedStyle(document.querySelector('.fua-fab')).display==='none'), 'am breiten Bildschirm keine „+"-Schaltfläche');
  await B.screenshot({path:path.join(__dirname,'handy-uebersicht.png')});
  await tab(B, 'plan'); await warte(400); await B.screenshot({path:path.join(__dirname,'handy-finanzplan.png'), fullPage:true});
  await tab(B, 'sync'); await warte(200); await B.screenshot({path:path.join(__dirname,'handy-abgleich.png'), fullPage:true});

  /* ================= 13. Android-App (Capacitor) nachgestellt ================= */
  console.log('\n13 · Android-App: Anmeldung über den System-Browser, Rücksprung, Teilen');
  const nctx = await browser.newContext({viewport:{width:400, height:860}});
  await nctx.route(/login\.microsoftonline\.com|graph\.microsoft\.com|accounts\.google\.com|www\.googleapis\.com/, cloud);
  await nctx.route(BASIS+'config.js', r=>r.fulfill({status:200, contentType:'text/javascript',
    body:KONFIG.replace("redirectUri:''", "redirectUri:'https://beispiel.github.io/finanz-app/oauth.html'")}));
  await nctx.addInitScript(()=>{
    window.androidBridge = {postMessage(){}};
    window.__geteilt = []; window.__hoerer = {};
    window.Capacitor = {Plugins:{
      Browser:{ open: async o=>{ window.__offen=o.url; }, close: async()=>{} },
      App:{ addListener:(ev,cb)=>{ window.__hoerer[ev]=cb; return Promise.resolve({remove(){}}); } },
      Filesystem:{ writeFile: async o=>({uri:'file:///cache/'+o.path, laenge:o.data.length}) },
      Share:{ share: async o=>{ window.__geteilt.push(o); } } }};
  });
  const N = await nctx.newPage(); N.fehler=[]; N.on('pageerror', e=>N.fehler.push(e.message));
  await N.goto(BASIS); await bereit(N);
  pruefe(await N.evaluate(()=>FUA.istNativ()), 'App erkennt die Android-Hülle');
  await N.evaluate(()=>show('sync')); await N.click('[data-fua="anmelden"][data-pid="ms"]'); await warte(500);
  const offen = await N.evaluate(()=>window.__offen||'');
  const ou = new URL(offen);
  pruefe(ou.host==='login.microsoftonline.com' && /^ms\.n\./.test(ou.searchParams.get('state')) && ou.searchParams.get('redirect_uri')==='https://beispiel.github.io/finanz-app/oauth.html',
    'Anmeldung öffnet den System-Browser, Weiterleitung auf die gehostete oauth.html, Kennzeichen „n" für die App');
  pruefe(N.url().startsWith(BASIS), 'die App selbst navigiert dabei nicht weg');
  // oauth.html im Browser: baut den Rücksprung in die App
  const O = await nctx.newPage();
  await O.goto(BASIS+'oauth.html?code=abc123&state='+encodeURIComponent(ou.searchParams.get('state'))).catch(()=>{});
  await warte(300);
  const zur = await O.evaluate(()=>document.getElementById('zurueck').getAttribute('href')).catch(()=>'');
  pruefe(zur==='de.vanwuellen.finanzc://oauth?code=abc123&state='+encodeURIComponent(ou.searchParams.get('state')), 'oauth.html leitet mit Code und state an de.vanwuellen.finanzc://oauth weiter');
  await O.close();
  await N.evaluate(u=>window.__hoerer.appUrlOpen({url:u}), zur); await warte(1200);
  pruefe(await N.evaluate(()=>!!(FUA_SYNC.SY.tok.ms && FUA_SYNC.SY.tok.ms.refresh)), 'Rücksprung in die App schließt die OneDrive-Anmeldung ab (Token)');
  pruefe(await N.evaluate(()=>!!document.getElementById('fua_p1')), '… und fragt nach der Passphrase');
  await passphrase(N, 'Moselwein ist kein Rotwein 2026'); await warte(2500); await bereit(N); await warte(800);
  const kn = await kz(N);
  pruefe(kn && kn.tx>=erwartet.tx, 'Android-App hat danach den Bestand ('+(kn&&kn.tx)+' Buchungen)');
  await N.evaluate(()=>saveFile('Test.json', '{"a":1}', 'ok')); await warte(300);
  const g = await N.evaluate(()=>window.__geteilt);
  pruefe(g.length===1 && g[0].files[0]==='file:///cache/Test.json', 'Datei-Ausgabe läuft in der App über das Android-Teilen-Menü');
  pruefe(!N.fehler.length, 'keine Skriptfehler in der App-Hülle'+(N.fehler.length?': '+N.fehler[0]:''));
  await nctx.close();

  console.log('\nKonsolenfehler: A '+A.fehler.length+', B '+B.fehler.length+', C '+C.fehler.length);
  [A,B,C].forEach(p=>p.fehler.slice(0,5).forEach(f=>console.log('   '+p.name+': '+f)));
  pruefe(!A.fehler.length && !B.fehler.length && !C.fehler.length, 'keine Skriptfehler auf allen drei Geräten');
  }catch(e){ console.log('ABBRUCH', e); nok++; }
  await browser.close(); server.close();
  console.log(`\n${ok} bestanden, ${nok} fehlgeschlagen`);
  if(fehlerListe.length) console.log(' - '+fehlerListe.join('\n - '));
  process.exit(nok?1:0);
})();
