KMR HRM - BIOMETRIC BRIDGE (Esbee)
==================================
What it does
  Reads attendance punches (and the list of users) from the biometric machine over the office network
  and sends them to the HRM. It only READS the machine. It does not change any setting on the machine,
  does not clear its logs, and does not touch the machine's "Cloud Server Setting" - so your existing
  attendance software keeps working exactly as before.

What you need
  1. A Windows PC in the Esbee office that is switched on during working hours and is on the same
     network as the machine (for example the PC at 192.168.2.35).
  2. Python 3 installed on that PC (free, python.org). During install, tick "Add Python to PATH".
  3. The API key the HRM showed when you added the machine
     (HRM > Settings > Attendance setup > Connect a device > API key).

Steps (first time)
  1. Copy this whole folder to the PC, for example to C:\KMR_Bridge
  2. Double-click  install.bat      (installs the machine-reading package, creates bridge.ini)
  3. Open bridge.ini with Notepad. Replace PASTE-THE-KEY-HERE with the API key. Save.
     (The machine's IP 192.168.2.136 and port 4370 are already filled in.)
  4. Double-click  1_test.bat       It should say OK with the serial number PHY7244701197.
                                    If it says FAILED, the PC cannot reach 192.168.2.136:4370.
  5. Double-click  2_users.bat      It writes users_Esbee_Fingerprint.csv: every person's
                                    Device ID and name. Open it in Excel. These are the Device IDs
                                    to enter on each employee in the HRM.
  6. Double-click  3_start_bridge.bat   Leave that window open. Every 5 minutes it sends new punches.
                                    The first time it sends the last 35 days of punches.

To start automatically with Windows: press Win+R, type  shell:startup , and put a shortcut to
3_start_bridge.bat in that folder.

Check it works
  - HRM > Settings > Attendance setup: the machine's "Last seen" shows a recent time.
  - HRM > Attendance: today's punches appear. Punches from IDs not yet set on an employee are kept
    and linked automatically once you set that employee's Device ID.
  - The file bridge.log in this folder says what happened each time.

Good to know
  - Sending the same punch twice is safe; the HRM ignores duplicates.
  - If the internet or the machine is unreachable, it simply tries again at the next round.
  - Attendance uses the machine's own clock. 1_test.bat warns if it differs from the PC by > 5 minutes.
  - A second machine (the face machine): add a block like [machine:Esbee_Face] to bridge.ini with its
    IP, and its own API key (add it in the HRM as another "API key" device).
  - Face machines of some brands do not use this protocol. 1_test.bat will say FAILED; tell us the
    model and we will adapt it.
