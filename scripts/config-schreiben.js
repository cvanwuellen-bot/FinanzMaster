/* Schreibt www/config.js aus Umgebungsvariablen (GitHub: Repository-Variablen).
   MS_CLIENT_ID, MS_TENANT, GOOGLE_CLIENT_ID, REDIRECT_URI; ohne REDIRECT_URI gilt PAGES_URL + oauth.html. */
const fs = require('fs'), path = require('path');
const e = process.env;
const redirect = e.REDIRECT_URI || (e.PAGES_URL ? e.PAGES_URL.replace(/\/?$/, '/') + 'oauth.html' : '');
const k = { msClientId: e.MS_CLIENT_ID || '', msTenant: e.MS_TENANT || 'common', googleClientId: e.GOOGLE_CLIENT_ID || '',
            redirectUri: redirect, appSchema: 'de.vanwuellen.finanzc' };
fs.writeFileSync(path.join(__dirname, '..', 'www', 'config.js'),
  '/* Automatisch geschrieben von scripts/config-schreiben.js */\nwindow.FUA_KONFIG = ' + JSON.stringify(k, null, 2) + ';\n');
console.log('config.js:', JSON.stringify(k));
