"use client";

import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { getDepartmentColor, getDepartmentLabel } from "@/lib/departments";
import { MAINTENANCE_COLOR } from "@/lib/maintenance/constants";
import { maintenanceOccursOnDay } from "@/lib/maintenance/recurrence";
import { issueTitle } from "@/lib/format";
import type { Issue } from "@/lib/types/issue";
import type { MaintenanceItem } from "@/lib/types/maintenance";
import { cn } from "@/lib/utils";

type CalendarViewProps = {
  issues: Issue[];
  maintenanceItems: MaintenanceItem[];
  month: Date;
  onMonthChange: (d: Date) => void;
  calendarMode: "month" | "week";
  onCalendarModeChange: (m: "month" | "week") => void;
  selectedIssueId: string | null;
  selectedMaintenanceId: string | null;
  onSelectIssue: (id: string) => void;
  onSelectMaintenance: (id: string) => void;
};

function shortMaintenanceTitle(title: string): string {
  const t = title.split("-")[0]?.trim() ?? title;
  return t.length > 28 ? `${t.slice(0, 25)}…` : t;
}

export function CalendarView({
  issues,
  maintenanceItems,
  month,
  onMonthChange,
  calendarMode,
  onCalendarModeChange,
  selectedIssueId,
  selectedMaintenanceId,
  onSelectIssue,
  onSelectMaintenance,
}: CalendarViewProps) {
  const [focusedDay, setFocusedDay] = useState<Date | null>(null);

  const monthStart = startOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weekStart = startOfWeek(month, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({
    start: weekStart,
    end: addDays(weekStart, 6),
  });

  function issuesForDay(day: Date) {
    return issues.filter((i) => isSameDay(parseISO(i.created_at), day));
  }

  function maintenanceForDay(day: Date) {
    return maintenanceItems.filter((item) => maintenanceOccursOnDay(item, day));
  }

  const displayDay = focusedDay ?? new Date();
  const focusedIssues = issuesForDay(displayDay);
  const focusedMaintenance = maintenanceForDay(displayDay);

  const monthGridDays = useMemo(() => days, [days]);

  function selectDay(day: Date) {
    setFocusedDay(day);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-zinc-200 px-3 py-3 md:px-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex justify-center md:justify-start">
            <div className="flex rounded-lg border border-zinc-200 p-0.5">
              <ModeBtn
                active={calendarMode === "month"}
                onClick={() => onCalendarModeChange("month")}
              >
                Month
              </ModeBtn>
              <ModeBtn
                active={calendarMode === "week"}
                onClick={() => onCalendarModeChange("week")}
              >
                Week
              </ModeBtn>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 md:justify-center">
            <button
              type="button"
              onClick={() => onMonthChange(subMonths(month, 1))}
              className="rounded-lg p-2 hover:bg-zinc-100 active:bg-zinc-200"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-center text-base font-semibold md:min-w-[160px] md:text-lg">
              {format(month, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => onMonthChange(addMonths(month, 1))}
              className="rounded-lg p-2 hover:bg-zinc-100 active:bg-zinc-200"
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 flex-col overflow-hidden md:flex">
        <WeekdayHeader />
        <div
          className={cn(
            "grid flex-1 auto-rows-fr grid-cols-7 overflow-auto",
            calendarMode === "week" && "min-h-0",
          )}
        >
          {(calendarMode === "week" ? weekDays : days).map((day) => (
            <DesktopDayCell
              key={day.toISOString()}
              day={day}
              month={month}
              calendarMode={calendarMode}
              issues={issuesForDay(day)}
              maintenance={maintenanceForDay(day)}
              selectedIssueId={selectedIssueId}
              selectedMaintenanceId={selectedMaintenanceId}
              onSelectIssue={onSelectIssue}
              onSelectMaintenance={onSelectMaintenance}
            />
          ))}
        </div>
        <Legend />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden">
        {calendarMode === "month" ? (
          <>
            <WeekdayHeader compact />
            <div className="grid shrink-0 grid-cols-7 border-b border-zinc-100 bg-white px-1 py-1">
              {monthGridDays.map((day) => {
                const dayIssues = issuesForDay(day);
                const dayMaint = maintenanceForDay(day);
                const inMonth = isSameMonth(day, month);
                const today = isSameDay(day, new Date());
                const focused = focusedDay && isSameDay(day, focusedDay);
                const total = dayIssues.length + dayMaint.length;

                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={cn(
                      "flex min-h-[52px] flex-col items-center rounded-lg py-1.5 transition",
                      !inMonth && "opacity-40",
                      focused && "bg-[#1a73e8]/10 ring-2 ring-[#1a73e8]",
                      !focused && today && "bg-[#1a73e8] text-white",
                    )}
                  >
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        today && !focused && "text-white",
                        !today && "text-zinc-800",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <div className="mt-1 flex flex-wrap justify-center gap-0.5 px-0.5">
                      {dayMaint.slice(0, 2).map((item) => (
                        <span
                          key={item.id}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: MAINTENANCE_COLOR }}
                        />
                      ))}
                      {dayIssues.slice(0, 2).map((issue) => (
                        <span
                          key={issue.id}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: getDepartmentColor(issue.department),
                          }}
                        />
                      ))}
                    </div>
                    {total > 4 ? (
                      <span className="mt-0.5 text-[10px] text-zinc-500">
                        +{total - 4}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <MobileDayAgenda
              day={displayDay}
              issues={focusedIssues}
              maintenance={focusedMaintenance}
              selectedIssueId={selectedIssueId}
              selectedMaintenanceId={selectedMaintenanceId}
              onSelectIssue={onSelectIssue}
              onSelectMaintenance={onSelectMaintenance}
            />
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {weekDays.map((day) => {
              const dayIssues = issuesForDay(day);
              const dayMaint = maintenanceForDay(day);
              const today = isSameDay(day, new Date());
              return (
                <div
                  key={day.toISOString()}
                  className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3"
                >
                  <p
                    className={cn(
                      "mb-2 text-sm font-semibold",
                      today ? "text-[#1a73e8]" : "text-zinc-800",
                    )}
                  >
                    {format(day, "EEEE, MMM d")}
                    {today ? " · Today" : ""}
                  </p>
                  {dayMaint.length === 0 && dayIssues.length === 0 ? (
                    <p className="text-sm text-zinc-500">Nothing scheduled</p>
                  ) : (
                    <div className="space-y-2">
                      {dayMaint.map((item) => (
                        <MaintenanceChip
                          key={item.id}
                          item={item}
                          selected={selectedMaintenanceId === item.id}
                          onSelect={() => onSelectMaintenance(item.id)}
                          large
                        />
                      ))}
                      {dayIssues.map((issue) => (
                        <IssueChip
                          key={issue.id}
                          issue={issue}
                          selected={selectedIssueId === issue.id}
                          onSelect={() => onSelectIssue(issue.id)}
                          large
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-4 py-2 text-sm font-medium",
        active
          ? "bg-[#1a73e8] text-white"
          : "text-zinc-600 hover:bg-zinc-50",
      )}
    >
      {children}
    </button>
  );
}

function WeekdayHeader({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center font-medium uppercase text-zinc-500",
        compact ? "text-[10px]" : "text-xs",
      )}
    >
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div key={d} className={cn(compact ? "py-1.5" : "py-2")}>
          {d}
        </div>
      ))}
    </div>
  );
}

function DesktopDayCell({
  day,
  month,
  calendarMode,
  issues,
  maintenance,
  selectedIssueId,
  selectedMaintenanceId,
  onSelectIssue,
  onSelectMaintenance,
}: {
  day: Date;
  month: Date;
  calendarMode: "month" | "week";
  issues: Issue[];
  maintenance: MaintenanceItem[];
  selectedIssueId: string | null;
  selectedMaintenanceId: string | null;
  onSelectIssue: (id: string) => void;
  onSelectMaintenance: (id: string) => void;
}) {
  const inMonth = isSameMonth(day, month);
  const today = isSameDay(day, new Date());
  const max = calendarMode === "week" ? 10 : 4;
  const events = [
    ...maintenance.map((item) => ({ type: "maint" as const, item })),
    ...issues.map((issue) => ({ type: "issue" as const, issue })),
  ];
  const shown = events.slice(0, max);
  const extra = events.length - shown.length;

  return (
    <div
      className={cn(
        "min-h-[100px] border-b border-r border-zinc-100 p-1",
        !inMonth && calendarMode === "month" && "bg-zinc-50/80",
        calendarMode === "week" && "min-h-[320px]",
      )}
    >
      <div className="flex justify-end p-1">
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-sm",
            today && "bg-[#1a73e8] font-semibold text-white",
            !today && "text-zinc-700",
            !inMonth && !today && "text-zinc-400",
          )}
        >
          {format(day, "d")}
        </span>
      </div>
      <div className="space-y-1 px-0.5">
        {shown.map((ev) =>
          ev.type === "maint" ? (
            <MaintenanceChip
              key={ev.item.id}
              item={ev.item}
              selected={selectedMaintenanceId === ev.item.id}
              onSelect={() => onSelectMaintenance(ev.item.id)}
            />
          ) : (
            <IssueChip
              key={ev.issue.id}
              issue={ev.issue}
              selected={selectedIssueId === ev.issue.id}
              onSelect={() => onSelectIssue(ev.issue.id)}
            />
          ),
        )}
        {extra > 0 ? (
          <p className="px-1 text-xs text-zinc-500">+{extra} more</p>
        ) : null}
      </div>
    </div>
  );
}

function MobileDayAgenda({
  day,
  issues,
  maintenance,
  selectedIssueId,
  selectedMaintenanceId,
  onSelectIssue,
  onSelectMaintenance,
}: {
  day: Date;
  issues: Issue[];
  maintenance: MaintenanceItem[];
  selectedIssueId: string | null;
  selectedMaintenanceId: string | null;
  onSelectIssue: (id: string) => void;
  onSelectMaintenance: (id: string) => void;
}) {
  const total = issues.length + maintenance.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 bg-zinc-50">
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-zinc-900">
          {format(day, "EEEE, MMMM d")}
        </p>
        <p className="text-xs text-zinc-500">
          {total} item{total === 1 ? "" : "s"} — tap to open
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            Nothing scheduled this day
          </p>
        ) : (
          <div className="space-y-2">
            {maintenance.map((item) => (
              <MaintenanceChip
                key={item.id}
                item={item}
                selected={selectedMaintenanceId === item.id}
                onSelect={() => onSelectMaintenance(item.id)}
                large
              />
            ))}
            {issues.map((issue) => (
              <IssueChip
                key={issue.id}
                issue={issue}
                selected={selectedIssueId === issue.id}
                onSelect={() => onSelectIssue(issue.id)}
                large
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MaintenanceChip({
  item,
  selected,
  onSelect,
  large,
}: {
  item: MaintenanceItem;
  selected: boolean;
  onSelect: () => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/80 text-left shadow-sm active:bg-indigo-100",
        large ? "px-3 py-3" : "px-1.5 py-1",
        selected && "ring-2 ring-indigo-600",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: MAINTENANCE_COLOR }}
    >
      <Wrench
        className={cn(
          "shrink-0 text-indigo-600",
          large ? "mt-0.5 h-4 w-4" : "h-3 w-3",
        )}
      />
      <span
        className={cn(
          "min-w-0 font-medium text-indigo-950",
          large ? "text-sm leading-snug" : "line-clamp-2 text-[10px] leading-tight",
        )}
      >
        {large ? item.title : shortMaintenanceTitle(item.title)}
      </span>
    </button>
  );
}

function IssueChip({
  issue,
  selected,
  onSelect,
  large,
}: {
  issue: Issue;
  selected: boolean;
  onSelect: () => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white text-left shadow-sm active:bg-zinc-50",
        large ? "px-3 py-3" : "px-1.5 py-1",
        selected && "ring-2 ring-[#1a73e8]",
      )}
      style={{
        borderLeftWidth: 4,
        borderLeftColor: getDepartmentColor(issue.department),
      }}
    >
      <span
        className={cn(
          "font-medium text-zinc-900",
          large ? "text-sm leading-snug" : "line-clamp-2 text-xs",
        )}
      >
        {issueTitle(issue)}
      </span>
      {large ? (
        <span className="text-xs text-zinc-500">
          {getDepartmentLabel(issue.department)} · {issue.submitted_by}
        </span>
      ) : null}
    </button>
  );
}

function Legend() {
  return (
    <div className="hidden border-t border-zinc-200 px-4 py-2 md:block">
      <p className="text-xs text-zinc-500">
        <span
          className="mr-1 inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: MAINTENANCE_COLOR }}
        />
        Indigo = recurring maintenance · Colored strip = staff issue by department
      </p>
    </div>
  );
}
