#!/usr/bin/env python3
"""Baut die Android-/Web-App aus der live gelesenen Artifact-Fassung (original.html).

   original.html (v4.4, unverändert)  +  src/*  →  www/

Jede Fundstelle muss GENAU EINMAL vorkommen, sonst bricht das Skript mit einer Liste ab —
so fällt auf, wenn eine neue Artifact-Fassung die Stellen umbenannt hat."""
import hashlib, os, re, shutil, sys

HIER = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HIER, 'src')
# Ausgabe: www/ neben quelle/ (Capacitor: webDir „www")
WWW = os.environ.get('FUA_WWW') or os.path.join(HIER, '..', 'www')
html = open(os.path.join(HIER, 'original.html'), encoding='utf-8').read()

fehler = []
def ersetze(alt, neu, name):
    global html
    n = html.count(alt)
    if n != 1:
        fehler.append(f'{name}: {n}× gefunden')
        return
    html = html.replace(alt, neu)

KOPF = ('<meta name="theme-color" content="#12508f">'
        '<link rel="manifest" href="manifest.webmanifest">'
        '<link rel="icon" href="icons/icon-192.png">'
        '<link rel="apple-touch-icon" href="icons/icon-192.png">')
ersetze('<meta charset=utf8>', '<meta charset=utf-8>' + KOPF, 'Kopf')
ersetze('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>',
        '<script src="xlsx.full.min.js"></script>\n<script src="capacitor.js"></script>\n<script src="config.js"></script>\n<script src="app-vor.js"></script>',
        'SheetJS / Speicherschicht')
ersetze('\n</body></html>', '\n<link rel="stylesheet" href="app.css">\n<script src="app-sync.js"></script>\n<script src="app-nach.js"></script>\n</body></html>', 'Fuß')
# Persönliche Randbemerkung im Kommentar — die Web-App ist öffentlich abrufbar
ersetze('bei Christoph über 72.000 € statt der\n   tatsächlichen 2.238,58 €.', 'ein Vielfaches des\n   tatsächlichen Saldos.', 'Kommentar Kartenumsatz')
# Fundstellen, auf die sich app-sync.js / app-nach.js verlassen
for s in ['function lokZusammenfuehren(ziel, quelle){', 'function lokImportModal(){', 'let LOKDATEI = null;',
          'function renderHeaderStat(){', 'const TABS = [', 'async function mandsLaden(){', 'async function loadAll(){',
          'function txnModal(ym, id, pre, onSaved){', "const LSGER = 'fuc_geraet';", 'async function flush(){']:
    if html.count(s) != 1: fehler.append(f'Fundstelle „{s}": {html.count(s)}×')
if 'claude.use(' not in html: fehler.append('claude.use fehlt')

if fehler:
    print('ABBRUCH:\n  ' + '\n  '.join(fehler)); sys.exit(1)

if os.path.isdir(WWW): shutil.rmtree(WWW)
os.makedirs(os.path.join(WWW, 'icons'))
open(os.path.join(WWW, 'index.html'), 'w', encoding='utf-8').write(html)
for f in ['app-vor.js', 'app-sync.js', 'app-nach.js', 'app.css', 'config.js', 'oauth.html', 'manifest.webmanifest']:
    shutil.copy(os.path.join(SRC, f), os.path.join(WWW, f))
for f in os.listdir(os.path.join(SRC, 'icons')):
    shutil.copy(os.path.join(SRC, 'icons', f), os.path.join(WWW, 'icons', f))
for f in ['xlsx.full.min.js', 'capacitor.js']:
    shutil.copy(os.path.join(HIER, 'vendor', f), os.path.join(WWW, f))

h = hashlib.sha256()
for f in sorted(os.listdir(WWW)):
    p = os.path.join(WWW, f)
    if os.path.isfile(p): h.update(open(p, 'rb').read())
version = h.hexdigest()[:10]
sw = open(os.path.join(SRC, 'sw.js.vorlage'), encoding='utf-8').read().replace('__VERSION__', version)
open(os.path.join(WWW, 'sw.js'), 'w', encoding='utf-8').write(sw)
print('www/ gebaut, Version', version, '·', len(html)//1024, 'KB index.html')
