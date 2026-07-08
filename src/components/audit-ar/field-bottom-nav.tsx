"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2 } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { title: "Beranda", href: "/audit-ar/field", icon: LayoutDashboard, exact: true },
  { title: "Unit", href: "/audit-ar/field/units", icon: Building2 },
];

export function FieldBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 z-10 grid grid-cols-2 border-t bg-background/95 backdrop-blur">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2.5 text-xs",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
