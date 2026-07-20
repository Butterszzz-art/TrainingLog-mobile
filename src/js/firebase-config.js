// Firebase web app config — Phase 1 of the Firebase Auth migration.
// This is the PUBLIC client config (safe to ship, unlike the Admin service
// account on the server). Get the real values from:
//   Firebase Console → Project Settings → General → Your apps → Web app
//
// Until the placeholders below are replaced, window.FIREBASE_ENABLED stays
// false and the app keeps using legacy username/password auth — safe to deploy
// before the Firebase project exists.
(function () {
  const config = {
    apiKey: 'AIzaSyCgZTztfMhwQdRfc4no_ZduDEfOv30gMcY',
    authDomain: 'pocketcoach-280c4.firebaseapp.com',
    projectId: 'pocketcoach-280c4',
    appId: '1:1030123531276:web:237753650da87b6d285229'
  };

  const configured = Object.values(config).every(v => typeof v === 'string' && !v.includes('REPLACE_ME'));
  window.FIREBASE_CONFIG = config;
  window.FIREBASE_ENABLED = configured && typeof firebase !== 'undefined';

  if (!configured) {
    console.info('[Firebase] Client config not filled in yet — using legacy auth.');
  } else if (typeof firebase === 'undefined') {
    console.warn('[Firebase] SDK failed to load (offline?) — falling back to legacy auth.');
  } else {
    firebase.initializeApp(config);
  }
})();
