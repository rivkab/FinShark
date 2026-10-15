import { useEffect, useMemo, useRef, useState } from "react";
import type { FactDto } from "@finshark/shared";
import { ApiError, apiFetch, errorText } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { FactFormFields } from "./FactFields.tsx";
import { buildCorrectRequest, formFromFact, mismatchWarning, validateFactForm, type FactFormState } from "./factForm.ts";
import { PdfViewer } from "./PdfViewer.tsx";
import { hrefDocument, hrefFact } from "./route.ts";
import { reviewShortcut } from "./shortcuts.ts";
import { factDateLabel } from "./suggest.ts";
import { AccountName, ErrorNote, FactAmount, FactConcept, StatusBadge, Warning, useLoad } from "./ui.tsx";
import { Text, Value } from "./Value.tsx";

type Mode = "idle" | "correct" | "reject";

export function ReviewPage({ startFactId }: { startFactId: number | null }) {
  const queue = useLoad(() => apiFetch<{ items: FactDto[] }>("/api/review-queue").then((r) => r.items), 0);
  const [items, setItems] = useState<FactDto[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!queue.data || items) return;
    setItems(queue.data);
    const at = startFactId === null ? -1 : queue.data.findIndex((f) => f.id === startFactId);
    setIndex(at >= 0 ? at : 0);
  }, [queue.data, items, startFactId]);

  if (queue.error) return <section><h1>Review</h1><ErrorNote>{queue.error}</ErrorNote></section>;
  if (!items) return <p>Loading...</p>;
  if (items.length === 0) {
    return (
      <section>
        <h1>Review</h1>
        <p>Nothing is waiting for review. Numbers you add from a document appear here.</p>
      </section>
    );
  }
  return (
    <Reviewer
      items={items}
      index={index}
      setIndex={setIndex}
      replace={(i, f) => setItems((all) => all!.map((x, j) => (j === i ? f : x)))}
      restart={async () => {
        const r = await apiFetch<{ items: FactDto[] }>("/api/review-queue");
        setItems(r.items);
        setIndex(0);
      }}
    />
  );
}

function Reviewer({
  items,
  index,
  setIndex,
  replace,
  restart,
}: {
  items: FactDto[];
  index: number;
  setIndex: (i: number) => void;
  replace: (i: number, f: FactDto) => void;
  restart: () => Promise<void>;
}) {
  const { concepts, accounts } = useRefData();
  const { mutate } = useActor();
  const [mode, setMode] = useState<Mode>("idle");
  const [form, setForm] = useState<FactFormState | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<FactDto[] | null>(null);
  const [busy, setBusy] = useState(false);

  const done = index >= items.length;
  const current = done ? null : items[index]!;
  const pending = items.filter((f) => f.status === "proposed").length;

  // Moving to another fact clears any half-finished action.
  useEffect(() => {
    setMode("idle");
    setError(null);
    setConflicts(null);
    setReason("");
  }, [index]);

  const go = (i: number) => setIndex(Math.max(0, Math.min(items.length, i)));

  /** Run a server action on the current fact; a 409 conflict is shown, and we stay put. */
  const act = async (run: () => Promise<FactDto>) => {
    setBusy(true);
    setError(null);
    setConflicts(null);
    try {
      const fact = await mutate(run);
      replace(index, fact);
      go(index + 1);
    } catch (e) {
      const c = e instanceof ApiError ? e.conflicts : null;
      if (c) setConflicts(c);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = () => {
    if (!current || current.status !== "proposed" || busy) return;
    void act(() => apiFetch<{ fact: FactDto }>(`/api/facts/${current.id}/verify`, { method: "POST", body: {} }).then((r) => r.fact));
  };
  const startCorrect = () => {
    if (!current || current.status !== "proposed" || busy) return;
    setForm(formFromFact(current));
    setError(null);
    setConflicts(null);
    setMode("correct");
  };
  const startReject = () => {
    if (!current || current.status !== "proposed" || busy) return;
    setError(null);
    setMode("reject");
  };
  const submitCorrect = () => {
    if (!current || !form) return;
    const concept = concepts.find((c) => c.id === form.conceptId);
    const errs = validateFactForm(form, concept);
    if (errs.length || !concept) return setError(errs.join(" "));
    void act(() =>
      apiFetch<{ fact: FactDto }>(`/api/facts/${current.id}/correct`, { method: "POST", body: buildCorrectRequest(form, concept, true) }).then((r) => r.fact),
    );
  };
  const submitReject = () => {
    if (!current) return;
    if (reason.trim() === "") return setError("Say why you are rejecting it.");
    void act(() => apiFetch<{ fact: FactDto }>(`/api/facts/${current.id}/reject`, { method: "POST", body: { reason: reason.trim() } }).then((r) => r.fact));
  };

  // Keyboard: always call the latest handlers, and never while typing.
  const latest = useRef({ verify, startCorrect, startReject, go, index, mode });
  latest.current = { verify, startCorrect, startReject, go, index, mode };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = latest.current;
      if (e.key === "Escape" && l.mode !== "idle") {
        setMode("idle");
        setError(null);
        return;
      }
      const a = reviewShortcut({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      if (!a || l.mode !== "idle") return;
      e.preventDefault();
      if (a === "verify") l.verify();
      else if (a === "correct") l.startCorrect();
      else if (a === "reject") l.startReject();
      else l.go(l.index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!current) {
    return (
      <section>
        <h1>Review</h1>
        <p>
          You have reached the end of the list. {pending > 0 ? `${pending} still waiting (skipped).` : "Everything in this list has been dealt with."}
        </p>
        <p>
          <button onClick={() => void restart()}>Reload the list</button>
        </p>
      </section>
    );
  }

  const src = current.sources.find((s) => s.bbox && s.pageNo !== null) ?? null;
  const quoted = current.sources[0]?.quotedText ?? null;
  const warning = mismatchWarning(current.valueMatchesSource, quoted);
  const canAct = current.status === "proposed";

  return (
    <section className="review">
      <div className="review-head">
        <h1>Review</h1>
        <strong className="progress">{index + 1} of {items.length}</strong>
        <span className="muted"> {pending} waiting</span>
        <span className="spacer" />
        <button onClick={() => go(index + 1)}>Skip (→)</button>
      </div>

      <div className="docview-grid">
        <div className="docview-pdf">
          {src ? (
            <PdfViewer
              source={{ url: `/api/documents/${src.documentId}/file` }}
              initialScale={1.75}
              highlights={[{ pageNo: src.pageNo!, rect: src.bbox!, variant: current.status, focused: true }]}
              focus={{ pageNo: src.pageNo!, rect: src.bbox!, nonce: current.id }}
            />
          ) : (
            <div className="panel">
              <p>This is a statement made by a person, not read from a document.</p>
            </div>
          )}
        </div>

        <div className="docview-side">
          <div className="panel">
            <p className="big"><FactAmount fact={current} /> <StatusBadge status={current.status} /></p>
            <dl className="kv">
              <dt>Kind of number</dt><dd><FactConcept fact={current} /></dd>
              <dt>Account</dt>
              <dd>{current.accountName ? <Text>{current.accountName}</Text> : <span className="muted">none</span>}</dd>
              <dt>Date</dt><dd><Value>{factDateLabel(current)}</Value></dd>
              {current.personName && (<><dt>Person</dt><dd><Text>{current.personName}</Text></dd></>)}
              {current.note && (<><dt>Note</dt><dd dir="auto">{current.note}</dd></>)}
              <dt>Entered by</dt><dd>{current.createdBy !== null ? <PersonName id={current.createdBy} /> : "unknown"} · {current.createdAt.slice(0, 10)} · {current.origin}</dd>
              {src && (<><dt>Text in the box</dt><dd className="quote" dir="auto"><Value>{quoted?.trim() ? quoted.trim() : "(none found)"}</Value></dd></>)}
              {src && (<><dt>Source</dt><dd><a href={hrefDocument(src.documentId, current.id)} dir="auto">{src.documentName}</a>, page {src.pageNo}</dd></>)}
            </dl>
            {warning && <Warning>{warning}</Warning>}
            {!canAct && <p className="muted">This one is already {current.status}. <a href={hrefFact(current.id)}>See its history</a>.</p>}
            <ErrorNote>{error}</ErrorNote>
            {conflicts && <Conflicts current={current} conflicts={conflicts} />}

            {mode === "idle" && canAct && (
              <p className="actions">
                <button className="primary" onClick={verify} disabled={busy}>Verify <kbd>V</kbd></button>{" "}
                <button onClick={startCorrect} disabled={busy}>Correct <kbd>C</kbd></button>{" "}
                <button onClick={startReject} disabled={busy}>Reject <kbd>R</kbd></button>
              </p>
            )}
            {mode === "idle" && <p className="muted small">Keys: V verify, C correct, R reject, → or J skip.</p>}

            {mode === "reject" && (
              <form onSubmit={(e) => { e.preventDefault(); submitReject(); }} className="fields">
                <label>
                  <span>Why is this wrong?</span>
                  <input type="text" dir="auto" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <p>
                  <button type="submit" disabled={busy}>Reject this number</button>{" "}
                  <button type="button" onClick={() => setMode("idle")}>Cancel (Esc)</button>
                </p>
              </form>
            )}

            {mode === "correct" && form && (
              <form onSubmit={(e) => { e.preventDefault(); submitCorrect(); }}>
                <h3>Correct and verify</h3>
                <FactFormFields
                  form={form}
                  onChange={setForm}
                  concepts={concepts}
                  accounts={accounts}
                  institutionId={null}
                  period={{ periodStart: null, periodEnd: null }}
                />
                <p>
                  <button type="submit" className="primary" disabled={busy}>Save correction and verify</button>{" "}
                  <button type="button" onClick={() => setMode("idle")}>Cancel (Esc)</button>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonName({ id }: { id: number }) {
  const { people } = useRefData();
  return <>{people.find((p) => p.id === id)?.displayName ?? `person ${id}`}</>;
}

function Conflicts({ current, conflicts }: { current: FactDto; conflicts: FactDto[] }) {
  const cols = useMemo(() => [current, ...conflicts], [current, conflicts]);
  return (
    <div className="conflict">
      <Warning>
        Not verified. A different value is already verified for the same kind of number, account, person and date. Compare them below, then correct or reject
        one of them.
      </Warning>
      <table className="data">
        <thead>
          <tr><th /><th>This one (waiting)</th>{conflicts.map((c) => <th key={c.id}>Already verified #{c.id}</th>)}</tr>
        </thead>
        <tbody>
          <tr><th>Value</th>{cols.map((c) => <td key={c.id}><FactAmount fact={c} /></td>)}</tr>
          <tr><th>Kind</th>{cols.map((c) => <td key={c.id}><FactConcept fact={c} /></td>)}</tr>
          <tr><th>Account</th>{cols.map((c) => <td key={c.id} dir="auto">{c.accountName ? <AccountName account={{ displayName: c.accountName, altName: null }} /> : "none"}</td>)}</tr>
          <tr><th>Date</th>{cols.map((c) => <td key={c.id}><Value>{factDateLabel(c)}</Value></td>)}</tr>
          <tr><th>From</th>{cols.map((c) => <td key={c.id} dir="auto">{c.sources[0] ? <a href={hrefDocument(c.sources[0].documentId, c.id)}>{c.sources[0].documentName}</a> : c.origin}</td>)}</tr>
          <tr><th>Verified</th>{cols.map((c) => <td key={c.id}>{c.verifiedAt ? c.verifiedAt.slice(0, 10) : "not yet"}</td>)}</tr>
          <tr><th /> {cols.map((c) => <td key={c.id}><a href={hrefFact(c.id)}>History</a></td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}
