"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuth } from "@/hooks/useAuth";
import type { Profile, UserRole } from "@/lib/types/profile";
import { canManageTeam } from "@/lib/types/profile";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<UserRole, string> = {
  pending: "Pending — no dashboard",
  staff: "Staff — submit only",
  manager: "Manager — full dashboard",
  admin: "Admin — dashboard + team",
};

type AllowlistEntry = {
  local_part: string;
  auto_admin: boolean;
  created_at: string;
};

function isPunchAccount(profile: Profile) {
  return profile.email.toLowerCase().endsWith("@auth.onpar.invalid");
}

function TeamAdmin() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newLocalPart, setNewLocalPart] = useState("");
  const [allowMsg, setAllowMsg] = useState<string | null>(null);
  const [allowing, setAllowing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, allowRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/allowlist"),
      ]);
      const usersData = (await usersRes.json()) as {
        users?: Profile[];
        error?: string;
      };
      const allowData = (await allowRes.json()) as {
        entries?: AllowlistEntry[];
        error?: string;
      };
      if (!usersRes.ok) throw new Error(usersData.error ?? "Failed to load team");
      setUsers(usersData.users ?? []);
      setAllowlist(allowData.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile || !canManageTeam(profile.role)) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [profile, load]);

  async function allowNewSignup(e: React.FormEvent) {
    e.preventDefault();
    setAllowing(true);
    setAllowMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_part: newLocalPart }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not add");
      setAllowMsg(data.message ?? "Added.");
      setNewLocalPart("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add");
    } finally {
      setAllowing(false);
    }
  }

  async function updateRole(userId: string, role: UserRole) {
    setSavingId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingId(null);
    }
  }

  if (!profile || !canManageTeam(profile.role)) {
    return (
      <div className="mobile-shell p-8 text-center">
        <p className="text-zinc-600">Admin access required.</p>
        <Link href="/lead" className="mt-4 inline-block text-[#1a73e8]">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mobile-shell min-h-[100dvh] bg-[#f4f5f7]">
      <header className="border-b border-zinc-200 bg-white px-4 py-3">
        <Link
          href="/lead"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#1a73e8]"
        >
          <ChevronLeft className="h-5 w-5" />
          Dashboard
        </Link>
        <h1 className="mt-2 text-xl font-bold text-zinc-900">Team permissions</h1>
        <p className="text-sm text-zinc-600">
          Active 7shifts employees are added automatically the first time they
          sign in with their Punch ID. Email approvals below are for admin
          account access only.
        </p>
      </header>

      <div className="p-4">
        <form
          onSubmit={allowNewSignup}
          className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-zinc-900">
            Allow an admin email account
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Use this only when someone needs the separate admin email sign-in.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={newLocalPart}
              onChange={(e) => setNewLocalPart(e.target.value.toLowerCase())}
              placeholder="newperson"
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
            />
            <span className="self-center text-sm text-zinc-500">@onparbar.com</span>
            <button
              type="submit"
              disabled={allowing || !newLocalPart.trim()}
              className="rounded-lg bg-[#1a73e8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {allowing ? "Adding…" : "Allow"}
            </button>
          </div>
          {allowMsg ? (
            <p className="mt-2 text-xs text-teal-700">{allowMsg}</p>
          ) : null}
        </form>
        {error ? (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#1a73e8]" />
          </div>
        ) : (
          <>
          {(() => {
            const joinedUsernames = new Set(users.map((u) => u.username));
            const pending = allowlist.filter(
              (e) => !joinedUsernames.has(e.local_part),
            );
            if (pending.length === 0) return null;
            return (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Admin emails — waiting to sign up
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  These people can use Admin email sign-in → Create account.
                </p>
                <ul className="mt-2 space-y-2">
                  {pending.map((e) => (
                    <li
                      key={e.local_part}
                      className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                    >
                      {e.local_part}@onparbar.com
                      {e.auto_admin ? (
                        <span className="ml-2 text-xs text-indigo-600">
                          (auto-admin on sign-up)
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}

          <h2 className="mb-2 text-sm font-semibold text-zinc-900">
            Team members
          </h2>
          {users.length === 0 ? (
            <p className="mb-4 text-sm text-zinc-500">
              No accounts yet. After someone signs up, they will show here.
            </p>
          ) : null}
          <ul className="space-y-3">
            {users.map((u) => {
              const punchAccount = isPunchAccount(u);
              return (
                <li
                  key={u.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-zinc-900">
                        {u.display_name ?? u.username}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {punchAccount
                          ? "7shifts Punch ID account · access managed by ShiftFlow"
                          : `@${u.username} · ${u.email}`}
                      </p>
                    </div>
                    <select
                      value={u.role}
                      disabled={savingId === u.id || punchAccount}
                      onChange={(e) =>
                        updateRole(u.id, e.target.value as UserRole)
                      }
                      className={cn(
                        "rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium",
                        u.role === "admin" && "border-indigo-300 bg-indigo-50",
                        u.role === "manager" && "border-teal-300 bg-teal-50",
                      )}
                    >
                      {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminTeamPage() {
  return (
    <AuthGate>
      <TeamAdmin />
    </AuthGate>
  );
}
