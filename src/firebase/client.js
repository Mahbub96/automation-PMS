const admin = require("firebase-admin");
const fs = require("fs");

function initializeFirestore(firebaseConfig) {
  if (!admin.apps.length) {
    let credential;
    if (firebaseConfig.serviceAccountPath) {
      const serviceAccountRaw = fs.readFileSync(firebaseConfig.serviceAccountPath, "utf8");
      const serviceAccount = JSON.parse(serviceAccountRaw);
      credential = admin.credential.cert(serviceAccount);
    } else {
      credential = admin.credential.cert({
        projectId: firebaseConfig.projectId,
        clientEmail: firebaseConfig.clientEmail,
        privateKey: firebaseConfig.privateKey,
      });
    }

    admin.initializeApp({
      credential,
    });
  }

  return admin.firestore();
}

module.exports = { initializeFirestore };
