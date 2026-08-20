import Link from "next/link";
import { ClipboardList, Wrench } from "lucide-react";
import { ManagerDashboardLink } from "@/components/home/ManagerDashboardLink";
import { VENUE_NAME } from "@/lib/constants";

export default function HomePage() {
  return (
    <main className="mobile-shell flex min-h-[100dvh] flex-col px-5 py-10 safe-bottom">
      <div className="mx-auto w-full max-w-md flex-1">
        <div className="surface-card p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a73e8] text-white shadow-lg shadow-[#1a73e8]/25">
            <Wrench className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Facilities
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
            {VENUE_NAME}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            Report issues from the floor or manage the live maintenance queue.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/login?next=/submit"
            className="surface-card flex items-center gap-4 p-4 transition active:scale-[0.99]"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1a73e8]/10 text-[#1a73e8]">
              <ClipboardList className="h-6 w-6" />
            </span>
            <span className="text-left">
              <span className="block font-semibold text-zinc-900">
                Report an issue
              </span>
              <span className="text-sm text-zinc-500">
                Sign in with your 7shifts Punch ID
              </span>
            </span>
          </Link>

          <ManagerDashboardLink />
        </div>
      </div>
    </main>
  );
}
