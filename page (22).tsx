import { redirect } from "next/navigation";
import { getTenant, logoUrl } from "@/lib/tenant";
import { getSession, homeFor } from "@/lib/auth";
import { IST_OFFSET_MIN } from "@/lib/attendance/time";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

const FEATURES = [
  { title: "Attendance & leave", text: "Your punches, balances and requests in one place", d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2" },
  { title: "Onboarding & ID cards", text: "Joining formalities and your digital ID, on any device", d: "M3 5h18v14H3zM7 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4M5 16c.5-1.5 1.5-2 2-2s1.5.5 2 2M13 10h5M13 14h4" },
  { title: "Secure sign-in", text: "Password, email code, or Face ID / fingerprint", d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10M9 12l2 2 4-4" },
];

function greeting() {
  const h = new Date(Date.now() + IST_OFFSET_MIN * 6e4).getUTCHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const tenant = await getTenant();
  if (!tenant) {
    return (
      <div className="authwrap">
        <div className="authcard">
          <h1>Portal not found</h1>
          <p className="sub">No company is set up for this web address. Please check the link from your HR team.</p>
        </div>
      </div>
    );
  }
  const session = await getSession();
  if (session) redirect(homeFor(session.user));
  const { next } = await searchParams;
  const logo = logoUrl(tenant);
  const initials = tenant.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  return (
    <div className="signin">
      <aside className="signin-brand">
        <div className="signin-brand-inner">
          <div className="signin-logo">{logo ? <img src={logo} alt={tenant.name} /> : <span>{initials}</span>}</div>
          <div className="signin-company">
            <h2>{tenant.legal_name || tenant.name}</h2>
            <p>HR &amp; Employee Portal</p>
          </div>
          <ul className="signin-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={f.d} /></svg></span>
                <span><b>{f.title}</b><br /><small>{f.text}</small></span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="signin-panel">
        <div className="signin-card">
          <div className="signin-mobile-logo">{logo ? <img src={logo} alt={tenant.name} /> : null}</div>
          <p className="signin-hello">{greeting()} 👋</p>
          <h1>Welcome back</h1>
          <p className="signin-sub">Sign in to continue to {tenant.name}</p>
          <LoginForm next={next ?? ""} />
          <p className="signin-secure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" /></svg>
            Secure sign-in · Need help? Contact HR
          </p>
        </div>
      </main>
    </div>
  );
}
