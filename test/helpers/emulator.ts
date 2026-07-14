import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";

// One shared emulator-backed test environment for the whole run. The Firestore
// emulator is booted by `firebase emulators:exec` (see the test:emulator script);
// this connects to it on 127.0.0.1:8080 with the real firestore.rules loaded.

let testEnv: RulesTestEnvironment | null = null;

export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (!testEnv) {
    testEnv = await initializeTestEnvironment({
      projectId: "audit-ar-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8"),
      },
    });
  }
  return testEnv;
}

/** A Firestore handle authenticated as `uid` with the given custom claims (e.g. auditRole). */
export async function authedDb(
  uid: string,
  claims: Record<string, unknown> = {},
): Promise<Firestore> {
  const env = await getTestEnv();
  // rules-unit-testing returns a modular Firestore compatible with firebase/firestore.
  return env.authenticatedContext(uid, claims).firestore() as unknown as Firestore;
}

/** Seed/inspect data with security rules bypassed. */
export async function withoutRules(
  fn: (db: Firestore) => Promise<void>,
): Promise<void> {
  const env = await getTestEnv();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}

export async function clearData(): Promise<void> {
  const env = await getTestEnv();
  await env.clearFirestore();
}

export async function cleanupEnv(): Promise<void> {
  if (testEnv) {
    await testEnv.cleanup();
    testEnv = null;
  }
}
