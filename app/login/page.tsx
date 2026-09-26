import { redirect } from "next/navigation";
import { getTenant, logoUrl } from "@/lib/tenant";
import { getSession, homeFor } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

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
  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="logo">{logo ? <img src={logo} alt={tenant.name} /> : null}</div>
        <h1>{tenant.legal_name || tenant.name}</h1>
        <p className="sub">HR &amp; employee portal</p>
        <LoginForm next={next ?? ""} />
      </div>
    </div>
  );
}
