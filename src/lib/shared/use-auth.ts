"use client";

import { useEffect, useState } from "react";
import { type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "@/lib/firebase/auth";
import { getClientDb } from "@/lib/firebase/config";
import type { UserDoc } from "@/lib/shared/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  // Generic per-module access map from the user doc. Feature modules narrow
  // their own entry; the shell reads this without importing any module.
  modules: UserDoc["modules"];
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    isAdmin: false,
    modules: undefined,
  });

  useEffect(() => {
    let unsubFirestore: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged((user) => {
      if (unsubFirestore) {
        unsubFirestore();
        unsubFirestore = null;
      }

      if (user) {
        // Listen to Firestore user doc for real-time role changes
        const db = getClientDb();
        unsubFirestore = onSnapshot(
          doc(db, "users", user.uid),
          (snap) => {
            const data = snap.exists() ? (snap.data() as UserDoc) : null;
            const role = data?.role ?? "user";
            const auditRole = data?.modules?.auditAr?.enabled
              ? data.modules.auditAr.role
              : null;

            if (auditRole) {
              void user
                .getIdTokenResult()
                .then((token) => {
                  if (token.claims.auditRole !== auditRole) {
                    return user.getIdToken(true);
                  }
                })
                .catch(() => {
                  // Best effort only; Firestore rules will still enforce claims.
                });
            }

            setState({
              user,
              loading: false,
              isAdmin: role === "admin",
              modules: data?.modules,
            });
          },
          () => {
            // Fallback if Firestore listener fails
            setState({ user, loading: false, isAdmin: false, modules: undefined });
          }
        );
      } else {
        setState({ user: null, loading: false, isAdmin: false, modules: undefined });
      }
    });

    return () => {
      unsubAuth();
      if (unsubFirestore) unsubFirestore();
    };
  }, []);

  return state;
}
