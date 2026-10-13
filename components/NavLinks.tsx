"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Plus } from "lucide-react";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/servers/new", label: "Add Server", icon: Plus },
];

export function NavLinks({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className={orientation === "vertical" ? "flex flex-col gap-1" : "flex gap-1 overflow-x-auto"}
    >
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-surface-2 font-medium text-white"
                : "text-muted hover:bg-surface-2 hover:text-zinc-200"
            }`}
          >
            <Icon className={`size-4 ${active ? "text-accent" : ""}`} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
