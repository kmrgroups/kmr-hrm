import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/auth";
import { licenceFor } from "@/lib/licence";
import { signOut } from "@/app/login/actions";

export const metadata = { title: "Access paused" };

// Shown when the company's licence in the KMR Console is not active (suspended, expired, or none).
export default async function Suspended() {
  const s = await getSession();
  if (!s) redirect("/login");
  const l = await licenceFor(s.tenant.id);
  if (l.ok) redirect(homeFor(s.user));
  return (
    <div className="authwrap">
      <div className="authcard" style={{ textAlign: "center" }}>
        <h1>Access paused</h1>
        <p className="sub">{l.message}</p>
        <p>Your company&apos;s data is safe and will be available again as soon as the licence is renewed.</p>
        <p className="muted" style={{ fontSize: 14 }}>Please contact KMR Group of Companies — <a href="https://www.kmr-groups.com/contact" target="_blank" rel="noopener">www.kmr-groups.com/contact</a>.</p>
        <form action={signOut}><button className="btn secondary block">Sign out</button></form>
      </div>
    </div>
  );
}
