"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { rowToIssue, sortIssues, type IssueRow } from "@/lib/issues/map";
import type { Issue } from "@/lib/types/issue";

export function useIssues() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyRows = useCallback((rows: IssueRow[]) => {
    setIssues(sortIssues(rows.map((row) => rowToIssue(row))));
  }, []);

  const fetchIssues = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setError(
        "Unable to connect to the server. Check your connection or contact your manager.",
      );
      setLoading(false);
      return;
    }

    setError(null);
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("issues")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    applyRows((data ?? []) as IssueRow[]);
    setLoading(false);
  }, [applyRows]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchIssues();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchIssues]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();

    const channel = supabase
      .channel("issues-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "issues" },
        (payload) => {
          setIssues((prev) => {
            let next = [...prev];
            if (payload.eventType === "INSERT") {
              const row = payload.new as IssueRow;
              if (!next.some((i) => i.id === row.id)) {
                next.push(rowToIssue(row));
              }
            } else if (payload.eventType === "UPDATE") {
              const row = payload.new as IssueRow;
              next = next.map((i) =>
                i.id === row.id ? rowToIssue(row) : i,
              );
            } else if (payload.eventType === "DELETE") {
              const row = payload.old as { id: string };
              next = next.filter((i) => i.id !== row.id);
            }
            return sortIssues(next);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { issues, setIssues, loading, error, refetch: fetchIssues };
}
