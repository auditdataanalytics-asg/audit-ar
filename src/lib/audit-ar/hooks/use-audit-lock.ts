"use client";

import { useEffect } from "react";
import { renewDraftLock } from "@/lib/audit-ar/firestore";

// Keeps a draft lock alive while the audit form is open. Renews every 60s and
// re-asserts on focus/visibility change (important on iPhone Safari, which
// suspends background tabs). The lock is NOT released on unmount — it simply
// stops being renewed and lazily expires after the TTL, so a quick navigation
// away doesn't drop a lock the auditor still intends to hold.
export function useAuditLockHeartbeat(
  unitId: string | null,
  uid: string | null,
  active: boolean,
) {
  useEffect(() => {
    if (!active || !unitId || !uid) return;

    const renew = () => {
      void renewDraftLock(unitId, uid);
    };
    renew();
    const interval = setInterval(renew, 60_000);
    const onWake = () => {
      if (document.visibilityState === "visible") renew();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [unitId, uid, active]);
}
