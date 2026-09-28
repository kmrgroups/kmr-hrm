import { PortalBack } from "./PortalBack";

// The standard KMR footer on every screen: "← <company> · KMR Apps" on the left, "Powered By : KMR Group of Companies"
// (linked to www.kmr-groups.com) in the centre. Another deployment can change it with POWERED_BY_TEXT / POWERED_BY_URL.
export function PoweredBy() {
  const name = process.env.POWERED_BY_TEXT || "KMR Group of Companies";
  const url = process.env.POWERED_BY_URL || "https://www.kmr-groups.com";
  if (name.toLowerCase() === "off") return null;
  return (
    <footer className="powered-by">
      <span className="kmr-back-slot"><PortalBack /></span>
      <span>Powered By : <a href={url} target="_blank" rel="noopener">{name}</a></span>
      <span className="kmr-back-slot" aria-hidden="true" />
    </footer>
  );
}
