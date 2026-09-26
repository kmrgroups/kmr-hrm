#!/usr/bin/env node
// Creates a company (tenant), its default departments / designations, and its first admin login.
//
// Usage:
//   node --env-file=.env.local scripts/create-tenant.mjs \
//     --slug deno --name "DENO" --legal "DENO Manufacturing and Solutions India Pvt Ltd" \
//     --prefix DEN --admin-email hr@deno.in --admin-name "Rajavelu R" [--domain hr.deno.in] [--plant "PL1:Bommasandra Plant 1"]
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const need = ["slug", "name", "admin-email", "admin-name"];
const missing = need.filter((k) => !args[k]);
if (missing.length) {
  console.error(`Missing: ${missing.map((m) => "--" + m).join(", ")}\nSee the usage notes at the top of this file.`);
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. run with --env-file=.env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const slug = args.slug.toLowerCase();
const { data: tenant, error } = await db.from("tenants").insert({
  slug, name: args.name, legal_name: args.legal ?? null, emp_code_prefix: (args.prefix ?? slug.slice(0, 3)).toUpperCase(),
}).select().single();
if (error) { console.error("Tenant:", error.message); process.exit(1); }
console.log(`✓ Company "${tenant.name}" created (slug ${slug})`);

await db.rpc("seed_tenant_defaults", { p_tenant: tenant.id });
console.log("✓ Default departments and designations added");

if (args.domain) {
  const { error: dErr } = await db.from("tenant_domains").insert({ domain: args.domain.toLowerCase(), tenant_id: tenant.id, is_primary: true, verified: true });
  console.log(dErr ? `! Domain: ${dErr.message}` : `✓ Domain ${args.domain} mapped`);
}
if (args.plant) {
  const [code, ...rest] = args.plant.split(":");
  const { error: pErr } = await db.from("plants").insert({ tenant_id: tenant.id, code: code.toUpperCase(), name: rest.join(":") || code });
  console.log(pErr ? `! Plant: ${pErr.message}` : `✓ Plant ${code} added`);
}

const password = `${randomBytes(4).toString("hex")}-${randomBytes(2).toString("hex")}A1!`;
const email = args["admin-email"].toLowerCase();
const { data: created, error: uErr } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: args["admin-name"] } });
if (uErr) { console.error("Admin user:", uErr.message); process.exit(1); }
const { error: aErr } = await db.from("app_users").insert({
  id: created.user.id, tenant_id: tenant.id, role: "company_admin", full_name: args["admin-name"], email, must_change_password: true,
});
if (aErr) { console.error("Admin profile:", aErr.message); process.exit(1); }

console.log(`\n✓ Admin login created
   Email:     ${email}
   Password:  ${password}   (must be changed at first sign-in)\n`);
