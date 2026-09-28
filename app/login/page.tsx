import { redirect } from "next/navigation";
import { getTenant, logoUrl, tenantBySlug } from "@/lib/tenant";
import { getSession, homeFor } from "@/lib/auth";
import { IST_OFFSET_MIN } from "@/lib/attendance/time";
import { FusionScene } from "@/components/fusion/FusionScene";
import "@/components/fusion/fusion.css";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

function greeting() {
  const h = new Date(Date.now() + IST_OFFSET_MIN * 6e4).getUTCHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; co?: string }> }) {
  const { co, next } = await searchParams;
  // Sign-in links from the KMR Console carry ?co=<company> so the page shows that company's branding
  const tenant = (co && /^[a-z0-9-]{2,40}$/.test(co) ? await tenantBySlug(co) : null) ?? await getTenant();
  const session = await getSession();
  if (session) redirect(homeFor(session.user));
  const brand = tenant ?? { name: "HRM Suite", legal_name: "HRM Suite", logo_path: null };
  const logo = logoUrl(brand);
  const initials = brand.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

  return (
    <div className="fz-split">
      <FusionScene variant="hrm" chip="HRM Suite" headline="From punch to" em="payroll-ready." sub="Onboarding, ID cards, attendance and leave — for every plant and shift."
        tags={["Biometric · Face ID", "Shifts & leave", "Digital ID cards"]} />
      <section className="fz-panel">
        <div className="fz-form">
          <div className="fz-co">
            {logo ? <img src={logo} alt={brand.name} /> : <span className="fb">{initials}</span>}
            <div>{brand.legal_name || brand.name}<small>HR &amp; Employee Portal</small></div>
          </div>
          <h2>{greeting()}</h2>
          <p className="fz-sub">Sign in to continue to {brand.name}.</p>
          <LoginForm next={next ?? ""} co={tenant && co === tenant.slug ? co : ""} />
          <p className="fz-note">Secure sign-in · Need help? Contact your HR team</p>
        </div>
      </section>
    </div>
  );
}
