#!/usr/bin/env node
/**
 * Prints migration 011 SQL — paste into Supabase → SQL → New query → Run.
 * Moves open + completed issues into the new location categories.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(__dirname, "../supabase/migrations/011_migrate_location_departments.sql"),
  "utf8",
);

console.log(
  "Copy everything below into Supabase SQL Editor and click Run:\n",
);
console.log("---");
console.log(sql);
console.log("---");
console.log(
  "\nThen deploy the latest app to Vercel (git push) so dropdowns use the new location list.",
);
