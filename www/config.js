/* Finanzübersicht C · Android-App — Einrichtung
   Nach der Registrierung in Azure und in der Google Cloud Console hier eintragen
   (oder in der App im Reiter „Abgleich" → Einrichtung). Die IDs sind nicht geheim. */
window.FUA_KONFIG = {
  msClientId: '',                 // Azure: Anwendungs-ID (Client-ID) der App-Registrierung
  msTenant: 'common',             // 'common' = privates + Firmenkonto; 'consumers' = nur privat
  googleClientId: '',             // Google Cloud: OAuth-Client-ID (Typ „Webanwendung")
  redirectUri: '',                // leer = <Adresse der Web-App>/oauth.html
                                  // In der Android-App MUSS hier die Adresse der gehosteten Web-App stehen,
                                  // z. B. 'https://<name>.github.io/finanz-app/oauth.html'
  appSchema: 'de.vanwuellen.finanzc'
};
