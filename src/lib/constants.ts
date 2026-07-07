export const VENUE_NAME = "On Par Entertainment";

/** Fixed venue walk-through order (sheet to shelf). Single source of truth for all location lists. */
export const VENUE_WALK_ORDER = [
  { id: "ada_hallway", label: "ADA hallway" },
  { id: "mini_golf", label: "Mini golf" },
  { id: "main_wall_tapwall", label: "Main wall & Tapwall" },
  { id: "patio_tapwall", label: "Patio & Tapwall" },
  { id: "outdoor_patio", label: "Outdoor Patio" },
  { id: "front_desk_entrance", label: "Front desk & Entrance" },
  { id: "darts", label: "Darts" },
  { id: "bowling", label: "Bowling" },
  { id: "bathrooms", label: "Bathrooms" },
  { id: "offices", label: "Offices" },
  { id: "vip", label: "VIP" },
  { id: "karaoke", label: "Karaoke" },
  { id: "facilities_area", label: "Facilities area" },
  { id: "back_dock", label: "Back dock" },
  { id: "kitchen", label: "Kitchen" },
] as const;

/** Venue locations (submit dropdown + manager grouping). Same order as VENUE_WALK_ORDER. */
export const DEPARTMENTS = VENUE_WALK_ORDER;

export type DepartmentId = (typeof DEPARTMENTS)[number]["id"];

/** Maps retired location ids to the new category (also used before DB migration runs). */
export const LEGACY_DEPARTMENT_IDS: Record<string, DepartmentId> = {
  main_wall: "main_wall_tapwall",
  outdoor: "outdoor_patio",
  front_desk: "front_desk_entrance",
  bathroom: "bathrooms",
  break_room: "offices",
  dock: "back_dock",
  shuffleboard: "vip",
  foosball: "vip",
  cleaning: "facilities_area",
  beverage: "main_wall_tapwall",
};

export function normalizeDepartmentId(id: string): DepartmentId {
  if (DEPARTMENTS.some((d) => d.id === id)) return id as DepartmentId;
  return LEGACY_DEPARTMENT_IDS[id] ?? (id as DepartmentId);
}

export const PRIORITIES = [
  { id: "normal", label: "Normal" },
  { id: "urgent", label: "Urgent" },
] as const;

export type PriorityId = (typeof PRIORITIES)[number]["id"];

export const ISSUE_STATUSES = ["open", "completed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
