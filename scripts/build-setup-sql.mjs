#!/usr/bin/env node
// Builds supabase/SETUP_FULL.sql (one file to paste into a new Supabase project) from the migrations.
// Run after changing any migration:  node scripts/build-setup-sql.mjs
import fs from "node:fs";
const dir = new URL("../supabase/", import.meta.url);
const mig = fs.readdirSync(new URL("migrations/", dir)).filter((f) => f.endsWith(".sql")).sort();
const head = fs.readFileSync(new URL("setup/head.sql", dir), "utf8");
const tail = fs.readFileSync(new URL("setup/tail.sql", dir), "utf8");
const body = mig.map((f) => `\n-- ${"=".repeat(69)}\n-- ${f}\n-- ${"=".repeat(69)}\n` + fs.readFileSync(new URL(`migrations/${f}`, dir), "utf8")).join("\n");
fs.writeFileSync(new URL("SETUP_FULL.sql", dir), head + body + "\n" + tail);
console.log(`supabase/SETUP_FULL.sql written from ${mig.join(", ")}`);
