// End-to-end walkthrough against a running app (http://localhost:3000) + local Supabase stack.
// Drives the real UI as HR (desktop) and as a new joiner (phone), and checks every hand-off.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots";
const STACK = "/tmp/claude-0/stack";
mkdirSync(SHOTS, { recursive: true });
const adminPw = readFileSync(`${STACK}/deno-admin.txt`, "utf8").match(/Password:\s+(\S+)/)[1];
const acmePw = readFileSync(`${STACK}/acme-admin.txt`, "utf8").match(/Password:\s+(\S+)/)[1];
const sql = (q) => execSync(`psql -h /var/tmp/pg -p 54322 -U postgres -d hrm_e2e -At -c "${q.replace(/"/g, '\\"')}"`).toString().trim();

let step = 0;
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}
const shot = async (page, name) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

// ------------------------------------------------------------------ HR admin first login
const hrCtx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const hr = await hrCtx.newPage();
hr.on("pageerror", (e) => console.log("[hr page error]", hr.url(), e.message.slice(0, 80)));
await hr.goto(`${BASE}/app`);
check("unauthenticated /app redirects to login", hr.url().includes("/login"));
await shot(hr, "login");
await hr.fill('input[name="email"]', "admin@deno.test");
await hr.fill('input[name="password"]', "wrong-password");
await hr.click('button:has-text("Sign in")');
await hr.waitForSelector(".alert.error");
check("wrong password is rejected", (await hr.textContent(".alert.error")).includes("Incorrect"));
await hr.fill('input[name="password"]', adminPw);
await hr.click('button:has-text("Sign in")');
await hr.waitForURL(/\/account/, { waitUntil: "commit" });
check("first login forces password change", hr.url().includes("first=1"));
await hr.fill('input[name="password"]', "DenoAdmin2026");
await hr.fill('input[name="confirm"]', "DenoAdmin2026");
await hr.click('button:has-text("Update password")');
await hr.waitForSelector(".alert.ok");
check("admin sets own password", true);

// branding
await hr.goto(`${BASE}/app/settings`);
await hr.fill('textarea[name="address"]', "Plot 42, KIADB Industrial Area, Bommasandra, Bengaluru 560099");
await hr.fill('input[name="phone"]', "080 4000 1234");
await hr.setInputFiles('input[name="logo"]', `${STACK}/logo.png`);
await hr.fill('input[name="id_card_signatory"]', "Head - Human Resources");
await hr.click('button:has-text("Save settings")');
await hr.waitForSelector(".alert.ok, .alert.error");
check("company branding + logo saved", !!(await hr.$(".alert.ok")), await hr.textContent(".alert"));
await hr.reload();
await shot(hr, "settings-company");

// ------------------------------------------------------------------ add new joiner
await hr.goto(`${BASE}/app/employees/new`);
await hr.fill('input[name="first_name"]', "Priya");
await hr.fill('input[name="last_name"]', "Ramanathan");
await hr.fill('input[name="email"]', "priya@deno.test");
await hr.fill('input[name="mobile"]', "98450 12345");
await hr.selectOption('select[name="designation_id"]', { label: "Engineer (S2)" });
await hr.selectOption('select[name="department_id"]', { label: "Quality" });
await hr.selectOption('select[name="plant_id"]', { label: "Bommasandra Plant 1 (PL1)" });
await hr.fill('input[name="date_of_joining"]', "2026-10-01");
await shot(hr, "new-joiner-form");
await hr.click('button:has-text("Add and send onboarding link")');
await hr.waitForSelector(".alert.ok, .alert.error", { timeout: 20000 });
const createMsg = await hr.textContent(".alert");
check("new joiner created and link generated", createMsg.includes("Onboarding link sent"), createMsg);
const link = await hr.inputValue(".copybox input");
check("onboarding link is shown to HR", /\/onboard\/[A-Za-z0-9_-]{40,}/.test(link), link.slice(0, 60));
check("notification attempts logged (email + WhatsApp, not configured locally)",
  sql("select count(*) from notifications where event='onboarding_invite'") === "2");
await shot(hr, "new-joiner-created");

// ------------------------------------------------------------------ new joiner on a phone
const phoneCtx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["camera"] });
const ph = await phoneCtx.newPage();
ph.on("pageerror", (e) => console.log("[phone page error]", e.message));
await ph.goto(link);
await ph.waitForSelector("text=Welcome, Priya");
await shot(ph, "onboard-personal-empty");

// personal — first try with a missing blood group and a bad mobile to see validation
await ph.fill('[name="date_of_birth"]', "1996-04-18");
await ph.selectOption('[name="gender"]', "Female");
await ph.fill('[name="mobile"]', "12345");
await ph.fill('[name="permanent_address"]', "12, 3rd Cross, Shanthipura, Electronic City, Bengaluru 560100");
await ph.click("text=Same as permanent address");
await ph.fill('[name="emergency_contacts.0.name"]', "R. Ramanathan");
await ph.fill('[name="emergency_contacts.0.relation"]', "Father");
await ph.fill('[name="emergency_contacts.0.phone"]', "9880012345");
await ph.click('button:has-text("Save & continue")');
await ph.waitForSelector(".fielderror");
const errs = await ph.$$eval(".fielderror", (els) => els.map((e) => e.textContent));
check("form validation catches bad mobile and missing blood group", errs.some((e) => /mobile/i.test(e)) && errs.some((e) => /blood/i.test(e)), errs.join(" | "));
await shot(ph, "onboard-validation");
await ph.fill('[name="mobile"]', "9845012345");
await ph.selectOption('[name="blood_group"]', "B+");
await ph.click('button:has-text("Save & continue")');
await ph.waitForSelector("h2:has-text('2. Family')");
check("personal section saved", true);

// family with nominee
await ph.click(".full:has(h3:has-text('Nominees')) button:has-text('+ Add')");
await ph.fill('[name="nominees.0.name"]', "R. Ramanathan");
await ph.fill('[name="nominees.0.relation"]', "Father");
await ph.click('button:has-text("Save & continue")');
await ph.waitForSelector("h2:has-text('3. Education')");
await ph.fill('[name="education.0.qualification"]', "B.E. Mechanical");
await ph.fill('[name="education.0.institute"]', "Pondicherry Engineering College");
await ph.fill('[name="education.0.year"]', "2017");
await ph.fill('[name="education.0.score"]', "8.2 CGPA");
await ph.fill('[name="certifications"]', "IATF 16949 Internal Auditor");
await ph.click('button:has-text("Save & continue")');
await ph.waitForSelector("h2:has-text('4. Experience')");
await ph.click('button:has-text("Save & continue")');
await ph.waitForSelector("h2:has-text('5. Bank')");

// statutory — wrong account confirmation first
await ph.fill('[name="pan"]', "ABCPR1234K");
await ph.fill('[name="aadhaar"]', "2345 6789 0124");
await ph.fill('[name="ifsc"]', "SBIN0001234");
await ph.fill('[name="bank_name"]', "State Bank of India");
await ph.fill('[name="account_holder"]', "Priya Ramanathan");
await ph.fill('[name="account_number"]', "123456789012");
await ph.fill('[name="account_number_confirm"]', "123456789000");
await ph.click('button:has-text("Save & continue")');
await ph.waitForSelector(".fielderror");
check("mismatched account numbers are caught", (await ph.textContent(".fielderror")).includes("do not match"));
await ph.fill('[name="account_number_confirm"]', "123456789012");
await shot(ph, "onboard-bank");
await ph.click('button:has-text("Save & continue")');
await ph.waitForSelector("h2:has-text('6. Documents')");
check("only last 4 of Aadhaar stored", sql("select aadhaar_last4 from employee_private") === "0124");

// documents
for (const label of ["Aadhaar card", "PAN card", "Cancelled cheque / passbook", "Qualification certificates"]) {
  const row = ph.locator(".docrow", { hasText: label });
  await row.locator('input[type="file"]').setInputFiles(`${STACK}/doc.jpg`);
  await row.locator(".chip").first().waitFor({ timeout: 15000 });
}
await shot(ph, "onboard-documents");
check("4 documents uploaded to private storage", sql("select count(*) from employee_documents") === "4");
await ph.click('button:has-text("Continue")');

// selfie with the (fake) front camera
await ph.waitForSelector("h2:has-text('7. Selfie')");
await ph.click('button:has-text("Open camera")');
await ph.waitForSelector("video");
await ph.waitForTimeout(1200);
await ph.click('button:has-text("Capture")');
await ph.waitForSelector('.camera img', { timeout: 15000 });
check("selfie captured from camera and uploaded", sql("select photo_path is not null from employees where first_name='Priya'") === "t");
await ph.check('input[type="checkbox"]');
await shot(ph, "onboard-selfie");
await ph.click('button:has-text("Submit to HR")');
await ph.waitForSelector("text=Thank you, Priya");
await shot(ph, "onboard-submitted");
check("employee submitted onboarding", sql("select status from employees where first_name='Priya'") === "submitted");
check("HR alerted of submission", sql("select count(*) from notifications where event='onboarding_submitted'") >= "1");
await ph.goto(link);
check("used link shows 'already submitted'", (await ph.textContent("h1")).includes("submitted"));

// ------------------------------------------------------------------ HR sends back one section
const empId = sql("select id from employees where first_name='Priya'");
await hr.goto(`${BASE}/app/employees/${empId}`);
await shot(hr, "hr-review");
await hr.locator("form:has(button:has-text('Send back'))").locator('input[value="documents"]').check();
await hr.fill('textarea[name="comment"]', "PAN card image is not clear, please upload a sharper photo.");
await hr.click('button:has-text("Send back for correction")');
await hr.waitForSelector(".alert.ok, .alert.error", { timeout: 20000 });
const sbLink = await hr.inputValue(".copybox input");
check("send-back creates a new link", sbLink !== link && sbLink.includes("/onboard/"));

await ph.goto(sbLink);
await ph.waitForSelector("text=HR has asked you to update");
await shot(ph, "onboard-sent-back");
check("sent-back link opens on the flagged section", (await ph.textContent("h2")).includes("Documents"));
// locked section is read-only
await ph.click(".stepper button:nth-child(1)");
check("unflagged sections are locked", !!(await ph.$("text=No changes were requested")));
await ph.click(".stepper button:nth-child(6)");
const panRow = ph.locator(".docrow", { hasText: "PAN card" });
await panRow.locator(".chip button").click();
await ph.waitForTimeout(500);
await panRow.locator('input[type="file"]').setInputFiles(`${STACK}/doc.jpg`);
await panRow.locator(".chip").first().waitFor();
await ph.click('button:has-text("Continue")');
await ph.check('input[type="checkbox"]');
await ph.click('button:has-text("Submit to HR")');
await ph.waitForSelector("text=Thank you, Priya");
check("corrected onboarding re-submitted", sql("select status from employees where id='" + empId + "'") === "submitted");

// ------------------------------------------------------------------ HR approves
await hr.goto(`${BASE}/app/employees/${empId}`);
hr.once("dialog", (d) => d.accept());
await hr.click('button:has-text("Approve & create employee ID")');
await hr.waitForSelector(".alert.ok, .alert.error", { timeout: 30000 });
const approveMsg = await hr.textContent(".alert");
check("approval creates employee code", approveMsg.includes("DEN-PL1-0001"), approveMsg);
const tempPw = approveMsg.match(/temporary password with the employee in person: (\S+)/)?.[1];
check("HR sees temp password when messages cannot be delivered", !!tempPw);
check("password never stored in message log", sql("select count(*) from notifications where body like '%" + tempPw + "%'") === "0");
await hr.reload();
await shot(hr, "hr-employee-active");

// ID card PDF
const pdf = await hr.request.get(`${BASE}/api/id-cards?ids=${empId}`);
check("ID card PDF downloads", pdf.status() === 200 && pdf.headers()["content-type"] === "application/pdf");
writeFileSync(`${SHOTS}/idcard.pdf`, await pdf.body());

// dashboard + lists
for (const [path, name] of [["/app", "dashboard"], ["/app/employees", "employees"], ["/app/onboarding", "onboarding-board"], ["/app/id-cards", "id-cards"], ["/app/notifications", "notifications"], ["/app/settings/users", "users"], ["/app/settings/masters", "masters"], ["/app/settings/templates", "templates"], ["/app/audit", "audit"]]) {
  const r = await hr.goto(`${BASE}${path}`);
  check(`HR page ${path} loads`, r.status() === 200);
  await shot(hr, name);
}

// ------------------------------------------------------------------ QR verification (public)
const token = sql(`select verify_token from employees where id='${empId}'`);
const anonCtx = await browser.newContext({ ...devices["Pixel 7"] });
const guard = await anonCtx.newPage();
await guard.goto(`${BASE}/v/${token}`);
check("QR verify page shows valid card", (await guard.textContent(".status")).includes("Valid employee ID"));
const verifyText = await guard.textContent("body");
check("QR page hides bank / salary data", !verifyText.includes("123456789012") && !verifyText.includes("ABCPR"));
await shot(guard, "qr-verify");

// ------------------------------------------------------------------ employee first login + Face ID (virtual authenticator)
const empCtx = await browser.newContext({ ...devices["iPhone 13"] });
const emp = await empCtx.newPage();
const cdp = await empCtx.newCDPSession(emp);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
await emp.goto(`${BASE}/login`);
await emp.fill('input[name="email"]', "priya@deno.test");
await emp.fill('input[name="password"]', tempPw);
await emp.click('button:has-text("Sign in")');
await emp.waitForURL(/\/account/, { waitUntil: "commit" });
await emp.fill('input[name="password"]', "Priya2026x");
await emp.fill('input[name="confirm"]', "Priya2026x");
await emp.click('button:has-text("Update password")');
await emp.waitForSelector(".alert.ok");
await emp.click('button:has-text("Turn on for this device")');
await emp.waitForSelector("text=Next time, choose", { timeout: 15000 }).catch(() => {});
check("employee registers Face ID / fingerprint (passkey)", sql("select count(*) from passkeys") === "1");
await shot(emp, "employee-account-passkey");
await emp.goto(`${BASE}/me`);
check("employee portal loads", (await emp.textContent("h1")).includes("Priya"));
await shot(emp, "employee-portal");
const own = await emp.request.get(`${BASE}/api/id-cards?me=1`);
check("employee downloads own ID card", own.status() === 200);
const other = await emp.request.get(`${BASE}/api/id-cards?ids=${empId}`);
check("employee cannot use HR card download", other.status() === 403);
const hrPage = await emp.goto(`${BASE}/app/employees`);
check("employee is kept out of HR screens", emp.url().endsWith("/me"));

// sign out and back in with the passkey only
await emp.click('.sidebar button:has-text("Sign out")', { force: true }).catch(async () => {
  await emp.goto(`${BASE}/login`);
});
await empCtx.clearCookies();
await emp.goto(`${BASE}/login`);
await emp.click('.segmented button:has-text("Face ID")');
await emp.click('button:has-text("Sign in with Face ID")');
await emp.waitForURL(/\/me/, { timeout: 15000, waitUntil: "commit" }).catch(() => {});
check("employee signs in with Face ID / fingerprint", emp.url().endsWith("/me"), emp.url());

// ------------------------------------------------------------------ email OTP login
const otpCtx = await browser.newContext();
const otp = await otpCtx.newPage();
await otp.goto(`${BASE}/login`);
await otp.click('.segmented button:has-text("Email code")');
await otp.fill('input[name="email"]', "admin@deno.test");
await otp.click('button:has-text("Send code")');
await otp.waitForSelector('input[name="code"]');
await otp.waitForTimeout(1500);
const mail = readFileSync(`${STACK}/logs/smtp.log`, "utf8");
const code = [...mail.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]).pop();
check("OTP email delivered (local SMTP)", !!code, code);
if (code) {
  await otp.fill('input[name="code"]', code);
  await otp.click('button:has-text("Verify and sign in")');
  await otp.waitForURL(/\/app/, { timeout: 15000, waitUntil: "commit" }).catch(() => {});
  check("admin signs in with email OTP", otp.url().includes("/app"), otp.url());
}

// ------------------------------------------------------------------ company isolation
const acmeCtx = await browser.newContext();
const acme = await acmeCtx.newPage();
await acme.goto(`${BASE}/login`);
await acme.fill('input[name="email"]', "admin@acme.test");
await acme.fill('input[name="password"]', acmePw);
await acme.click('button:has-text("Sign in")');
await acme.waitForSelector(".alert.error");
check("another company's admin cannot sign in on this company's portal", (await acme.textContent(".alert.error")).includes("not registered with DENO"));

// ------------------------------------------------------------------ deactivate
await hr.goto(`${BASE}/app/employees/${empId}`);
hr.once("dialog", (d) => d.accept());
await hr.click('button:has-text("Deactivate employee")');
await hr.waitForSelector(".alert.ok");
await guard.reload();
check("deactivated employee's QR shows inactive", (await guard.textContent(".status")).includes("Not an active employee"));
const empLogin = await (await browser.newContext()).newPage();
await empLogin.goto(`${BASE}/login`);
await empLogin.fill('input[name="email"]', "priya@deno.test");
await empLogin.fill('input[name="password"]', "Priya2026x");
await empLogin.click('button:has-text("Sign in")');
await empLogin.waitForSelector(".alert.error");
check("deactivated employee cannot sign in", true);

// cron
const cron = await hr.request.get(`${BASE}/api/cron/reminders`, { headers: { Authorization: "Bearer cron-test" } });
check("daily reminder job runs", cron.status() === 200, await cron.text());
const cronNo = await hr.request.get(`${BASE}/api/cron/reminders`);
check("reminder job rejects calls without the secret", cronNo.status() === 401);

// audit
check("audit trail recorded business actions", Number(sql("select count(*) from audit_log where action like 'onboarding.%'")) >= 4);

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
