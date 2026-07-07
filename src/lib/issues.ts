import {
  DEPARTMENTS,
  normalizeDepartmentId,
  type DepartmentId,
} from "@/lib/constants";
import type { Issue } from "@/lib/types/issue";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Open issues older than `days` (default 7). */
export function isIssueStale(issue: Issue, days = 7): boolean {
  if (issue.status !== "open") return false;
  const age = Date.now() - new Date(issue.created_at).getTime();
  return age > days * MS_PER_DAY;
}

export function countStaleIssues(issues: Issue[], days = 7): number {
  return issues.filter((i) => isIssueStale(i, days)).length;
}

export type IssuesByDepartment = {
  department: DepartmentId;
  label: string;
  issues: Issue[];
  /** Oldest issue in the group (by created_at). */
  oldestCreatedAt: string;
  /** Newest issue in the group — used to bubble departments with fresh work to the top. */
  newestCreatedAt: string;
};

export type GroupIssuesOptions = {
  /** When true, departments with the most recently created issue appear first. */
  bubbleNewestDepartments?: boolean;
  /** When true, list every venue location in VENUE_WALK_ORDER (including empty sections). */
  includeEmptyDepartments?: boolean;
};

const WALK_ORDER_INDEX = new Map<DepartmentId, number>(
  DEPARTMENTS.map((d, i) => [d.id, i]),
);

function sortGroupsByWalkOrder(groups: IssuesByDepartment[]): IssuesByDepartment[] {
  return [...groups].sort(
    (a, b) =>
      (WALK_ORDER_INDEX.get(a.department) ?? 999) -
      (WALK_ORDER_INDEX.get(b.department) ?? 999),
  );
}

/** Groups issues by department; only departments with issues unless includeEmptyDepartments. */
export function groupIssuesByDepartment(
  issues: Issue[],
  options: GroupIssuesOptions = {},
): IssuesByDepartment[] {
  const {
    bubbleNewestDepartments = true,
    includeEmptyDepartments = false,
  } = options;
  const map = new Map<DepartmentId, Issue[]>();
  for (const issue of issues) {
    const dept = normalizeDepartmentId(issue.department);
    const list = map.get(dept) ?? [];
    list.push({ ...issue, department: dept });
    map.set(dept, list);
  }

  const groups: IssuesByDepartment[] = [];

  for (const d of DEPARTMENTS) {
    const raw = map.get(d.id) ?? [];
    if (!includeEmptyDepartments && !raw.length) continue;

    const sorted = [...raw].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    groups.push({
      department: d.id,
      label: d.label,
      issues: sorted,
      oldestCreatedAt: sorted[0]?.created_at ?? "",
      newestCreatedAt: sorted[sorted.length - 1]?.created_at ?? "",
    });
  }

  if (bubbleNewestDepartments) {
    groups.sort(
      (a, b) =>
        new Date(b.newestCreatedAt).getTime() -
        new Date(a.newestCreatedAt).getTime(),
    );
  } else {
    return sortGroupsByWalkOrder(groups);
  }

  return groups;
}
