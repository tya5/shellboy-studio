import qrcode from "qrcode-generator";

/** QR modules need fixed black on white for scanner contrast, independently of the theme. */
export function PairingQr({ value, label }: { value: string; label: string }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const path = Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => qr.isDark(row, col) ? `M${col} ${row}h1v1h-1z` : "").join("")).join("");
  return <svg role="img" aria-label={label} viewBox={`-4 -4 ${count + 8} ${count + 8}`} width="240" height="240"><path fill="white" d={`M-4 -4h${count + 8}v${count + 8}h-${count + 8}z`} /><path fill="black" d={path} /></svg>;
}
