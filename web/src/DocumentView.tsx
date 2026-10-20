import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentDetailDto, DocumentDto, FactDto, Language, PdfRect, ProposeFactResponse, UpdateDocumentRequest } from "@finshark/shared";
import { ApiError, apiFetch, errorText } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { FactFormFields } from "./FactFields.tsx";
import { applyConceptChange, buildProposeRequest, emptyFactForm, isMoney, mismatchWarning, validateFactForm, type FactFormState } from "./factForm.ts";
import { PdfViewer, type PdfHighlight, type PdfSelection } from "./PdfViewer.tsx";
import { hrefDocuments, hrefFact } from "./route.ts";
import { AddAccount } from "./AccountsPage.tsx";
import { conceptLabel, pickLabel } from "./labels.ts";
import { findPreviousDocument, factDateLabel, periodLabel, suggestionsFromFacts, type Suggestion } from "./suggest.ts";
import { sortInstitutions } from "./institutionSort.ts";
import { AccountName, AccountSelect, ErrorNote, FactAmount, FactConcept, StatusBadge, Warning, useLoad } from "./ui.tsx";
import { Text, Value } from "./Value.tsx";

interface FocusTarget {
  pageNo: number;
  rect: PdfRect;
  nonce: number;
}

export function DocumentView({ id, factId }: { id: number; factId: number | null }) {
  const { concepts, accounts } = useRefData();
  const { mutate } = useActor();
  const detail = useLoad(() => apiFetch<DocumentDetailDto>(`/api/documents/${id}`), id);
  const facts = useLoad(() => apiFetch<{ facts: FactDto[] }>(`/api/facts?document=${id}`).then((r) => r.facts), id);
  const allDocs = useLoad(() => apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents), id);

  const [focusedFactId, setFocusedFactId] = useState<number | null>(factId);
  const [focusNonce, setFocusNonce] = useState(0);
  const [hintFocus, setHintFocus] = useState<FocusTarget | null>(null);
  const [hintBox, setHintBox] = useState<{ pageNo: number; rect: PdfRect } | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);

  const [draft, setDraft] = useState<PdfSelection | null>(null);
  const [form, setForm] = useState<FactFormState>(emptyFactForm());
  const [resetKey, setResetKey] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<ProposeFactResponse | null>(null);
  const [conflictWith, setConflictWith] = useState<FactDto[] | null>(null);
  const addPanel = useRef<HTMLDivElement>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    setFocusedFactId(factId);
    setFocusNonce((n) => n + 1);
    setHintFocus(null);
  }, [factId, id]);

  const doc = detail.data;
  const period = useMemo(
    () => ({ periodStart: doc?.periodStart ?? null, periodEnd: doc?.periodEnd ?? null, issuedOn: doc?.issuedOn ?? null, taxYear: doc?.taxYear ?? null }),
    [doc?.periodStart, doc?.periodEnd, doc?.issuedOn, doc?.taxYear],
  );
  const fallbackCurrency = doc?.language === "he" ? "ILS" : "USD";

  // Fresh form per document; with exactly one linked account, start from it.
  useEffect(() => {
    if (!doc) return;
    const only = doc.accountIds.length === 1 ? accounts.find((a) => a.id === doc.accountIds[0]) : undefined;
    setForm({ ...emptyFactForm(), accountId: only ? String(only.id) : "", currency: only?.nativeCurrency ?? "" });
    setDraft(null);
    setAdded(null);
    setConflictWith(null);
    setHintBox(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  useEffect(() => {
    if (!doc || doc.accountIds.length !== 1) return;
    const only = accounts.find((a) => a.id === doc.accountIds[0]);
    if (only) setForm((f) => (f.accountId === "" ? { ...f, accountId: String(only.id), currency: f.currency || only.nativeCurrency } : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.accountIds.join(",")]);

  const updateForm = (next: FactFormState) => {
    const c = concepts.find((x) => x.id === next.conceptId);
    setForm(isMoney(c) && next.currency === "" ? { ...next, currency: fallbackCurrency } : next);
  };

  const concept = concepts.find((c) => c.id === form.conceptId);

  // ---- what the viewer shows
  const liveFacts = useMemo(() => (facts.data ?? []).filter((f) => showSuperseded || f.status !== "superseded"), [facts.data, showSuperseded]);
  const highlights = useMemo<PdfHighlight[]>(() => {
    const out: PdfHighlight[] = [];
    for (const f of liveFacts) {
      for (const s of f.sources) {
        if (s.documentId === id && s.bbox && s.pageNo !== null) out.push({ pageNo: s.pageNo, rect: s.bbox, variant: f.status, focused: f.id === focusedFactId });
      }
    }
    if (hintBox) out.push({ ...hintBox, variant: "hint" });
    return out;
  }, [liveFacts, id, focusedFactId, hintBox]);

  const factFocus = useMemo<FocusTarget | null>(() => {
    const f = facts.data?.find((x) => x.id === focusedFactId);
    const s = f?.sources.find((x) => x.documentId === id && x.bbox && x.pageNo !== null);
    return s ? { pageNo: s.pageNo!, rect: s.bbox!, nonce: focusNonce } : null;
  }, [facts.data, focusedFactId, focusNonce, id]);
  const focus = hintFocus && hintFocus.nonce >= focusNonce ? hintFocus : factFocus;

  const clickFact = (f: FactDto) => {
    setFocusedFactId(f.id);
    setFocusNonce((n) => n + 1);
    setHintFocus(null);
  };

  // ---- "same as last time"
  const previous = useMemo(
    () => (doc && allDocs.data ? findPreviousDocument(doc, allDocs.data, doc.accountIds) : null),
    [doc, allDocs.data],
  );
  const prevFacts = useLoad(
    () => (previous ? apiFetch<{ facts: FactDto[] }>(`/api/facts?document=${previous.id}`).then((r) => r.facts) : Promise.resolve([] as FactDto[])),
    previous?.id ?? null,
  );
  const suggestions = useMemo(
    () => (previous && prevFacts.data ? suggestionsFromFacts(prevFacts.data, previous.id, doc?.accountIds) : []),
    [previous, prevFacts.data, doc?.accountIds],
  );

  const useSuggestion = (s: Suggestion) => {
    const c = concepts.find((x) => x.id === s.conceptId);
    if (!c) return;
    const acct = s.accountId !== null ? accounts.find((a) => a.id === s.accountId) : undefined;
    const base = { ...form, ...(acct ? { accountId: String(acct.id), currency: acct.nativeCurrency } : {}) };
    updateForm(applyConceptChange(base, c, concept, period));
    if (s.hint) {
      setHintBox({ pageNo: s.hint.pageNo, rect: s.hint.bbox });
      setHintFocus({ pageNo: s.hint.pageNo, rect: s.hint.bbox, nonce: focusNonce + 1 });
      setFocusNonce((n) => n + 1);
    }
  };

  // ---- drawing a box
  const onSelect = (sel: PdfSelection) => {
    setDraft(sel);
    setAdded(null);
    setErrors([]);
    setForm((f) => ({ ...f, value: sel.text.trim() }));
    addPanel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const submit = async () => {
    const errs = validateFactForm(form, concept);
    if (!draft) errs.unshift("Draw a box around the number on the PDF first.");
    setErrors(errs);
    if (errs.length || !concept || !draft) return;
    setBusy(true);
    try {
      const res = await mutate(() =>
        apiFetch<ProposeFactResponse>("/api/facts", {
          method: "POST",
          body: buildProposeRequest(form, concept, { documentId: id, pageNo: draft.pageNo, bbox: draft.rect }),
        }),
      );
      let fact = res.fact;
      let conflicts: FactDto[] | null = null;
      try {
        fact = await mutate(() => apiFetch<{ fact: FactDto }>(`/api/facts/${fact.id}/verify`, { method: "POST", body: {} }).then((r) => r.fact));
      } catch (e) {
        // A different value is already verified for the same slot: keep it as proposed and say so.
        conflicts = e instanceof ApiError ? e.conflicts : null;
        if (!conflicts) throw e;
      }
      setAdded({ ...res, fact });
      setConflictWith(conflicts);
      setDraft(null);
      setResetKey((k) => k + 1);
      setHintBox(null);
      setForm((f) => ({ ...emptyFactForm(), accountId: f.accountId, currency: f.currency }));
      setFocusedFactId(res.fact.id);
      setFocusNonce((n) => n + 1);
      setHintFocus(null);
      await Promise.all([facts.reload(), detail.reload(), allDocs.reload()]);
    } catch (e) {
      setErrors([errorText(e)]);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: "inbox" | "reviewed") => {
    setStatusBusy(true);
    try {
      await mutate(() => apiFetch(`/api/documents/${id}`, { method: "PATCH", body: { status } satisfies UpdateDocumentRequest }));
      setStatusError(null);
      if (status === "reviewed") {
        window.location.hash = hrefDocuments();
        return;
      }
      await Promise.all([detail.reload(), allDocs.reload()]);
    } catch (e) {
      setStatusError(errorText(e));
    } finally {
      setStatusBusy(false);
    }
  };

  if (detail.error) return <section><p><a href="#/documents">Back to documents</a></p><ErrorNote>{detail.error}</ErrorNote></section>;
  if (!doc) return <p>Loading...</p>;

  const warning = added ? mismatchWarning(added.valueMatchesSource, added.fact.sources[0]?.quotedText ?? null) : null;

  return (
    <section className="docview">
      <div className="docview-head">
        <a href="#/documents">All documents</a>
        <h1 dir="auto">{doc.originalFilename}</h1>
        <span className="spacer" />
        {statusError && <ErrorNote>{statusError}</ErrorNote>}
        {doc.status === "reviewed" ? (
          <button onClick={() => void setStatus("inbox")} disabled={statusBusy}>Move back to inbox</button>
        ) : (
          <button className="primary" onClick={() => void setStatus("reviewed")} disabled={statusBusy}>Mark reviewed</button>
        )}
      </div>
      <div className="docview-grid">
        <div className="docview-pdf">
          <PdfViewer
            source={{ url: `/api/documents/${id}/file` }}
            highlights={highlights}
            onSelect={onSelect}
            focus={focus}
            selectionResetKey={resetKey}
          />
          <p className="legend">
            Boxes: <span className="swatch proposed" /> not verified <span className="swatch verified" /> verified{" "}
            <span className="swatch rejected" /> rejected <span className="swatch hint" /> where it was last time
          </p>
        </div>

        <div className="docview-side">
          <DocDetails doc={doc} selectedText={draft?.text.trim() || null} onChanged={async () => { await Promise.all([detail.reload(), allDocs.reload()]); }} />

          <div className="panel" ref={addPanel}>
            <h3>Add a number</h3>
            {!draft && !concept && <p>Drag a box on the PDF around a number. Its text is filled in for you.</p>}
            {draft && (
              <p className="small">
                Box on page {draft.pageNo}: <Value>{draft.text.trim() || "(no text found under the box)"}</Value>
              </p>
            )}
            {added && (
              <div>
                {conflictWith ? (
                  <Warning>
                    Saved <FactAmount fact={added.fact} /> (<FactConcept fact={added.fact} />) but not verified: a different value is already verified for the
                    same kind of number, account, person and date ({conflictWith.map((c, i) => <span key={c.id}>{i > 0 && ", "}<a href={hrefFact(c.id)}>#{c.id}</a></span>)}).{" "}
                    <a href={hrefFact(added.fact.id)}>Open it</a> to correct or compare.
                  </Warning>
                ) : (
                  <p className="ok">Added and verified <FactAmount fact={added.fact} /> (<FactConcept fact={added.fact} />).</p>
                )}
                {warning && <Warning>{warning}</Warning>}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <FactFormFields
                form={form}
                onChange={updateForm}
                concepts={concepts}
                accounts={accounts}
                institutionId={doc.institutionId}
                period={period}
              />
              {errors.map((m) => <ErrorNote key={m}>{m}</ErrorNote>)}
              <p>
                <button type="submit" disabled={busy}>Add this number</button>{" "}
                {draft && <button type="button" onClick={() => { setDraft(null); setResetKey((k) => k + 1); }}>Clear box</button>}
              </p>
            </form>
          </div>

          <SameAsLastTime
            doc={doc}
            previous={previous}
            suggestions={suggestions}
            loading={prevFacts.loading || allDocs.loading}
            onPick={useSuggestion}
          />

          <div className="panel">
            <h3>Numbers from this document</h3>
            <ErrorNote>{facts.error}</ErrorNote>
            <label className="small">
              <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} /> Show replaced numbers
            </label>
            {liveFacts.length === 0 && !facts.loading && <p className="muted">None yet.</p>}
            <ul className="facts">
              {liveFacts.map((f) => (
                <li key={f.id} className={f.id === focusedFactId ? "focused" : undefined}>
                  <button className="linklike" onClick={() => clickFact(f)} title="Show where this number is on the page">
                    <StatusBadge status={f.status} /> <FactConcept fact={f} /> <FactAmount fact={f} />
                  </button>
                  <div className="small muted">
                    {factDateLabel(f)} {f.accountName && <>· <Text>{f.accountName}</Text></>}
                    {f.valueMatchesSource === false && <span className="warn"> · differs from the box</span>}
                    {" "}
                    <a href={hrefFact(f.id)}>History</a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- details

function DocDetails({ doc, selectedText, onChanged }: { doc: DocumentDetailDto; selectedText: string | null; onChanged: () => Promise<void> }) {
  const { institutions, docTypes, accounts } = useRefData();
  const { mutate } = useActor();
  const initial = () => ({
    institutionId: doc.institutionId === null ? "" : String(doc.institutionId),
    docType: doc.docType ?? "",
    language: doc.language ?? "",
    periodStart: doc.periodStart ?? "",
    periodEnd: doc.periodEnd ?? "",
    taxYear: doc.taxYear === null ? "" : String(doc.taxYear),
  });
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkId, setLinkId] = useState("");
  const [open, setOpen] = useState(doc.institutionId === null || doc.accountIds.length === 0 || (doc.periodEnd === null && doc.taxYear === null));
  useEffect(() => setF(initial()), // eslint-disable-line react-hooks/exhaustive-deps
    [doc.id, doc.institutionId, doc.docType, doc.language, doc.periodStart, doc.periodEnd, doc.taxYear]);

  // Documents linked to accounts before this existed: fill in the institution when the accounts agree on one.
  const linkedInstitutions = [...new Set(doc.accountIds.map((aid) => accounts.find((a) => a.id === aid)?.institutionId))];
  const inferredInstitution = doc.institutionId === null && linkedInstitutions.length === 1 ? linkedInstitutions[0] : undefined;
  useEffect(() => {
    if (inferredInstitution === undefined) return;
    void mutate(() => apiFetch(`/api/documents/${doc.id}`, { method: "PATCH", body: { institutionId: inferredInstitution } satisfies UpdateDocumentRequest }))
      .then(onChanged)
      .catch((e) => setError(errorText(e)));
  }, [doc.id, inferredInstitution]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body: UpdateDocumentRequest, flashSaved: boolean) => {
    setBusy(true);
    try {
      await mutate(() => apiFetch(`/api/documents/${doc.id}`, { method: "PATCH", body }));
      setError(null);
      setSaved(flashSaved);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (f.taxYear !== "" && !/^\d{4}$/.test(f.taxYear)) return setError("Tax year must be 4 digits, like 2025.");
    void patch(
      {
        institutionId: f.institutionId === "" ? null : Number(f.institutionId),
        docType: f.docType === "" ? null : f.docType,
        language: f.language === "" ? null : (f.language as Language),
        periodStart: f.periodStart === "" ? null : f.periodStart,
        periodEnd: f.periodEnd === "" ? null : f.periodEnd,
        taxYear: f.taxYear === "" ? null : Number(f.taxYear),
      },
      true,
    );
  };

  const set = (p: Partial<typeof f>) => {
    setSaved(false);
    setF({ ...f, ...p });
  };

  const link = async (accountId = Number(linkId)) => {
    if (!accountId) return;
    setBusy(true);
    try {
      await mutate(() => apiFetch(`/api/documents/${doc.id}/accounts`, { method: "POST", body: { accountId } }));
      setLinkId("");
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <strong>About this document</strong>{" "}
        <span className="muted small">
          {doc.status === "reviewed" ? "reviewed" : "needs review"} {periodLabel(doc)}
        </span>
      </summary>
      <div className="fields">
        <label>
          <span>Institution</span>
          <select value={f.institutionId} onChange={(e) => set({ institutionId: e.target.value })}>
            <option value="">Not set</option>
            {sortInstitutions(institutions).map((i) => <option key={i.id} value={i.id} dir="auto">{i.name}</option>)}
          </select>
        </label>
        <div className="row">
          <label>
            <span>Document type</span>
            <select value={f.docType} onChange={(e) => set({ docType: e.target.value })}>
              <option value="">Not set</option>
              {docTypes.map((t) => <option key={t.id} value={t.id}>{pickLabel(t.labelEn, t.labelHe, doc.language)}</option>)}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select value={f.language} onChange={(e) => set({ language: e.target.value })}>
              <option value="">Not set</option>
              <option value="en">English</option>
              <option value="he">Hebrew</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label><span>Period start</span><input type="date" value={f.periodStart} onChange={(e) => set({ periodStart: e.target.value })} /></label>
          <label><span>Period end</span><input type="date" value={f.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} /></label>
        </div>
        <div className="row">
          <label><span>Tax year</span><input type="text" size={6} maxLength={4} value={f.taxYear} onChange={(e) => set({ taxYear: e.target.value })} /></label>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <p>
          <button onClick={save} disabled={busy}>Save details</button> {saved && <span className="ok">Saved</span>}
        </p>
        <div>
          <span className="label">Accounts</span>
          {doc.accountIds.length === 0 && <span className="muted"> none linked yet</span>}
          {doc.accountIds.map((aid) => {
            const a = accounts.find((x) => x.id === aid);
            return a ? <div key={aid}><AccountName account={a} /></div> : null;
          })}
          <div className="row">
            <AccountSelect accounts={accounts.filter((a) => !doc.accountIds.includes(a.id))} institutionId={doc.institutionId} value={linkId} onChange={setLinkId} noneLabel="Link an account..." />
            {linkId !== "" && <button onClick={() => void link()} disabled={busy}>Link account</button>}
          </div>
          <details>
            <summary>Create an account from this document</summary>
            <p className="muted small">Drag a box around the account number on the PDF, then use the boxed text below. The new account is linked to this document.</p>
            <AddAccount institutionId={doc.institutionId} pickedText={selectedText} onCreated={(a) => link(a.id)} />
          </details>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- same as last time

function SameAsLastTime({
  doc,
  previous,
  suggestions,
  loading,
  onPick,
}: {
  doc: DocumentDetailDto;
  previous: DocumentDto | null;
  suggestions: Suggestion[];
  loading: boolean;
  onPick: (s: Suggestion) => void;
}) {
  const { concepts } = useRefData();
  if (doc.accountIds.length === 0) {
    return (
      <div className="panel">
        <h3>Same as last time</h3>
        <p className="muted">Link this document to an account (under "About this document") to see what you recorded from the previous one.</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <h3>Same as last time</h3>
      {loading && <p className="muted">Looking...</p>}
      {!loading && !previous && <p className="muted">No earlier document for this account has numbers yet.</p>}
      {previous && (
        <>
          <p className="small">
            From <a href={`#/documents/${previous.id}`} dir="auto">{previous.originalFilename}</a> <span className="muted">{periodLabel(previous)}</span>. Click one, then
            draw a box around it here.
          </p>
          <ul className="suggestions">
            {suggestions.map((s) => {
              const c = concepts.find((x) => x.id === s.conceptId);
              return (
                <li key={`${s.conceptId}|${s.accountId}`}>
                  <button onClick={() => onPick(s)}>
                    <Text>{c ? conceptLabel(c, s.language) : s.labelEn}</Text>
                  </button>{" "}
                  <span className="muted small">was <Value>{s.formatted}</Value></span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
