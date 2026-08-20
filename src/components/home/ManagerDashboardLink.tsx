"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import {
  canAccessManagerDashboard,
  type UserRole,
} from "@/lib/types/profile";

export function ManagerDashboardLink() {
  const [href, setHref] = useState("/login?next=/lead");
  const [subtitle, setSubtitle] = useState(
    "Sign in with your 7shifts Punch ID",
  );

  useEffect(() => {
    fetch("/api/auth/profile", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { profile?: { role?: UserRole } }) => {
        if (
          data.profile?.role &&
          canAccessManagerDashboard(data.profile.role)
        ) {
          setHref("/lead");
          setSubtitle("You’re signed in on this device — open dashboard");
        }
      })
      .catch(() => {
        /* keep sign-in link */
      });
  }, []);

  return (
    <Link
      href={href}
      className="surface-card flex items-center gap-4 p-4 transition active:scale-[0.99]"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/10 text-teal-700">
        <CalendarDays className="h-6 w-6" />
      </span>
      <span className="text-left">
        <span className="block font-semibold text-zinc-900">
          Manager dashboard
        </span>
        <span className="text-sm text-zinc-500">{subtitle}</span>
      </span>
    </Link>
  );
}
