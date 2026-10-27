import { Text } from "../ds/index.ts";
import "./PdfLegend.css";

// Swatches mirror the highlight styles in PdfViewer.css.
const ITEMS = [
  { variant: "verified", label: "saved" },
  { variant: "proposed", label: "conflict" },
  { variant: "rejected", label: "deleted" },
  { variant: "hint", label: "where it was last time" },
] as const;

/** Key to the box colors drawn on the PDF. */
export function PdfLegend() {
  return (
    <Text as="div" size="sm" tone="muted">
      <span className="pdf-legend">
        Boxes:
        {ITEMS.map((i) => (
          <span key={i.variant} className="pdf-legend__item">
            <span className={`pdf-legend__swatch pdf-legend__swatch--${i.variant}`} /> {i.label}
          </span>
        ))}
      </span>
    </Text>
  );
}
