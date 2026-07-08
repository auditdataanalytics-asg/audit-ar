"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";

import { ThemeToggle } from "@/components/shared/theme-toggle";
import { useAuth } from "@/lib/shared/use-auth";
import {
  accessibleModules,
  buildModuleContext,
} from "@/lib/workspace/modules";
import { useWorkspaceStore } from "@/lib/workspace/workspace-store";

export default function WorkspaceSelectorPage() {
  const router = useRouter();
  const auth = useAuth();
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const ctx = buildModuleContext(auth);
  const modules = accessibleModules(ctx);
  const onlyOne = !auth.loading && modules.length === 1;

  // If the user can only reach one workspace, skip the chooser entirely.
  useEffect(() => {
    if (auth.loading || modules.length !== 1) return;
    const target = modules[0];
    setActiveWorkspace(target.key);
    router.replace(target.landingPath(ctx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, modules.length]);

  if (auth.loading || onlyOne) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const firstName = auth.user?.displayName?.split(" ")[0] || "User";

  return (
    <div className="relative min-h-screen">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-12">
        <div className="mb-8">
          <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            Halo, {firstName}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Pilih workspace yang ingin kamu buka.
          </p>
        </div>

        {modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada workspace yang tersedia untuk akunmu. Hubungi admin.
          </p>
        ) : (
          <div className="divide-y divide-border/60 border-y border-border/60">
            {modules.map((m) => (
              <Link
                key={m.key}
                href={m.landingPath(ctx)}
                onClick={() => setActiveWorkspace(m.key)}
                className="group flex items-center justify-between gap-4 py-6 transition-colors"
              >
                <div>
                  <h2 className="font-heading text-xl font-semibold tracking-tight group-hover:text-primary">
                    {m.label}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {m.description}
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
