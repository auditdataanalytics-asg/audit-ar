/* eslint-disable @typescript-eslint/no-require-imports */
import * as admin from "firebase-admin";
import * as path from "path";

// Bootstraps the first Audit AR supervisor (after that, supervisors manage
// their own team in-app). Mirrors scripts/set-initial-admin.ts.
//
// Usage: npx tsx scripts/set-audit-role.ts <UID|email> [supervisor|fieldAudit]

const serviceAccountPath = path.resolve(__dirname, "../service-account.json");
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function setAuditRole(identifier: string, role: "supervisor" | "fieldAudit") {
  const user = identifier.includes("@")
    ? await admin.auth().getUserByEmail(identifier)
    : await admin.auth().getUser(identifier);
  // Merge so the existing LMS `role` claim is preserved.
  await admin.auth().setCustomUserClaims(user.uid, {
    ...(user.customClaims ?? {}),
    auditRole: role,
  });
  await admin
    .firestore()
    .collection("users")
    .doc(user.uid)
    .set(
      {
        modules: {
          auditAr: {
            enabled: true,
            role,
            grantedAt: admin.firestore.FieldValue.serverTimestamp(),
            grantedBy: "bootstrap-script",
          },
        },
      },
      { merge: true },
    );
  console.log(`Audit AR role '${role}' assigned to ${user.email ?? user.uid} (UID: ${user.uid})`);
  console.log("User must log out and back in (or refresh token) to apply.");
  process.exit(0);
}

const identifier = process.argv[2];
const role = (process.argv[3] as "supervisor" | "fieldAudit") || "supervisor";
if (!identifier || !["supervisor", "fieldAudit"].includes(role)) {
  console.error(
    "Usage: npx tsx scripts/set-audit-role.ts <UID|email> [supervisor|fieldAudit]",
  );
  process.exit(1);
}

setAuditRole(identifier, role);
