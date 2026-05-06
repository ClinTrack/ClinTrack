import admin from "firebase-admin";
import fs from "fs";

// Load your service account JSON
const serviceAccount = JSON.parse(
  fs.readFileSync("./serviceAccountKey.json")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Replace with the actual UID of your user
const uid = "GZQgBPMJppU0LxiszBXo5t4OfpI3";

admin.auth().setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log("✅ Admin claim set successfully!");
    process.exit();
  })
  .catch((error) => {
    console.error("❌ Error setting admin claim:", error);
  });
