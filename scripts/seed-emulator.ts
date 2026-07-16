import * as admin from "firebase-admin";

// Seeds the Firebase EMULATOR (Auth + Firestore) with test logins and the
// building-condition / building-type category lists, so you can run the blackbox
// tests (incl. multi-person concurrency) locally without touching prod quota.
//
// Prereq: emulator running (`npm run emulators` or `npm run emulators:fresh`).
// Usage:  npx tsx scripts/seed-emulator.ts
// All accounts use password: password123

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "audit-ar-b05a7";
admin.initializeApp({ projectId: PROJECT_ID });

const PASSWORD = "password123";
const USERS: { email: string; name: string; role: "supervisor" | "fieldAudit" }[] = [
  { email: "supervisor@test.com", name: "Supervisor Test", role: "supervisor" },
  { email: "sup2@test.com", name: "Supervisor Dua", role: "supervisor" },
  { email: "fieldA@test.com", name: "Auditor A", role: "fieldAudit" },
  { email: "fieldB@test.com", name: "Auditor B", role: "fieldAudit" },
  { email: "fieldC@test.com", name: "Auditor C", role: "fieldAudit" },
];

const CONDITIONS = ["Baik", "Rusak Ringan", "Rusak Berat", "Dalam Renovasi"];
const TYPES = ["Ruko", "Rumah Tinggal", "Kavling Tanah", "Gudang", "Kantor"];

async function ensureUser(
  email: string,
  name: string,
  role: "supervisor" | "fieldAudit",
) {
  const auth = admin.auth();
  const db = admin.firestore();

  let user: admin.auth.UserRecord;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({
      email,
      password: PASSWORD,
      displayName: name,
      emailVerified: true,
    });
  }
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims ?? {}),
    auditRole: role,
  });
  await db.collection("users").doc(user.uid).set(
    {
      email,
      displayName: name,
      modules: {
        auditAr: {
          enabled: true,
          role,
          grantedAt: admin.firestore.FieldValue.serverTimestamp(),
          grantedBy: "seed-emulator",
        },
      },
    },
    { merge: true },
  );
}

async function seedCategories() {
  const db = admin.firestore();
  const existing = new Set(
    (await db.collection("auditCategories").get()).docs.map(
      (d) => `${d.data().type}|${d.data().label}`,
    ),
  );
  const batch = db.batch();
  let added = 0;
  const add = (type: "buildingCondition" | "buildingType", labels: string[]) => {
    labels.forEach((label, i) => {
      if (existing.has(`${type}|${label}`)) return;
      batch.set(db.collection("auditCategories").doc(), {
        type,
        label,
        order: i,
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      added++;
    });
  };
  add("buildingCondition", CONDITIONS);
  add("buildingType", TYPES);
  if (added) await batch.commit();
  return added;
}

async function seed() {
  for (const u of USERS) await ensureUser(u.email, u.name, u.role);
  const added = await seedCategories();

  console.log("Emulator seeded (all passwords: " + PASSWORD + ")");
  for (const u of USERS) console.log(`  ${u.role.padEnd(11)} ${u.email}`);
  console.log(`  Categories added: ${added}`);
  console.log("  Run the app with NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true and log in.");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
