"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Intake", href: "/intake", icon: Inbox },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Settings", href: "/settings", icon: Settings },
];

type SidebarProps = {
  user: {
    email: string;
    name: string | null;
  };
};

function deriveInitials(name: string | null, email: string) {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    const initials = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
    if (initials.length > 0) return initials;
  }
  return email.slice(0, 2).toUpperCase();
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const displayName = user.name ?? user.email.split("@")[0];
  const initials = deriveInitials(user.name, user.email);

  return (
    <nav className="w-60 h-screen sticky top-0 bg-navy flex flex-col">
      <div className="px-4 py-5 border-b border-white/10">
        <span className="text-xl font-semibold text-white tracking-tight">
          Basefolio
        </span>
      </div>

      <div className="flex-1 px-2 py-4 space-y-1">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(`${href}/`);

          if (isActive) {
            return (
              <Link
                key={href}
                href={href}
                aria-current="page"
                className="flex items-center gap-3 px-3 py-2 rounded-md bg-blue/20 border-l-2 border-teal text-white text-sm font-medium"
              >
                <Icon className="w-5 h-5 text-teal" aria-hidden />
                {label}
              </Link>
            );
          }

          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-white/60 hover:text-white hover:bg-white/5 text-sm transition-colors"
            >
              <Icon className="w-5 h-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>

      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full bg-blue flex items-center justify-center text-white text-xs font-semibold"
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {displayName}
            </p>
            <p className="text-xs text-white/40 truncate">{user.email}</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
