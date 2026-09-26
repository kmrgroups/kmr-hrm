import QRCode from "qrcode";

export interface CardPreviewProps {
  company: string;
  logoUrl: string | null;
  photoUrl: string | null;
  name: string;
  code: string;
  designation?: string | null;
  department?: string | null;
  bloodGroup?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  verifyUrl: string;
  address?: string | null;
  validUntil?: string | null;
}

/** On-screen version of the printed card (front and back). */
export async function IdCardPreview(p: CardPreviewProps) {
  const qr = await QRCode.toDataURL(p.verifyUrl, { margin: 1, width: 280 });
  return (
    <div className="idcards">
      <div className="idcard">
        <div className={`head${p.logoUrl ? " logo" : ""}`}>{p.logoUrl ? <img src={p.logoUrl} alt={p.company} /> : p.company}</div>
        <div className="photo">{p.photoUrl ? <img src={p.photoUrl} alt="" /> : null}</div>
        <div className="nm">{p.name}</div>
        {p.designation && <div className="ds">{p.designation}</div>}
        {p.department && <div className="ds">{p.department}</div>}
        <div className="code">{p.code}</div>
        <div className="foot">
          <div className="blood"><div><small>BLOOD</small>{p.bloodGroup || "-"}</div></div>
          <div className="emer">IN EMERGENCY CALL<b>{p.emergencyPhone || "-"}</b>{p.emergencyName}</div>
        </div>
      </div>
      <div className="idcard back">
        <img className="qr" src={qr} alt="Verification QR code" />
        <small>Scan to verify this card</small>
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 12, padding: "0 12px" }}>{p.company}</div>
        {p.address && <div className="ds" style={{ padding: "0 14px", fontSize: 11 }}>{p.address}</div>}
        {p.validUntil && <div className="ds" style={{ marginTop: "auto", marginBottom: 18, fontSize: 11 }}>Valid upto <b>{p.validUntil}</b></div>}
      </div>
    </div>
  );
}
