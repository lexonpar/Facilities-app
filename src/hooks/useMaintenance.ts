"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  rowToMaintenance,
  sortMaintenance,
  type MaintenanceRow,
} from "@/lib/maintenance/map";
import type { MaintenanceItem } from "@/lib/types/maintenance";

export function useMaintenance() {
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyRows = useCallback((rows: MaintenanceRow[]) => {
    setItems(sortMaintenance(rows.map(rowToMaintenance)));
  }, []);

  const fetchItems = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setError("Unable to load maintenance schedule.");
      setLoading(false);
      return;
    }

    setError(null);
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("maintenance_items")
      .select("*")
      .order("sort_order", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    applyRows((data ?? []) as MaintenanceRow[]);
    setLoading(false);
  }, [applyRows]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchItems();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchItems]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    const channel = supabase
      .channel("maintenance-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "maintenance_items" },
        (payload) => {
          setItems((prev) => {
            let next = [...prev];
            if (payload.eventType === "INSERT") {
              const row = payload.new as MaintenanceRow;
              if (!next.some((i) => i.id === row.id)) {
                next.push(rowToMaintenance(row));
              }
            } else if (payload.eventType === "UPDATE") {
              const row = payload.new as MaintenanceRow;
              next = next.map((i) =>
                i.id === row.id ? rowToMaintenance(row) : i,
              );
            } else if (payload.eventType === "DELETE") {
              const row = payload.old as { id: string };
              next = next.filter((i) => i.id !== row.id);
            }
            return sortMaintenance(next);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { items, loading, error, refetch: fetchItems };
}
