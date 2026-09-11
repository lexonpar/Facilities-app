"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { VENUE_NAME } from "@/lib/constants";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  canAccessManagerDashboard,
  type UserRole,
} from "@/lib/types/profile";

const punchInputClass =
  "mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 text-center text-2xl font-semibold tracking-[0.4em] outline-none focus:border-[#1a73e8] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]/20";
const OWNER_ACCESS_OPTION_ID = "__staff_tools_owner__";
const STAFF_TOOLS_OWNER_URL = "/staff-tools/owner";

type PunchEmployee = {
  id: string;
  displayName: string;
  departmentNames: string[];
};

type PunchLoginResponse = {
  ok?: boolean;
  role?: UserRole;
  code?: string;
  error?: string;
};

function safeNextPath(value: string | null) {
  if (!value) return "/lead";
  try {
    const base = new URL("https://facilities.onpar.invalid");
    const target = new URL(value, base);
    return target.origin === base.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : "/lead";
  } catch {
    return "/lead";
  }
}

async function getCurrentRole(): Promise<UserRole | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch("/api/auth/profile", { cache: "no-store" });
      const data = (await response.json()) as {
        profile?: { role?: UserRole };
      };
      if (data.profile?.role) return data.profile.role;
    } catch {
      /* retry a recently refreshed session */
    }
    await new Promise((resolve) => setTimeout(resolve, 150 + attempt * 100));
  }
  return null;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const accessError = searchParams.get("error") === "access";

  const [employees, setEmployees] = useState<PunchEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [employeeLoadAttempt, setEmployeeLoadAttempt] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [punchId, setPunchId] = useState("");
  const [error, setError] = useState(
    accessError
      ? "Your Facilities access is not active. Ask an admin to verify the 7shifts roster sync."
      : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      const timer = window.setTimeout(() => setCheckingSession(false), 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;

    (async () => {
      const role = await getCurrentRole();
      if (cancelled) return;
      if (role && canAccessManagerDashboard(role)) {
        router.replace(next);
        router.refresh();
        return;
      }
      if (role === "staff") {
        router.replace("/submit");
        router.refresh();
        return;
      }
      setCheckingSession(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [next, router]);

  useEffect(() => {
    if (checkingSession || employeesLoaded || !isSupabaseConfigured()) return;

    const controller = new AbortController();

    fetch("/api/auth/punch/employees", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          employees?: PunchEmployee[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            data.error ?? "The active employee list is temporarily unavailable.",
          );
        }
        setEmployees(data.employees ?? []);
        setEmployeesLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The active employee list is temporarily unavailable.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setEmployeesLoading(false);
      });

    return () => controller.abort();
  }, [checkingSession, employeeLoadAttempt, employeesLoaded]);

  async function handlePunchSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (employeeId === OWNER_ACCESS_OPTION_ID) {
      window.location.assign(STAFF_TOOLS_OWNER_URL);
      return;
    }
    if (!employeeId) {
      setError("Choose your name first.");
      return;
    }
    if (!/^\d{1,12}$/.test(punchId)) {
      setError("Enter your 7shifts Punch ID using 1–12 digits.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/punch/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, punchId }),
      });
      const data = (await response.json()) as PunchLoginResponse;
      if (!response.ok || data.ok !== true) {
        let failure = data.error ?? "Punch ID sign-in could not be completed.";
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("retry-after"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            const minutes = Math.max(1, Math.ceil(retryAfter / 60));
            failure = `Too many sign-in attempts. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
          }
        }
        if (data.code === "invalid_login") setPunchId("");
        throw new Error(failure);
      }

      const destination =
        data.role && canAccessManagerDashboard(data.role) ? next : "/submit";
      router.replace(destination);
      router.refresh();
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Punch ID sign-in could not be completed.",
      );
      setSubmitting(false);
    }
  }

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-base outline-none focus:border-[#1a73e8] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]/20";

  return (
    <div className="mobile-shell flex min-h-[100dvh] flex-col px-5 py-8 safe-bottom">
      <Link href="/" className="text-sm font-medium text-[#1a73e8]">
        ← Home
      </Link>

      <div className="mx-auto mt-6 w-full max-w-md flex-1">
        <div className="surface-card p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            {VENUE_NAME}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900">Team sign in</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Choose your name and use the same Punch ID you use in 7shifts.
          </p>

          {searchParams.get("reason") === "remote-signout-unconfirmed" ? (
            <p role="status" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This device’s Facilities sign-in was cleared. Remote session revocation could not be confirmed. Close other Facilities tabs before sharing this device.
            </p>
          ) : null}

          {checkingSession ? (
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking this device…
            </div>
          ) : null}

          {!checkingSession && !isSupabaseConfigured() ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              App is not connected to the server. Check environment variables.
            </p>
          ) : null}

          {!checkingSession && error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}

          {!checkingSession ? (
            <>
              <form onSubmit={handlePunchSignIn} className="mt-5 space-y-4">
                <label className="block text-sm font-semibold text-zinc-900">
                  Your name
                  <select
                    required
                    value={employeeId}
                    disabled={employeesLoading || submitting}
                    onChange={(event) => {
                      setEmployeeId(event.target.value);
                      setPunchId("");
                      setError("");
                    }}
                    className={fieldClass}
                  >
                    <option value="">
                      {employeesLoading
                        ? "Loading active employees…"
                        : "Choose your name…"}
                    </option>
                    <option value={OWNER_ACCESS_OPTION_ID}>
                      Alexis Younker — Owner · Admin
                    </option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.displayName}
                        {employee.departmentNames.length
                          ? ` — ${employee.departmentNames.join(" · ")}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>

                {employeeId === OWNER_ACCESS_OPTION_ID ? (
                  <div className="rounded-xl border border-[#1a73e8]/20 bg-blue-50/70 p-4">
                    <p className="text-sm font-semibold text-zinc-900">
                      Owner and admin access
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">
                      Your admin account signs in securely through Staff Tools.
                    </p>
                    <a
                      href={STAFF_TOOLS_OWNER_URL}
                      className="mt-3 flex w-full items-center justify-center rounded-xl bg-[#1a73e8] py-3.5 text-sm font-semibold text-white"
                    >
                      Continue as Alexis
                    </a>
                  </div>
                ) : (
                  <>
                    <label className="block text-sm font-semibold text-zinc-900">
                      7shifts Punch ID
                      <input
                        required
                        type="password"
                        inputMode="numeric"
                        autoComplete="current-password"
                        maxLength={12}
                        placeholder="Enter Punch ID"
                        value={punchId}
                        disabled={!employeeId || submitting}
                        onChange={(event) =>
                          setPunchId(
                            event.target.value.replace(/\D/g, "").slice(0, 12),
                          )
                        }
                        className={punchInputClass}
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={submitting || employeesLoading || !employeeId}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a73e8] py-3.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Signing in…
                        </>
                      ) : (
                        "Sign in with Punch ID"
                      )}
                    </button>
                  </>
                )}
              </form>

              {!employeesLoading && !employeesLoaded ? (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setEmployeesLoading(true);
                    setEmployeeLoadAttempt((current) => current + 1);
                  }}
                  className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-800"
                >
                  Retry employee list
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#1a73e8]" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
