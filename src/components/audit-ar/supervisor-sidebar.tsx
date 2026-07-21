"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  ClipboardList,
  ClipboardCheck,
  Tags,
  Users,
  MapPin,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", href: "/audit-ar/supervisor", icon: LayoutDashboard, exact: true },
  { title: "Unit & Master Data", href: "/audit-ar/supervisor/units", icon: Building2 },
  { title: "Hasil Audit", href: "/audit-ar/supervisor/results", icon: ClipboardList },
  { title: "Review Audit", href: "/audit-ar/supervisor/review", icon: ClipboardCheck },
  { title: "Kategori", href: "/audit-ar/supervisor/categories", icon: Tags },
  { title: "Tim", href: "/audit-ar/supervisor/team", icon: Users },
  { title: "Audit Lapangan", href: "/audit-ar/field", icon: MapPin },
];

export function SupervisorSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />} tooltip="Ganti workspace">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-color.png" alt="" className="size-7 shrink-0 dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-white.png" alt="" className="hidden size-7 shrink-0 dark:block" />
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-heading font-semibold text-sm">Audit AR</span>
                <span className="text-xs text-muted-foreground">Supervisor · Ganti workspace</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton render={<Link href={item.href} />} isActive={isActive}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="px-3 py-2 group-data-[collapsible=icon]:hidden">
          <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
            Audit Data Analytics - ASG
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
