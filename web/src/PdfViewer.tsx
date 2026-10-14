import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { normalizeRect, pdfRectToViewport, viewportToPdfRect, type PdfRect, type ViewportRect, type ViewportTransform } from "@finshark/shared";
import { textInBox, toTextBoxes, type PdfJsTextItemLike, type TextBox } from "./text-in-box.ts";

// Worker and runtime assets are bundled locally; nothing is fetched from a CDN.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfSource = { url: string } | { data: Uint8Array };

export interface PdfSelection {
  /** 1-based page number. */
  pageNo: number;
  /** Unrotated PDF points, origin bottom-left (DESIGN §2.5). */
  rect: PdfRect;
  /** Text under the box. */
  text: string;
}

export interface PdfHighlight {
  pageNo: number;
  rect: PdfRect;
}

export interface PdfViewerProps {
  source: PdfSource;
  highlights?: readonly PdfHighlight[];
  onSelect?: (selection: PdfSelection) => void;
  initialPage?: number;
  initialScale?: number;
}

interface PageView {
  transform: ViewportTransform;
  width: number;
  height: number;
  boxes: TextBox[];
}

const MIN_DRAG_PX = 3;

function isTextItem(i: unknown): boolean {
  return typeof i === "object" && i !== null && "str" in i && "transform" in i;
}

export function PdfViewer({ source, highlights = [], onSelect, initialPage = 1, initialScale = 1.25 }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState(initialPage);
  const [scale, setScale] = useState(initialScale);
  const [turns, setTurns] = useState(0); // user rotation in 90 degree steps
  const [view, setView] = useState<PageView | null>(null);
  const [showText, setShowText] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [selected, setSelected] = useState<{ pageNo: number; rect: PdfRect } | null>(null);

  const sourceKey = "url" in source ? source.url : source.data;

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDoc(null);
    setView(null);
    setSelected(null);
    const task = pdfjs.getDocument({
      ...("url" in source ? { url: source.url } : { data: source.data.slice() }),
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      iccUrl: "/pdfjs/iccs/",
      wasmUrl: "/pdfjs/wasm/",
    });
    task.promise.then(
      (d) => {
        if (cancelled) return;
        setDoc(d);
        setPageNo((p) => Math.min(Math.max(1, p), d.numPages));
      },
      (e: unknown) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // Render the current page.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNo);
      const rotation = (page.rotate + turns * 90) % 360;
      const css = page.getViewport({ scale, rotation });
      const dpr = window.devicePixelRatio || 1;
      const hi = page.getViewport({ scale: scale * dpr, rotation });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.floor(hi.width);
      canvas.height = Math.floor(hi.height);
      canvas.style.width = `${css.width}px`;
      canvas.style.height = `${css.height}px`;
      renderTask = page.render({ canvas, viewport: hi });
      const [content] = await Promise.all([page.getTextContent(), renderTask.promise]);
      if (cancelled) return;
      setView({
        transform: css.transform as ViewportTransform,
        width: css.width,
        height: css.height,
        boxes: toTextBoxes(content.items.filter(isTextItem) as PdfJsTextItemLike[]),
      });
    })().catch((e: unknown) => {
      if (cancelled || (e as { name?: string })?.name === "RenderingCancelledException") return;
      setError(String(e));
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNo, scale, turns]);

  const numPages = doc?.numPages ?? 0;
  const goto = (n: number) => setPageNo(Math.min(Math.max(1, n), Math.max(1, numPages)));

  const pointer = (e: ReactPointerEvent): [number, number] => {
    const r = overlayRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onDown = (e: ReactPointerEvent) => {
    if (!view || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = pointer(e);
    setSelected(null);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const [x, y] = pointer(e);
    setDrag({ ...drag, x1: x, y1: y });
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!drag || !view) return;
    const [x, y] = pointer(e);
    const vr = normalizeRect<ViewportRect>([drag.x0, drag.y0, x, y]);
    setDrag(null);
    if (vr[2] - vr[0] < MIN_DRAG_PX || vr[3] - vr[1] < MIN_DRAG_PX) return;
    const rect = viewportToPdfRect(vr, view.transform);
    setSelected({ pageNo, rect });
    onSelect?.({ pageNo, rect, text: textInBox(view.boxes, rect) });
  };

  const toCss = (rect: PdfRect) => {
    const [l, t, r, b] = pdfRectToViewport(rect, view!.transform);
    return { left: l, top: t, width: r - l, height: b - t };
  };

  const pageHighlights = useMemo(() => highlights.filter((h) => h.pageNo === pageNo), [highlights, pageNo]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button onClick={() => goto(pageNo - 1)} disabled={pageNo <= 1}>
          Prev
        </button>
        <span>
          Page{" "}
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={pageNo}
            onChange={(e) => goto(Number(e.target.value) || 1)}
            aria-label="Page number"
          />{" "}
          of {numPages || "-"}
        </span>
        <button onClick={() => goto(pageNo + 1)} disabled={pageNo >= numPages}>
          Next
        </button>
        <span className="sep" />
        <button onClick={() => setScale((s) => Math.max(0.25, +(s / 1.2).toFixed(3)))}>Zoom out</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(6, +(s * 1.2).toFixed(3)))}>Zoom in</button>
        <button onClick={() => setTurns((t) => (t + 1) % 4)}>Rotate</button>
        <label>
          <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> Show text boxes
        </label>
      </div>
      {error && <p className="error">Could not display this PDF: {error}</p>}
      <div className="pdf-scroll">
        <div className="pdf-page" style={view ? { width: view.width, height: view.height } : undefined}>
          <canvas ref={canvasRef} />
          {view && (
            <div
              ref={overlayRef}
              className="pdf-overlay"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={() => setDrag(null)}
            >
              {view.boxes.map((b, i) => {
                const c = toCss(b.rect);
                return (
                  <span key={i} className={showText ? "pdf-text shown" : "pdf-text"} style={{ ...c, fontSize: c.height }}>
                    {b.str}
                  </span>
                );
              })}
              {pageHighlights.map((h, i) => (
                <div key={`h${i}`} className="pdf-highlight" style={toCss(h.rect)} />
              ))}
              {selected && selected.pageNo === pageNo && <div className="pdf-selection" style={toCss(selected.rect)} />}
              {drag && (
                <div
                  className="pdf-selection drafting"
                  style={{
                    left: Math.min(drag.x0, drag.x1),
                    top: Math.min(drag.y0, drag.y1),
                    width: Math.abs(drag.x1 - drag.x0),
                    height: Math.abs(drag.y1 - drag.y0),
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
