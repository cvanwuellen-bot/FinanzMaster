# Finanzen C – Android-App und Web-App

Die Finanzübersicht C (Artifact v4.6) als App fürs Handy, dazu ein Reiter **Finanzplan** mit den vier
Zielen. Der Bestand liegt auf dem Gerät und wird **gleichrangig mit OneDrive und Google Drive**
abgeglichen – dort **verschlüsselt** (AES-256-GCM, Schlüssel aus deiner Passphrase).

Zwei Auslieferungen aus demselben Code:

| | Web-App (PWA) | Android-App (APK) |
|---|---|---|
| Installation | Chrome → Adresse öffnen → ⋮ → *App installieren* | APK herunterladen und installieren |
| Aktualisierung | automatisch beim nächsten Öffnen | neue APK über die alte installieren |
| Anmeldung | in der App selbst | über den System-Browser, Rücksprung in die App |
| Datei-Ausgabe | Download | Android-Teilen-Menü |

Die APK braucht die Web-App trotzdem: Nach der Anmeldung bei Microsoft/Google landet der Browser auf
`oauth.html` der Web-App, die in die App zurückspringt.

---

## Einmalige Einrichtung (ca. 45 Minuten)

### 1. GitHub-Repository

1. Neues Repository anlegen, z. B. `finanz-app`. **Öffentlich** ist in Ordnung und nötig, wenn GitHub
   Pages kostenlos bleiben soll: Im Code stehen keine Finanzdaten – Zielbeträge, Kredite und Salden
   kommen erst auf dem Gerät hinzu und liegen in der Cloud nur verschlüsselt.
   (Privat geht auch – dann Pages über ein bezahltes Konto, Netlify oder Cloudflare Pages.)
2. Den Inhalt dieses Ordners hochladen – **ohne** `quelle/testdaten/` (steht in `.gitignore`).
3. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
4. Die Adresse der Web-App ist dann `https://<github-name>.github.io/finanz-app/`,
   die Weiterleitungsadresse **`https://<github-name>.github.io/finanz-app/oauth.html`**.

### 2. Microsoft (OneDrive)

1. [portal.azure.com](https://portal.azure.com) → *Microsoft Entra ID* → *App-Registrierungen* → *Neue Registrierung*.
   (Wer noch kein Verzeichnis hat, legt dafür ein kostenloses Azure-Konto an.)
2. Name: `Finanzen C`. Kontotypen: **Konten in einem beliebigen Organisationsverzeichnis und persönliche
   Microsoft-Konten**.
3. Umleitungs-URI: Plattform **Single-Page-Anwendung (SPA)**, Adresse = die Weiterleitungsadresse aus 1.4.
4. *API-Berechtigungen* → *Microsoft Graph* → *Delegiert*: **Files.ReadWrite** und **offline_access**.
5. Die **Anwendungs-ID (Client-ID)** kopieren.

### 3. Google (Drive)

1. [console.cloud.google.com](https://console.cloud.google.com) → neues Projekt `Finanzen C`.
2. *APIs & Dienste → Bibliothek* → **Google Drive API** aktivieren.
3. *OAuth-Zustimmungsbildschirm*: Typ **Extern**, Status **Testen**, dich selbst als **Testnutzer** eintragen,
   Bereich **`…/auth/drive.file`** (die App sieht nur Dateien, die sie selbst anlegt).
4. *Anmeldedaten → OAuth-Client-ID*, Typ **Webanwendung**:
   - Autorisierte JavaScript-Quellen: `https://<github-name>.github.io`
   - Autorisierte Weiterleitungs-URIs: die Weiterleitungsadresse aus 1.4
5. Die **Client-ID** kopieren.

### 4. In GitHub eintragen

*Settings → Secrets and variables → Actions*

- Reiter **Variables**: `MS_CLIENT_ID`, `GOOGLE_CLIENT_ID`, optional `MS_TENANT` (Vorgabe `common`)
  und `REDIRECT_URI` (nur wenn die Web-App nicht unter der GitHub-Pages-Adresse liegt).
- Reiter **Secrets**: die vier Werte aus `GitHub-Secrets.txt` (separates Paket, **nicht** ins Repository):
  `FUA_KEYSTORE_B64`, `FUA_KEYSTORE_PASS`, `FUA_KEY_ALIAS`, `FUA_KEY_PASS`.

Danach unter *Actions* **„Web-App veröffentlichen"** einmal laufen lassen (läuft sonst bei jedem Push).

### 5. APK bauen

*Actions → „Android-APK bauen" → Run workflow* (oder einen Tag `v1.0.0` pushen – dann hängt die APK
zusätzlich an einem Release). Nach ca. 5 Minuten liegt `Finanzen-C.apk` unter *Artifacts*.
Auf dem Handy öffnen, *Installation aus unbekannten Quellen* für den Browser/Dateimanager erlauben.

Ohne die Secrets entsteht eine Debug-APK. Die funktioniert, lässt sich aber nicht über eine spätere
Fassung installieren – deshalb die Signatur. Die Datei `finanzen-c.keystore` gut aufbewahren.

---

## Erster Start

**Erstes Gerät (Bestand vom PC holen):**

1. Reiter **Abgleich** → **Mit OneDrive verbinden** → anmelden.
2. **Passphrase festlegen** (mind. 10 Zeichen, besser ein Satz). **Aufschreiben** – ohne sie ist der
   Tresor nicht mehr zu öffnen; es gibt keinen Weg über Microsoft oder Google.
3. Bestand holen: **Lokale Fassung (PC) → Einmal einlesen …** (liest `Finanzuebersicht-C-Daten.json`
   aus OneDrive) → *Zusammenführen*. Oder im Reiter *Daten* → *Datendatei einlesen …*.
4. Optional **Mit Google verbinden** – ab dann zwei gleichrangige Spiegel.
5. Reiter **Finanzplan** → **Stammdaten einlesen …** → `finanz-stammdaten.json` aus der Finanzplanung.

**Jedes weitere Gerät:** Abgleich → mit OneDrive *oder* Google verbinden → **dieselbe Passphrase** →
der Bestand kommt von selbst, einschließlich der Finanzplan-Parameter.

**Den PC mitnehmen:** Im Reiter Abgleich *Datendatei der lokalen Fassung mit abgleichen* einschalten.
Dann führt die App `Finanzuebersicht-C-Daten.json` (Klartext, wie bisher) als dritten Spiegel mit –
die lokale Fassung am PC sieht die Handy-Buchungen und umgekehrt. Ordner angeben, falls die lokale
Fassung nicht im selben OneDrive-Ordner liegt.

---

## Wie der Abgleich arbeitet

- Auslöser: beim Öffnen, 10 s nach jeder Änderung, bei Netzrückkehr, alle 5 Minuten. Knopf *Jetzt abgleichen*.
- Ablauf: alle verbundenen Ziele lesen und entschlüsseln → **Datensatz für Datensatz zusammenführen**
  (dieselben Regeln wie der Austausch mit der lokalen Fassung: Was nur eine Seite kennt, kommt dazu; kennen
  beide es, gewinnt der spätere Stand; eine Löschung gewinnt gegen alles Ältere) → abweichende Ziele neu
  schreiben, mit ETag-Prüfung. Hat jemand zwischendurch geschrieben, wird neu gelesen und gemischt.
- Dateien: `Finanzübersicht C/Finanzuebersicht-C-App.fuct` in OneDrive und Google Drive, dazu eine
  **Tagessicherung** je Tag mit Änderungen (`Sicherungen/…-JJJJ-MM-TT.fuct` bzw. im selben Ordner).
  Eine Tagessicherung lässt sich unter *Abgleich → Tresordatei entschlüsseln* wieder zur Datendatei machen.
- Offline wird normal weitergearbeitet; der Abgleich holt alles nach.

## Grenzen, bewusst so gewählt

- **Google-Anmeldung gilt eine Stunde**, Microsoft-Anmeldungen einer SPA 24 Stunden. Danach steht oben
  *Anmeldung nötig*; ein Tippen auf *Neu anmelden* genügt, meist ohne Passwort. Daten gehen dabei nie verloren.
- **Auf dem Gerät** liegt der Bestand unverschlüsselt (IndexedDB) – geschützt durch die Bildschirmsperre.
  Android-Datensicherung ist für die App ausgeschaltet. *Gerät sperren* löscht nur den Schlüssel.
- **Wiederherstellungspunkte** bleiben auf dem jeweiligen Gerät, wie in Artifact und lokaler Fassung.
- **Finanzplan-Parameter** (`state/plan`) gehen mit allen App-Geräten und der lokalen Fassung mit, aber
  nicht ins Artifact (der Artifact-Export kennt nur seine eigenen Dokumente).
- Tagessicherungen werden nicht automatisch gelöscht (rund 150 KB je Tag mit Änderungen).

---

## Für spätere Änderungen

```
quelle/original.html      live gelesene Artifact-Fassung (v4.6), unverändert
quelle/src/app-vor.js     Speicherschicht: window.claude-Nachbildung, IndexedDB je Dokument
quelle/src/app-sync.js    Verschlüsselung, OneDrive (Graph), Google Drive, Abgleich
quelle/src/app-nach.js    Reiter Finanzplan und Abgleich, Kopfzeile, Handy-Knopf „+"
quelle/src/app.css        Handy-Anpassungen
quelle/bauen-app.py       original.html + src → www/   (bricht ab, wenn eine Fundstelle fehlt)
quelle/test/pruefen-app.js Prüfstand, 118 Prüfungen in Chromium gegen nachgebaute Cloud
scripts/                  config.js schreiben, Android-Projekt anpassen
```

Neue Artifact-Fassung: `original.html` ersetzen, `python3 quelle/bauen-app.py`, Prüfstand laufen lassen
(`NODE_PATH=$(npm root -g) node quelle/test/pruefen-app.js`, braucht eine Datendatei in
`quelle/testdaten/daten.json` und `finanz-stammdaten.json` daneben), committen.
