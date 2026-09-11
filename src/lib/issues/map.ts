import { normalizeDepartmentId, type PriorityId } from "@/lib/constants";
import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Issue, WorkflowStatus } from "@/lib/types/issue";

export type IssueRow = {
  id: string;
  department: string;
  comment: string;
  submitted_by: string;
  photo_path: string | null;
  priority: PriorityId;
  status: "open" | "completed";
  workflow_status: WorkflowStatus;
  created_at: string;
  completed_at: string | null;
  completion_note: string | null;
  recalled_at: string | null;
};

export function rowToIssue(
  row: IssueRow,
  photoUrl?: string | null,
): Issue {
  return {
    id: row.id,
    department: normalizeDepartmentId(row.department),
    comment: row.comment,
    submitted_by: row.submitted_by,
    photo_url: photoUrl ?? publicPhotoUrl(row.photo_path),
    priority: row.priority,
    status: row.status,
    workflow_status: row.workflow_status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    recalled_at: row.recalled_at,
    completion_note: row.completion_note,
  };
}

export function publicPhotoUrl(photoPath: string | null | undefined): string | undefined {
  if (!photoPath) return undefined;
  const base = getSupabaseUrl().replace(/\/+$/, "");
  if (!base) return undefined;
  return `${base}/storage/v1/object/public/issue-photos/${photoPath}`;
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "open" ? -1 : 1;
    }
    if (a.status === "open") {
      const aRecall = a.recalled_at ? 1 : 0;
      const bRecall = b.recalled_at ? 1 : 0;
      if (aRecall !== bRecall) return bRecall - aRecall;
      if (a.priority !== b.priority) {
        return a.priority === "urgent" ? -1 : 1;
      }
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    return (
      new Date(b.completed_at ?? b.created_at).getTime() -
      new Date(a.completed_at ?? a.created_at).getTime()
    );
  });
}
