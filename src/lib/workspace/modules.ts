import { ClipboardList, type LucideIcon } from "lucide-react";
import type { UserDoc } from "@/lib/shared/types";

// The central registry of feature modules (workspaces). It holds METADATA ONLY
// and never imports a module's internals, so a module can be disabled or removed
// without breaking the shell. The dependency rule is one-way: modules import the
// shell/shared; the shell never imports a module.
//
// This app is the standalone Audit AR deployment, so the registry has a single
// module. The registry is kept (rather than inlined) so the shared workspace
// shell — the guard's "no access" redirect and the `/` landing page — keeps
// working unchanged and a second module could be re-added later.

export type ModuleKey = "auditAr";

export interface ModuleAccessContext {
  isAuthenticated: boolean;
  isAdmin: boolean;
  auditEnabled: boolean;
  auditRole: "supervisor" | "fieldAudit" | null;
}

export interface AppModule {
  key: ModuleKey;
  label: string;
  description: string;
  basePath: string;
  enabled: boolean; // global feature flag, overridable by env
  icon: LucideIcon;
  hasAccess: (c: ModuleAccessContext) => boolean;
  landingPath: (c: ModuleAccessContext) => string;
}

export const MODULES: AppModule[] = [
  {
    key: "auditAr",
    label: "Audit AR",
    description:
      "Audit Account Receivable — audit unit properti di lapangan.",
    basePath: "/audit-ar",
    enabled: process.env.NEXT_PUBLIC_MODULE_AUDIT_AR !== "false",
    icon: ClipboardList,
    hasAccess: (c) => c.auditEnabled && !!c.auditRole,
    landingPath: (c) =>
      c.auditRole === "supervisor" ? "/audit-ar/supervisor" : "/audit-ar/field",
  },
];

/** Build the access context from the shared auth state (no module imports). */
export function buildModuleContext(auth: {
  user: unknown;
  isAdmin: boolean;
  modules: UserDoc["modules"];
}): ModuleAccessContext {
  const audit = auth.modules?.auditAr;
  return {
    isAuthenticated: !!auth.user,
    isAdmin: auth.isAdmin,
    auditEnabled: !!audit?.enabled,
    auditRole: audit?.enabled
      ? (audit.role as ModuleAccessContext["auditRole"])
      : null,
  };
}

export function accessibleModules(ctx: ModuleAccessContext): AppModule[] {
  return MODULES.filter((m) => m.enabled && m.hasAccess(ctx));
}

export function getModule(key: ModuleKey): AppModule | undefined {
  return MODULES.find((m) => m.key === key);
}

export function isModuleEnabled(key: ModuleKey): boolean {
  return !!getModule(key)?.enabled;
}
