// Footer shown on every screen. Defaults to KMR; each deployment can override it with
// POWERED_BY_TEXT / POWERED_BY_URL (set POWERED_BY_TEXT to "off" to hide it).
export function PoweredBy() {
  const text = process.env.POWERED_BY_TEXT || "Powered by KMR Group of Companies";
  const url = process.env.POWERED_BY_URL || "https://www.kmr-groups.com";
  if (text.toLowerCase() === "off") return null;
  return (
    <footer className="powered-by">
      <a href={url} target="_blank" rel="noopener">{text}</a>
    </footer>
  );
}
