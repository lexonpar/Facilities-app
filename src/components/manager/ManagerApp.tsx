"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Plus,
  Search,
  Users,
  Wifi,
  WifiOff,
  Loader2,
} from "lucide-react";
import { STAFF_TOOLS_URL } from "@/lib/constants";
import { canManageTeam } from "@/lib/types/profile";
import type { WorkflowStatus } from "@/lib/types/issue";
import { issueTitle } from "@/lib/format";
import { countStaleIssues } from "@/lib/issues";
import { useAuth } from "@/hooks/useAuth";
import { useIssues } from "@/hooks/useIssues";
import { useMaintenance } from "@/hooks/useMaintenance";
import { useLeadNavigation } from "@/hooks/useLeadNavigation";
import { Sidebar, ViewToggle } from "./Sidebar";
import { IssueListPanel } from "./IssueListPanel";
import { IssueDetailPanel } from "./IssueDetailPanel";
import { MaintenanceDetailPanel } from "./MaintenanceDetailPanel";
import { CalendarView } from "./CalendarView";
import { MobileBottomNav } from "./MobileBottomNav";

export function ManagerApp() {
  const { profile } = useAuth();
  const { issues, loading, error, refetch } = useIssues();
  const {
    items: maintenance,
    loading: maintenanceLoading,
    error: maintenanceError,
    refetch: refetchMaintenance,
  } = useMaintenance();
  const {
    view,
    tab: listTab,
    issueId: selectedId,
    maintenanceId,
    navigate,
    closeDetail,
  } = useLeadNavigation();
  const [search, setSearch] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [calendarMode, setCalendarMode] = useState<"month" | "week">("month");
  const [mutating, setMutating] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter(
      (i) =>
        issueTitle(i).toLowerCase().includes(q) ||
        i.comment.toLowerCase().includes(q) ||
        i.submitted_by.toLowerCase().includes(q) ||
        i.id.includes(q) ||
        i.department.includes(q),
    );
  }, [issues, search]);

  const staleCount = useMemo(() => countStaleIssues(issues), [issues]);

  const selected = filtered.find((i) => i.id === selectedId) ?? null;
  const selectedMaintenance =
    maintenance.find((m) => m.id === maintenanceId) ?? null;
  const openCount = issues.filter((i) => i.status === "open").length;
  const showMobileIssueDetail = Boolean(selectedId && selected);
  const showMobileMaintenanceDetail = Boolean(
    view === "calendar" && maintenanceId && selectedMaintenance,
  );
  const hideMobileChrome =
    showMobileIssueDetail || showMobileMaintenanceDetail;

  async function patchIssue(
    id: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    setMutating(true);
    try {
      const res = await fetch(`/api/issues/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? "Update failed");
        return false;
      }
      return true;
    } finally {
      setMutating(false);
    }
  }

  async function handleWorkflowChange(id: string, workflow_status: WorkflowStatus) {
    const ok = await patchIssue(id, { action: "workflow", workflow_status });
    if (ok) navigate({ tab: "todo", issueId: id, maintenanceId: null });
  }

  async function handleComplete(id: string, note?: string) {
    const ok = await patchIssue(id, {
      action: "complete",
      completion_note: note,
    });
    if (ok) navigate({ tab: "done", issueId: id, maintenanceId: null });
  }

  async function handleRecall(id: string) {
    const ok = await patchIssue(id, { action: "recall" });
    if (ok) navigate({ tab: "todo", issueId: id, maintenanceId: null });
  }

  function selectIssue(id: string) {
    navigate({ view, tab: listTab, issueId: id, maintenanceId: null });
  }

  function selectMaintenance(id: string) {
    navigate({
      view: "calendar",
      tab: listTab,
      issueId: null,
      maintenanceId: id,
    });
  }

  function changeView(nextView: typeof view) {
    navigate({
      view: nextView,
      tab: listTab,
      issueId: null,
      maintenanceId: null,
    });
  }

  function changeTab(nextTab: typeof listTab) {
    navigate({ view, tab: nextTab, issueId: null, maintenanceId: null });
  }

  const detailProps = {
    issue: selected,
    disabled: mutating,
    onWorkflowChange: handleWorkflowChange,
    onComplete: handleComplete,
    onRecall: handleRecall,
  };

  const pageLoading = loading || (view === "calendar" && maintenanceLoading);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#f4f5f7]">
      <Sidebar view={view} onViewChange={changeView} profile={profile} />

      <div className="flex min-w-0 flex-1 flex-col pb-[72px] lg:pb-0">
        <header
          className={`shrink-0 border-b border-zinc-200 bg-white px-4 py-3 ${hideMobileChrome ? "hidden lg:block" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={STAFF_TOOLS_URL}
              className="hidden h-10 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 lg:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              All apps
            </a>
            <ViewToggle view={view} onViewChange={changeView} />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 lg:text-2xl lg:font-semibold">
                {view === "calendar" ? "Calendar" : "Issues"}
              </h1>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                {error ? (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                    Offline / config error
                  </>
                ) : (
                  <>
                    <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                    Live · {openCount} open
                    {view === "calendar" && maintenance.length > 0
                      ? ` · ${maintenance.length} maintenance`
                      : ""}
                  </>
                )}
              </p>
            </div>

            {profile && canManageTeam(profile.role) ? (
              <Link
                href="/admin/team"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm lg:hidden"
                aria-label="Team permissions"
                title="Team permissions"
              >
                <Users className="h-5 w-5" />
              </Link>
            ) : null}

            <Link
              href="/submit"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1a73e8] text-white shadow-md lg:hidden"
              aria-label="New issue"
            >
              <Plus className="h-5 w-5" />
            </Link>

            <div className="relative hidden min-w-[200px] max-w-md flex-1 lg:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                placeholder="Search issues…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#1a73e8] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]/20"
              />
            </div>

            <Link
              href="/submit"
              className="hidden items-center gap-1.5 rounded-lg bg-[#1a73e8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1557b0] lg:flex"
            >
              <Plus className="h-4 w-4" />
              New issue
            </Link>
          </div>

          <div className="relative mt-3 lg:hidden">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              placeholder="Search issues…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#1a73e8] focus:bg-white focus:ring-2 focus:ring-[#1a73e8]/20"
            />
          </div>
        </header>

        {error ? (
          <div
            className={`border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 ${hideMobileChrome ? "hidden lg:block" : ""}`}
          >
            {error}{" "}
            <button
              type="button"
              onClick={() => refetch()}
              className="font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : null}

        {maintenanceError && view === "calendar" ? (
          <div
            className={`border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 ${hideMobileChrome ? "hidden lg:block" : ""}`}
          >
            Maintenance schedule: {maintenanceError}. Run migration 003 and{" "}
            <code className="text-xs">node scripts/seed-maintenance.mjs</code>.{" "}
            <button
              type="button"
              onClick={() => refetchMaintenance()}
              className="font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : null}

        {staleCount > 0 && view === "list" ? (
          <div
            className={`flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 ${hideMobileChrome ? "hidden lg:flex" : "flex"}`}
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <span className="font-semibold">
                {staleCount} open {staleCount === 1 ? "issue has" : "issues have"}
              </span>{" "}
              been on the list for more than a week. Please review and close or
              update them.
            </p>
          </div>
        ) : null}

        {pageLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {showMobileIssueDetail ? (
              <div className="fixed inset-0 z-50 flex flex-col lg:hidden">
                <IssueDetailPanel
                  {...detailProps}
                  variant="mobile"
                  onBack={closeDetail}
                />
              </div>
            ) : null}

            {showMobileMaintenanceDetail && selectedMaintenance ? (
              <div className="fixed inset-0 z-50 flex flex-col lg:hidden">
                <MaintenanceDetailPanel
                  item={selectedMaintenance}
                  variant="mobile"
                  onBack={closeDetail}
                />
              </div>
            ) : null}

            {view === "list" ? (
              <div className="flex min-h-0 flex-1">
                <IssueListPanel
                  issues={filtered}
                  tab={listTab}
                  onTabChange={changeTab}
                  selectedId={selectedId}
                  onSelect={selectIssue}
                  className={showMobileIssueDetail ? "hidden lg:flex" : "flex"}
                />
                <div className="hidden min-w-0 flex-1 lg:flex">
                  <IssueDetailPanel {...detailProps} variant="desktop" />
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <CalendarView
                    issues={filtered}
                    maintenanceItems={maintenance}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    calendarMode={calendarMode}
                    onCalendarModeChange={setCalendarMode}
                    selectedIssueId={selectedId}
                    selectedMaintenanceId={maintenanceId}
                    onSelectIssue={selectIssue}
                    onSelectMaintenance={selectMaintenance}
                  />
                </div>
                {selectedMaintenance ? (
                  <div className="hidden w-[400px] shrink-0 border-l border-zinc-200 lg:block">
                    <MaintenanceDetailPanel
                      item={selectedMaintenance}
                      variant="desktop"
                    />
                  </div>
                ) : selected ? (
                  <div className="hidden w-[400px] shrink-0 border-l border-zinc-200 lg:block">
                    <IssueDetailPanel {...detailProps} variant="desktop" />
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>

      <MobileBottomNav view={view} onViewChange={changeView} />
    </div>
  );
}
