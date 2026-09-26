/* Nach „cap add/sync android":
   1. Rücksprung aus der Anmeldung (de.vanwuellen.finanzc://oauth) im AndroidManifest eintragen.
   2. Android-Datensicherung der App ausschalten — der Bestand liegt in der App unverschlüsselt und
      soll nicht im Klartext ins Google-Backup wandern (die Cloud-Kopie ist ja der verschlüsselte Tresor).
   3. versionCode aus der Build-Nummer (GITHUB_RUN_NUMBER), damit jede neue APK über die alte installiert.
   4. Signatur aus Umgebungsvariablen (FUA_KEYSTORE, FUA_KEYSTORE_PASS, FUA_KEY_ALIAS, FUA_KEY_PASS). */
const fs = require('fs'), path = require('path');
const A = path.join(__dirname, '..', 'android', 'app');
const mf = path.join(A, 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const SCHEMA = 'de.vanwuellen.finanzc';
if (!x.includes(`android:scheme="${SCHEMA}"`)) {
  const filter = `
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${SCHEMA}" android:host="oauth" />
            </intent-filter>
`;
  const i = x.indexOf('</activity>');
  if (i < 0) throw new Error('</activity> nicht gefunden');
  x = x.slice(0, i) + filter + '        ' + x.slice(i);
}
x = x.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
if (!/android:allowBackup=/.test(x)) x = x.replace('<application', '<application android:allowBackup="false"');
fs.writeFileSync(mf, x);

// App-Symbol: eigene PNGs statt des Capacitor-Symbols; die adaptiven Vorlagen entfallen
const ICONS = path.join(__dirname, '..', 'quelle', 'android-icons');
if (fs.existsSync(ICONS)) {
  for (const d of fs.readdirSync(ICONS)) for (const f of fs.readdirSync(path.join(ICONS, d)))
    fs.copyFileSync(path.join(ICONS, d, f), path.join(A, 'src', 'main', 'res', d, f));
  fs.rmSync(path.join(A, 'src', 'main', 'res', 'mipmap-anydpi-v26'), {recursive: true, force: true});
}

const bg = path.join(A, 'build.gradle');
let g = fs.readFileSync(bg, 'utf8');
const nr = parseInt(process.env.GITHUB_RUN_NUMBER || '0', 10);
if (nr > 0) g = g.replace(/versionCode\s+\d+/, 'versionCode ' + nr).replace(/versionName\s+"[^"]*"/, `versionName "1.0.${nr}"`);
if (process.env.FUA_KEYSTORE && !g.includes('// FUA-Signatur')) {
  g += `
// FUA-Signatur
android {
    signingConfigs {
        fua {
            storeFile file(System.getenv('FUA_KEYSTORE'))
            storePassword System.getenv('FUA_KEYSTORE_PASS')
            keyAlias System.getenv('FUA_KEY_ALIAS')
            keyPassword System.getenv('FUA_KEY_PASS')
        }
    }
    buildTypes { release { signingConfig signingConfigs.fua } }
}
`;
}
fs.writeFileSync(bg, g);
console.log('Android angepasst: Schema', SCHEMA, '· allowBackup=false', nr ? '· versionCode ' + nr : '', process.env.FUA_KEYSTORE ? '· Signatur' : '');
