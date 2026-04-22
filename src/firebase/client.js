const admin = require("firebase-admin");

function initializeFirestore(firebaseConfig) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: firebaseConfig.projectId,
        clientEmail: firebaseConfig.clientEmail,
        privateKey: firebaseConfig.privateKey,
      }),
    });
  }

  return admin.firestore();
}

module.exports = { initializeFirestore };
