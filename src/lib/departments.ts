import {
  DEPARTMENTS,
  normalizeDepartmentId,
  type DepartmentId,
} from "@/lib/constants";

export function getDepartmentLabel(id: string): string {
  const normalized = normalizeDepartmentId(id);
  return DEPARTMENTS.find((d) => d.id === normalized)?.label ?? id;
}

/** Calendar / list accent colors per location */
export const DEPARTMENT_COLORS: Record<DepartmentId, string> = {
  ada_hallway: "#6366f1",
  mini_golf: "#16a34a",
  main_wall_tapwall: "#4f46e5",
  patio_tapwall: "#2563eb",
  outdoor_patio: "#059669",
  front_desk_entrance: "#0891b2",
  darts: "#dc2626",
  bowling: "#0d9488",
  bathrooms: "#0e7490",
  offices: "#9333ea",
  vip: "#be123c",
  karaoke: "#7c3aed",
  facilities_area: "#64748b",
  back_dock: "#525252",
  kitchen: "#b45309",
};

export function getDepartmentColor(id: string): string {
  const normalized = normalizeDepartmentId(id);
  return DEPARTMENT_COLORS[normalized] ?? "#64748b";
}
