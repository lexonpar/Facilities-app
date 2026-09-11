"use client";

import Link from "next/link";
import { CalendarDays, ClipboardList, House, Plus } from "lucide-react";
import { STAFF_TOOLS_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { IssueView } from "@/lib/types/issue";

type MobileBottomNavProps = {
  view: IssueView;
  onViewChange: (view: IssueView) => void;
};

export function MobileBottomNav({ view, onViewChange }: MobileBottomNavProps) {
  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200/80 bg-white/95 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1">
        <a
          href={STAFF_TOOLS_URL}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-zinc-500"
        >
          <House className="h-6 w-6" aria-hidden="true" />
          <span className="text-[10px] font-medium">Apps</span>
        </a>
        <NavItem
          active={view === "list"}
          label="Issues"
          onClick={() => onViewChange("list")}
        >
          <ClipboardList className="h-6 w-6" />
        </NavItem>
        <NavItem
          active={view === "calendar"}
          label="Calendar"
          onClick={() => onViewChange("calendar")}
        >
          <CalendarDays className="h-6 w-6" />
        </NavItem>
        <Link
          href="/submit"
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-zinc-500"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1a73e8] text-white shadow-lg shadow-[#1a73e8]/30">
            <Plus className="h-6 w-6" />
          </span>
          <span className="text-[10px] font-medium">New</span>
        </Link>
      </div>
    </nav>
  );
}

function NavItem({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 py-2 transition",
        active ? "text-[#1a73e8]" : "text-zinc-500",
      )}
    >
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
