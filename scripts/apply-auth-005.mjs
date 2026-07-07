#!/usr/bin/env node
/** Apply migration 005 data via API (run 005 SQL in Supabase first if table missing). */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const CORE = [
  "marketing",
  "daniel",
  "carlos",
  "derek",
  "events",
  "samantha",
  "facilities",
  "facility",
];

function loadEnv() {
  const raw = readFileSync(resolve(root, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const rows = CORE.map((local_part) => ({ local_part, auto_admin: true }));
const { error: upsertErr } = await supabase
  .from("signup_allowlist")
  .upsert(rows, { onConflict: "local_part" });

if (upsertErr) {
  console.error(
    "Failed — run supabase/migrations/005_auth_auto_admin_allowlist.sql in SQL Editor first.",
  );
  console.error(upsertErr.message);
  process.exit(1);
}

for (const local of CORE) {
  await supabase
    .from("profiles")
    .update({ role: "admin" })
    .eq("username", local);
}

console.log("✓ Core team seeded as auto-admin in signup_allowlist");
console.log("✓ Existing profiles for core team set to admin");
