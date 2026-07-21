import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let _app: App | null = null;

function getAdminApp(): App {
  if (_app) return _app;

  const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
  const appName = useEmulator ? "audit-ar-emulator" : "audit-ar-production";
  const existingApp = getApps().find((app) => app.name === appName);
  if (existingApp) {
    _app = existingApp;
    return _app;
  }

  // The Admin SDK automatically obeys these host variables. `.env.local` keeps
  // their values ready for emulator mode, so remove them when the explicit app
  // switch is off; otherwise server routes silently connect to an emulator that
  // is not running while the browser is using production Firebase.
  if (!useEmulator) {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  }

  _app = useEmulator
    ? initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "audit-ar-b05a7",
      }, appName)
    : initializeApp({
        credential: cert({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
          clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
          privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      }, appName);

  return _app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
