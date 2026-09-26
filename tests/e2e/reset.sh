#!/bin/bash
# Rebuilds the local end-to-end database from scratch and restarts Auth + PostgREST.
set -e
STACK=/tmp/claude-0/stack
APP=/home/claude/hrm-suite
P="psql -h /var/tmp/pg -p 54322 -U postgres -v ON_ERROR_STOP=1 -q"
for c in auth postgrest; do for pid in $(ps -eo pid,comm | awk -v c="$c" '$2==c {print $1}'); do kill $pid; done; done
sleep 1
$P -c "drop database if exists hrm_e2e with (force)" -c "create database hrm_e2e"
$P -d hrm_e2e -f $APP/tests/e2e/setup-db.sql
cd $STACK && set -a && . ./auth.env && set +a && (nohup ./auth > logs/auth.log 2>&1 &)
for i in $(seq 1 20); do sleep 1; curl -s 127.0.0.1:9999/health >/dev/null && break; done
$P -d hrm_e2e -f $APP/supabase/migrations/0001_foundation.sql
(nohup ./postgrest pgrst.conf > logs/pgrst.log 2>&1 &)
rm -rf $STACK/storage; : > logs/smtp.log
sleep 2
cd $APP
node --env-file=.env.local scripts/create-tenant.mjs --slug deno --name DENO --legal "DENO Manufacturing and Solutions India Pvt Ltd" --prefix DEN --admin-email admin@deno.test --admin-name "Rajavelu R" --plant "PL1:Bommasandra Plant 1" > $STACK/deno-admin.txt
node --env-file=.env.local scripts/create-tenant.mjs --slug acme --name ACME --prefix ACM --admin-email admin@acme.test --admin-name "Acme Admin" --domain hr.acme.test > $STACK/acme-admin.txt
echo "reset complete"
