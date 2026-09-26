import { useMemo } from "react";
import { encode } from "uqr";

export interface QrCodeProps {
  readonly value: string;
  /** What the code holds, for assistive tech (the value itself is shown as text beside it). */
  readonly label: string;
}

/**
 * A QR code of `value`, drawn as one SVG path. It keeps the light theme's colours in the dark
 * theme too (`data-theme="light"`), since authenticator apps read dark modules on light.
 */
export function QrCode({ value, label }: QrCodeProps) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${String(x)} ${String(y)}h1v1h-1z`;
      });
    });
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <div data-theme="light" className="inline-flex bg-surface p-2 text-text">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        shapeRendering="crispEdges"
        className="size-48"
      >
        <path d={path} fill="currentColor" />
      </svg>
    </div>
  );
}
