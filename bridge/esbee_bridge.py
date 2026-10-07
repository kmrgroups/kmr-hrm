#!/usr/bin/env python3
"""
KMR HRM — biometric bridge.

Reads punches (and the user list) from eSSL / ZKTeco machines over the office network (TCP port 4370)
and sends them to the HRM. It only READS: it never changes the machine's settings, never clears its
logs, and does not touch the machine's cloud (ADMS) server setting, so the existing attendance
software keeps working exactly as before.

    python esbee_bridge.py test     check the connection to every machine in bridge.ini
    python esbee_bridge.py users    write users_<machine>.csv  (Device ID + name) — open it in Excel
    python esbee_bridge.py once     send new punches now, then stop
    python esbee_bridge.py run      keep sending new punches every few minutes (leave this window open)
"""
import configparser, csv, datetime as dt, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, "bridge.ini")
STATE = os.path.join(HERE, "bridge_state.json")
LOG = os.path.join(HERE, "bridge.log")
BATCH = 1000


def log(msg):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    print(line, flush=True)
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > 2_000_000:
            os.replace(LOG, LOG + ".old")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_config():
    if not os.path.exists(INI):
        sys.exit("bridge.ini not found. Copy bridge.ini.example to bridge.ini and fill it in.")
    cp = configparser.ConfigParser()
    cp.read(INI, encoding="utf-8")
    hrm = cp["hrm"] if cp.has_section("hrm") else {}
    cfg = {
        "url": hrm.get("url", "https://www.kmr-groups.com/it/hrm/api/attendance/punches").strip(),
        "interval": max(1, int(hrm.get("interval_minutes", "5"))),
        "first_days": max(1, int(hrm.get("first_run_days", "35"))),
        "machines": [],
    }
    for sec in cp.sections():
        if not sec.lower().startswith("machine:"):
            continue
        m = cp[sec]
        cfg["machines"].append({
            "name": sec.split(":", 1)[1].strip(), "ip": m.get("ip", "").strip(), "port": int(m.get("port", "4370")),
            "password": int(m.get("password", "0") or 0), "key": m.get("api_key", "").strip(),
        })
    if not cfg["machines"]:
        sys.exit("No [machine:...] section in bridge.ini.")
    return cfg


def connect(m):
    try:
        from zk import ZK
    except ImportError:
        sys.exit("The 'pyzk' package is missing. Run install.bat first (or: pip install pyzk).")
    return ZK(m["ip"], port=m["port"], timeout=20, password=m["password"], force_udp=False, ommit_ping=True).connect()


def read_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def write_state(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, STATE)


def post(url, key, punches):
    body = json.dumps({"punches": punches}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {key}", "User-Agent": "kmr-hrm-bridge/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode() or "{}")


def cmd_test(cfg):
    for m in cfg["machines"]:
        try:
            c = connect(m)
            try:
                dev = c.get_time()
                sn = c.get_serialnumber()
                users = len(c.get_users())
                recs = len(c.get_attendance())
            finally:
                c.disconnect()
            drift = abs((dt.datetime.now() - dev).total_seconds()) / 60
            log(f"[{m['name']}] OK  serial {sn}  machine time {dev:%Y-%m-%d %H:%M}  users {users}  punches stored {recs}")
            if drift > 5:
                log(f"[{m['name']}] WARNING: the machine clock differs from this PC by about {drift:.0f} minutes. Correct the machine time (Menu > System > Date/Time) — attendance uses the machine's time.")
        except Exception as e:  # noqa: BLE001
            log(f"[{m['name']}] FAILED to connect to {m['ip']}:{m['port']}  ({e})")


def cmd_users(cfg):
    for m in cfg["machines"]:
        try:
            c = connect(m)
            try:
                users = c.get_users()
            finally:
                c.disconnect()
        except Exception as e:  # noqa: BLE001
            log(f"[{m['name']}] FAILED  ({e})")
            continue
        path = os.path.join(HERE, f"users_{m['name'].replace(' ', '_')}.csv")
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["Device ID", "Name", "Card no."])
            for u in sorted(users, key=lambda u: (len(str(u.user_id)), str(u.user_id))):
                w.writerow([u.user_id, u.name, getattr(u, "card", "") or ""])
        log(f"[{m['name']}] {len(users)} users written to {path}")


def sync_machine(cfg, m, st):
    if not m["key"]:
        log(f"[{m['name']}] no api_key in bridge.ini — skipped")
        return
    since = st.get(m["name"])
    since = dt.datetime.fromisoformat(since) if since else dt.datetime.now() - dt.timedelta(days=cfg["first_days"])
    try:
        c = connect(m)
        try:
            recs = c.get_attendance()
        finally:
            c.disconnect()
    except Exception as e:  # noqa: BLE001
        log(f"[{m['name']}] cannot read the machine now ({e}); will try again")
        return
    new = sorted((r for r in recs if r.timestamp > since), key=lambda r: r.timestamp)
    if not new:
        log(f"[{m['name']}] no new punches")
        return
    sent = 0
    for i in range(0, len(new), BATCH):
        part = new[i:i + BATCH]
        payload = [{"user_id": str(r.user_id), "time": r.timestamp.strftime("%Y-%m-%d %H:%M:%S")} for r in part]
        try:
            res = post(cfg["url"], m["key"], payload)
        except urllib.error.HTTPError as e:
            log(f"[{m['name']}] the HRM refused the punches: HTTP {e.code} {e.read().decode(errors='replace')[:200]}")
            return
        except Exception as e:  # noqa: BLE001
            log(f"[{m['name']}] cannot reach the HRM ({e}); will try again")
            return
        sent += len(part)
        st[m["name"]] = part[-1].timestamp.isoformat()
        write_state(st)
        log(f"[{m['name']}] sent {len(part)} punches (new {res.get('stored', '?')}, already there {res.get('duplicates', '?')}, unknown IDs {res.get('unmatched', '?')})")
    log(f"[{m['name']}] done: {sent} punches up to {st[m['name']]}")


def cmd_once(cfg):
    st = read_state()
    for m in cfg["machines"]:
        sync_machine(cfg, m, st)


def cmd_run(cfg):
    log(f"Bridge running: {len(cfg['machines'])} machine(s), every {cfg['interval']} minute(s). Leave this window open.")
    while True:
        try:
            cmd_once(cfg)
        except Exception as e:  # noqa: BLE001
            log(f"unexpected error: {e}")
        time.sleep(cfg["interval"] * 60)


if __name__ == "__main__":
    cmds = {"test": cmd_test, "users": cmd_users, "once": cmd_once, "run": cmd_run}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    cmds[sys.argv[1]](load_config())
