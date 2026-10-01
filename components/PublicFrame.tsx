import { logoUrl } from "@/lib/tenant";

/** Branded frame for pages people open without signing in (careers, interview and offer links). */
export function PublicFrame({ tenant, children, wide }: { tenant: { name: string; legal_name: string | null; logo_path: string | null } | null; children: React.ReactNode; wide?: boolean }) {
  const logo = tenant ? logoUrl(tenant) : null;
  return (
    <>
      <div className="publichead"><div className="inner">{logo ? <img src={logo} alt="" /> : null}<b>{tenant?.legal_name || tenant?.name || "Careers"}</b></div></div>
      <div className="publicwrap" style={wide ? { maxWidth: 900 } : undefined}>{children}</div>
    </>
  );
}
