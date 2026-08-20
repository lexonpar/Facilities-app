"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  isAllowedSignupEmail,
  parseLoginIdentifier,
} from "@/lib/auth/allowlist";
import {
  isValidPin,
  normalizePinInput,
  pinValidationMessage,
} from "@/lib/auth/pin";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  canAccessManagerDashboard,
  type UserRole,
} from "@/lib/types/profile";
import { VENUE_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const pinInputClass =
  "mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 text-center text-2xl font-semibold tracking-[0.4em] outline-none focus:border-[#1a73e8] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]/20";

type LoginMode = "punch" | "account-signin" | "account-signup";

type PunchEmployee = {
  id: string;
  displayName: string;
  departmentNames: string[];
};

type PunchLoginResponse = {
  ok?: boolean;
  role?: UserRole;
  redirect?: string;
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

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const accessError = searchParams.get("error") === "access";

  const [mode, setMode] = useState<LoginMode>("punch");
  const [employees, setEmployees] = useState<PunchEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [employeeLoadAttempt, setEmployeeLoadAttempt] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [punchId, setPunchId] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState(
    accessError
      ? "Your account does not have manager access yet. Ask an admin."
      : "",
  );
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      const timer = window.setTimeout(() => setCheckingSession(false), 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;

    (async () => {
      const role = await ensureProfileAndGetRole();
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
    if (
      checkingSession ||
      mode !== "punch" ||
      employeesLoaded ||
      !isSupabaseConfigured()
    ) {
      return;
    }
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
  }, [checkingSession, employeeLoadAttempt, employeesLoaded, mode]);

  async function ensureProfileAndGetRole(): Promise<UserRole | null> {
    try {
      await fetch("/api/auth/complete-signup", { method: "POST" });
    } catch {
      /* offline or old deploy */
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await fetch("/api/auth/profile", { cache: "no-store" });
        const data = (await res.json()) as { profile?: { role?: UserRole } };
        if (data.profile?.role) return data.profile.role;
      } catch {
        /* retry */
      }
      await new Promise((resolve) => setTimeout(resolve, 150 + attempt * 100));
    }
    return null;
  }

  async function afterAuthRedirect(authMode: "signin" | "signup") {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const role = await ensureProfileAndGetRole();

    if (role && canAccessManagerDashboard(role)) {
      router.replace(next);
      router.refresh();
      return;
    }

    if (role === "pending") {
      setMessage(
        "You're signed in. An admin must set your role to Manager under Team permissions before you can use the dashboard.",
      );
      return;
    }

    if (authMode === "signin") {
      setError(
        "Signed in, but your team profile is missing. Try again in a few seconds, or ask an admin to open Team permissions and confirm you appear in the list.",
      );
      return;
    }

    setMessage(
      "Account created. An admin must grant you Manager access in Team permissions before you can use the dashboard. Core team accounts are usually ready within a few seconds — try signing in.",
    );
  }

  function validatePinFields(): boolean {
    if (!isValidPin(pin)) {
      setError(pinValidationMessage());
      return false;
    }
    if (mode === "account-signup" && pin !== confirmPin) {
      setError("PINs do not match.");
      return false;
    }
    return true;
  }

  async function handlePunchSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
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

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");

    const { email } = parseLoginIdentifier(identifier);

    if (!validatePinFields()) {
      setSubmitting(false);
      return;
    }

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: pin,
    });

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    await afterAuthRedirect("signin");
    setSubmitting(false);
  }

  async function canRegister(email: string): Promise<boolean> {
    if (isAllowedSignupEmail(email)) return true;
    try {
      const res = await fetch(
        `/api/auth/check-signup?email=${encodeURIComponent(email)}`,
      );
      const data = (await res.json()) as { allowed?: boolean };
      return Boolean(data.allowed);
    } catch {
      return false;
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");

    const { email, username } = parseLoginIdentifier(identifier);
    if (!(await canRegister(email))) {
      setError(
        "This email is not approved for sign-up. Ask an admin to add you under Team permissions.",
      );
      setSubmitting(false);
      return;
    }

    if (!validatePinFields()) {
      setSubmitting(false);
      return;
    }

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password: pin,
      options: {
        data: {
          display_name: displayName.trim() || username,
          username,
        },
      },
    });

    if (signUpError) {
      const msg = signUpError.message.includes("Database error")
        ? "Sign-up is still blocked in the database. Your admin needs to run the short SQL fix (npm run apply:signup-fix), push the latest app to Vercel, then try Create account again."
        : signUpError.message;
      setError(msg);
      setSubmitting(false);
      return;
    }

    if (data.session) {
      await afterAuthRedirect("signup");
    } else {
      setMessage(
        "Account created. Sign in with the same email and PIN you just chose.",
      );
      setMode("account-signin");
    }
    setSubmitting(false);
  }

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-base outline-none focus:border-[#1a73e8] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]/20";
  const accountMode = mode === "account-signup" ? "signup" : "signin";

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
            {mode === "punch"
              ? "Choose your name and use the same Punch ID you use in 7shifts."
              : "Admin account access uses an On Par email or username and 6-digit PIN."}
          </p>

          {mode !== "punch" ? (
            <div className="mt-5 flex rounded-lg border border-zinc-200 p-0.5">
              <button
                type="button"
                onClick={() => setMode("account-signin")}
                className={cn(
                  "flex-1 rounded-md py-2 text-sm font-semibold",
                  mode === "account-signin"
                    ? "bg-[#1a73e8] text-white"
                    : "text-zinc-600",
                )}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("account-signup")}
                className={cn(
                  "flex-1 rounded-md py-2 text-sm font-semibold",
                  mode === "account-signup"
                    ? "bg-[#1a73e8] text-white"
                    : "text-zinc-600",
                )}
              >
                Create account
              </button>
            </div>
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
          {!checkingSession && message ? (
            <p
              role="status"
              className="mt-4 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900"
            >
              {message}
            </p>
          ) : null}

          {!checkingSession && mode === "punch" ? (
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
                    className={pinInputClass}
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

              <button
                type="button"
                onClick={() => {
                  setMode("account-signin");
                  setError("");
                  setMessage("");
                }}
                className="mt-5 w-full py-2 text-sm font-semibold text-[#1a73e8]"
              >
                Admin email sign-in
              </button>
            </>
          ) : null}

          {!checkingSession && mode !== "punch" ? (
            <>
              <form
                onSubmit={accountMode === "signin" ? handleSignIn : handleSignUp}
                className="mt-5 space-y-4"
              >
                <label className="block text-sm font-semibold text-zinc-900">
                  Email or username
                  <input
                    required
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    className={fieldClass}
                  />
                </label>

                {accountMode === "signup" ? (
                  <label className="block text-sm font-semibold text-zinc-900">
                    Display name (optional)
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                ) : null}

                <label className="block text-sm font-semibold text-zinc-900">
                  {accountMode === "signup"
                    ? "Create a 6-digit PIN"
                    : "6-digit PIN"}
                  <input
                    required
                    type="password"
                    inputMode="numeric"
                    autoComplete={
                      accountMode === "signin"
                        ? "current-password"
                        : "new-password"
                    }
                    maxLength={6}
                    placeholder="••••"
                    value={pin}
                    onChange={(event) =>
                      setPin(normalizePinInput(event.target.value))
                    }
                    className={pinInputClass}
                  />
                </label>

                {accountMode === "signup" ? (
                  <label className="block text-sm font-semibold text-zinc-900">
                    Confirm 6-digit PIN
                    <input
                      required
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={6}
                      placeholder="••••"
                      value={confirmPin}
                      onChange={(event) =>
                        setConfirmPin(normalizePinInput(event.target.value))
                      }
                      className={pinInputClass}
                    />
                  </label>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a73e8] py-3.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Please wait…
                    </>
                  ) : accountMode === "signin" ? (
                    "Sign in"
                  ) : (
                    "Create account"
                  )}
                </button>
              </form>
              <button
                type="button"
                onClick={() => {
                  setMode("punch");
                  setError("");
                  setMessage("");
                  if (!employeesLoaded) setEmployeesLoading(true);
                }}
                className="mt-5 w-full py-2 text-sm font-semibold text-[#1a73e8]"
              >
                Use 7shifts Punch ID
              </button>
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
