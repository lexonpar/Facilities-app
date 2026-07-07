import type { Issue } from "@/lib/types/issue";

const now = new Date();
const hoursAgo = (h: number) =>
  new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

export const MOCK_ISSUES: Issue[] = [
  {
    id: "120",
    department: "bowling",
    comment:
      "Pin reset arm sticking on lane 4 — guests waiting. Needs adjustment or replacement part.",
    submitted_by: "Jordan M.",
    photo_url: undefined,
    priority: "urgent",
    status: "open",
    workflow_status: "in_progress",
    created_at: hoursAgo(2),
  },
  {
    id: "119",
    department: "kitchen",
    comment: "Walk-in cooler temp reading 48°F. Check gasket and thermostat.",
    submitted_by: "Alex T.",
    priority: "urgent",
    status: "open",
    workflow_status: "open",
    created_at: hoursAgo(5),
  },
  {
    id: "118",
    department: "bathrooms",
    comment: "Main restroom — second stall door latch broken.",
    submitted_by: "Sam R.",
    priority: "normal",
    status: "open",
    workflow_status: "on_hold",
    created_at: hoursAgo(8),
  },
  {
    id: "117",
    department: "karaoke",
    comment: "Room 3 mic cutting out. Swap cable or receiver check.",
    submitted_by: "Chris L.",
    priority: "normal",
    status: "open",
    workflow_status: "open",
    created_at: hoursAgo(26),
  },
  {
    id: "116",
    department: "outdoor_patio",
    comment: "Patio heater not igniting on table section B.",
    submitted_by: "Pat K.",
    priority: "normal",
    status: "completed",
    workflow_status: "open",
    created_at: hoursAgo(48),
    completed_at: hoursAgo(4),
    completion_note: "Replaced igniter module.",
  },
  {
    id: "115",
    department: "darts",
    comment: "Board lighting flickering above board 2.",
    submitted_by: "Morgan D.",
    priority: "normal",
    status: "completed",
    workflow_status: "open",
    created_at: hoursAgo(72),
    completed_at: hoursAgo(20),
  },
];
