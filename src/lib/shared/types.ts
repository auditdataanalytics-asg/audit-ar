import { Timestamp } from "firebase/firestore";

// ── Shared cross-module types ──

/**
 * Generic per-module access record stored on the user doc. Each feature module
 * narrows `role` to its own union (e.g. Audit AR -> AuditRole). Keeping this
 * generic lets the shared user schema stay decoupled from any single module.
 */
export interface ModuleAccess {
  enabled: boolean;
  role: string | null;
  grantedAt: Timestamp;
  grantedBy: string;
}

export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  isDisabled: boolean;
  // Per-module access, independent of the `role` above.
  modules?: {
    auditAr?: ModuleAccess;
  };
}
