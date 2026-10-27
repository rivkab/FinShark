import { useEffect, useMemo, useState } from "react";
import type { DocumentDetailDto, DocumentDto, FactDto, Language, PdfRect, ProposeFactResponse, UpdateDocumentRequest } from "@finshark/shared";
import { ApiError, apiFetch, errorText } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { FactFormFields } from "./FactFields.tsx";
import { applyConceptChange, buildProposeRequest, emptyFactForm, isMoney, mismatchWarning, validateFactForm, type FactFormState } from "./factForm.ts";
import { PdfViewer, type PdfHighlight, type PdfSelection } from "./pdf/PdfViewer.tsx";
import { PdfLegend } from "./pdf/PdfLegend.tsx";
import { hrefDocument, hrefDocuments, hrefFact } from "./route.ts";
import { AddAccount } from "./AccountsPage.tsx";
import { conceptLabel, pickLabel } from "./labels.ts";
import { findPreviousDocument, factDateLabel, periodLabel, suggestionsFromFacts, type Suggestion } from "./suggest.ts";
import { sortInstitutions } from "./institutionSort.ts";
import { AccountName, AccountSelect, FactAmount, FactConcept, StatusBadge, useAction, useLoad } from "./ui.tsx";
import { Alert, Button, Checkbox, DataText, DateInput, Disclosure, Empty, Field, FieldRow, Form, Inline, Link, List, ListItem, Loading, Page, Panel, Select, SplitLayout, Stack, Text, TextInput, Value } from "./ds/index.ts";

interface FocusTarget {
  pageNo: number;
  rect: PdfRect;
  nonce: number;
}

export function DocumentView({ id, factId }: { id: number; factId: number | null }) {
  const { concepts, accounts, institutions } = useRefData();
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
  const [added, setAdded] = useState<ProposeFactResponse | null>(null);
  const [conflictWith, setConflictWith] = useState<FactDto[] | null>(null);

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
    add.setError(null);
    setForm((f) => ({ ...f, value: sel.text.trim() }));
  };

  const add = useAction(async () => {
    const res = await mutate(() =>
      apiFetch<ProposeFactResponse>("/api/facts", {
        method: "POST",
        body: buildProposeRequest(form, concept!, { documentId: id, pageNo: draft!.pageNo, bbox: draft!.rect }),
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
  });

  const submit = () => {
    const errs = validateFactForm(form, concept);
    if (!draft) errs.unshift("Draw a box around the number on the PDF first.");
    setErrors(errs);
    add.setError(null);
    if (errs.length || !concept || !draft) return;
    void add.run();
  };

  const setStatus = useAction(async (status: "inbox" | "reviewed") => {
    await mutate(() => apiFetch(`/api/documents/${id}`, { method: "PATCH", body: { status } satisfies UpdateDocumentRequest }));
    if (status === "reviewed") {
      window.location.hash = hrefDocuments();
      return;
    }
    await Promise.all([detail.reload(), allDocs.reload()]);
  });

  if (detail.error) {
    return (
      <Page title="Document" back={{ href: "#/documents", label: "Back to documents" }}>
        <Alert tone="danger">{detail.error}</Alert>
      </Page>
    );
  }
  if (!doc) return <Loading />;

  const warning = added ? mismatchWarning(added.valueMatchesSource, added.fact.sources[0]?.quotedText ?? null) : null;

  const inst = institutions.find((i) => i.id === doc.institutionId);
  const eyebrow = [inst?.name, periodLabel(doc)].filter(Boolean).join(" · ");

  return (
    <Page
      width="wide"
      back={{ href: "#/documents", label: "All documents" }}
      eyebrow={eyebrow}
      title={<DataText>{doc.originalFilename}</DataText>}
      actions={
        doc.status === "reviewed" ? (
          <Button onClick={() => void setStatus.run("inbox")} busy={setStatus.busy}>Move back to inbox</Button>
        ) : (
          <Button variant="primary" onClick={() => void setStatus.run("reviewed")} busy={setStatus.busy}>Mark reviewed</Button>
        )
      }
    >
      <Stack gap={4}>
        <Alert tone="danger">{setStatus.error}</Alert>
        <SplitLayout
          main={
            <Stack gap={2}>
              <PdfViewer
                source={{ url: `/api/documents/${id}/file` }}
                highlights={highlights}
                onSelect={onSelect}
                focus={focus}
                selectionResetKey={resetKey}
              />
              <PdfLegend />
            </Stack>
          }
          aside={
            <Stack gap={4}>
              <DocDetails doc={doc} selectedText={draft?.text.trim() || null} onChanged={async () => { await Promise.all([detail.reload(), allDocs.reload()]); }} />

              <Panel title="Add a number" revealKey={draft ? `${draft.pageNo}:${draft.rect.join(",")}` : null}>
                <Stack gap={3}>
                  {!draft && !concept && <Text as="p">Drag a box on the PDF around a number. Its text is filled in for you.</Text>}
                  {draft && (
                    <Text as="p" size="sm">
                      Box on page <Value>{draft.pageNo}</Value>: <Value>{draft.text.trim() || "(no text found under the box)"}</Value>
                    </Text>
                  )}
                  {added && (
                    <Stack gap={2}>
                      {conflictWith ? (
                        <Alert tone="warning">
                          Saved <FactAmount fact={added.fact} /> (<FactConcept fact={added.fact} />) but it conflicts: a different value is already verified for the
                          same kind of number, account, person and date ({conflictWith.map((c, i) => <Text key={c.id}>{i > 0 && ", "}<Link href={hrefFact(c.id)}>#{c.id}</Link></Text>)}).{" "}
                          <Link href={hrefFact(added.fact.id)}>Open it</Link> to correct or compare.
                        </Alert>
                      ) : (
                        <Alert tone="success">Added <FactAmount fact={added.fact} /> (<FactConcept fact={added.fact} />).</Alert>
                      )}
                      <Alert tone="warning">{warning}</Alert>
                    </Stack>
                  )}
                  <Form onSubmit={submit}>
                    <FactFormFields
                      form={form}
                      onChange={updateForm}
                      concepts={concepts}
                      accounts={accounts}
                      institutionId={doc.institutionId}
                      period={period}
                    />
                    {errors.map((m) => <Alert tone="danger" key={m}>{m}</Alert>)}
                    <Alert tone="danger">{add.error}</Alert>
                    <Inline>
                      <Button type="submit" variant="primary" busy={add.busy}>Add this number</Button>
                      {draft && <Button onClick={() => { setDraft(null); setResetKey((k) => k + 1); }}>Clear box</Button>}
                    </Inline>
                  </Form>
                </Stack>
              </Panel>

              <SameAsLastTime
                doc={doc}
                previous={previous}
                suggestions={suggestions}
                loading={prevFacts.loading || allDocs.loading}
                onPick={useSuggestion}
              />

              <Panel title="Numbers from this document">
                <Stack gap={3}>
                  <Alert tone="danger">{facts.error}</Alert>
                  <Checkbox checked={showSuperseded} onChange={setShowSuperseded} label="Show replaced numbers" />
                  {liveFacts.length === 0 && !facts.loading && <Empty>None yet.</Empty>}
                  <List divided>
                    {liveFacts.map((f) => (
                      <ListItem
                        key={f.id}
                        current={f.id === focusedFactId}
                        onClick={() => clickFact(f)}
                        title="Show where this number is on the page"
                        aside={
                          <>
                            {factDateLabel(f)} {f.accountName && <>· <DataText>{f.accountName}</DataText></>}
                            {f.valueMatchesSource === false && <Text tone="warning"> · differs from the box</Text>}
                            {" · "}
                            <Link href={hrefFact(f.id)}>History</Link>
                          </>
                        }
                      >
                        <Inline>
                          <StatusBadge status={f.status} /> <FactConcept fact={f} /> <FactAmount fact={f} />
                        </Inline>
                      </ListItem>
                    ))}
                  </List>
                </Stack>
              </Panel>
            </Stack>
          }
        />
      </Stack>
    </Page>
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
  const [saved, setSaved] = useState(false);
  const [linkId, setLinkId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [open, setOpen] = useState(doc.institutionId === null || doc.accountIds.length === 0 || (doc.periodEnd === null && doc.taxYear === null));
  // One busy/error pair for saving and linking.
  const { run, busy, error, setError } = useAction((task: () => Promise<void>) => task());
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

  const patch = (body: UpdateDocumentRequest, flashSaved: boolean) =>
    run(async () => {
      await mutate(() => apiFetch(`/api/documents/${doc.id}`, { method: "PATCH", body }));
      setSaved(flashSaved);
      await onChanged();
    });

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
    await run(async () => {
      await mutate(() => apiFetch(`/api/documents/${doc.id}/accounts`, { method: "POST", body: { accountId } }));
      setLinkId("");
      await onChanged();
    });
  };

  return (
    <Disclosure
      summary="About this document"
      meta={`${doc.status === "reviewed" ? "reviewed" : "needs review"} ${periodLabel(doc)}`}
      open={open}
      onToggle={setOpen}
    >
      <Stack gap={4}>
        <Form onSubmit={save} gap={3}>
          <Field label="Institution">
            <Select
              value={f.institutionId}
              onChange={(v) => set({ institutionId: v })}
              placeholder="Not set"
              options={sortInstitutions(institutions).map((i) => ({ value: String(i.id), label: i.name, dir: "auto" }))}
            />
          </Field>
          <FieldRow>
            <Field label="Document type" grow>
              <Select
                value={f.docType}
                onChange={(v) => set({ docType: v })}
                placeholder="Not set"
                options={docTypes.map((t) => ({ value: t.id, label: pickLabel(t.labelEn, t.labelHe, doc.language) }))}
              />
            </Field>
            <Field label="Language" grow>
              <Select
                value={f.language}
                onChange={(v) => set({ language: v })}
                placeholder="Not set"
                options={[{ value: "en", label: "English" }, { value: "he", label: "Hebrew" }]}
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Period start" grow><DateInput value={f.periodStart} onChange={(v) => set({ periodStart: v })} /></Field>
            <Field label="Period end" grow><DateInput value={f.periodEnd} onChange={(v) => set({ periodEnd: v })} /></Field>
          </FieldRow>
          <FieldRow>
            <Field label="Tax year"><TextInput maxLength={4} value={f.taxYear} onChange={(v) => set({ taxYear: v })} /></Field>
          </FieldRow>
          <Alert tone="danger">{error}</Alert>
          <Inline>
            <Button type="submit" busy={busy}>Save details</Button>
            {saved && <Text tone="success">Saved</Text>}
          </Inline>
        </Form>
        <Stack gap={2}>
          <Text size="sm" weight="medium" tone="muted">Accounts</Text>
          {doc.accountIds.length === 0 && <Text tone="muted">none linked yet</Text>}
          {doc.accountIds.map((aid) => {
            const a = accounts.find((x) => x.id === aid);
            return a ? <AccountName key={aid} account={a} /> : null;
          })}
          <FieldRow>
            <AccountSelect accounts={accounts.filter((a) => !doc.accountIds.includes(a.id))} institutionId={doc.institutionId} value={linkId} onChange={setLinkId} noneLabel="Link an account..." />
            {linkId !== "" && <Button onClick={() => void link()} busy={busy}>Link account</Button>}
          </FieldRow>
          <Disclosure summary="Create an account from this document" open={createOpen} onToggle={setCreateOpen}>
            <Stack gap={3}>
              <Text as="p" size="sm" tone="muted">Drag a box around the account number on the PDF, then use the boxed text below. The new account is linked to this document.</Text>
              <AddAccount institutionId={doc.institutionId} pickedText={selectedText} onCreated={async (a) => { await link(a.id); }} />
            </Stack>
          </Disclosure>
        </Stack>
      </Stack>
    </Disclosure>
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
      <Panel title="Same as last time">
        <Empty>Link this document to an account (under "About this document") to see what you recorded from the previous one.</Empty>
      </Panel>
    );
  }
  return (
    <Panel title="Same as last time">
      <Stack gap={3}>
        {loading && <Empty>Looking...</Empty>}
        {!loading && !previous && <Empty>No earlier document for this account has numbers yet.</Empty>}
        {previous && (
          <>
            <Text as="p" size="sm">
              From <Link href={hrefDocument(previous.id)}><DataText>{previous.originalFilename}</DataText></Link> <Text tone="muted">{periodLabel(previous)}</Text>. Click one, then
              draw a box around it here.
            </Text>
            <List>
              {suggestions.map((s) => {
                const c = concepts.find((x) => x.id === s.conceptId);
                return (
                  <ListItem key={`${s.conceptId}|${s.accountId}`}>
                    <Inline>
                      <Button size="sm" onClick={() => onPick(s)}>
                        <DataText>{c ? conceptLabel(c, s.language) : s.labelEn}</DataText>
                      </Button>
                      <Text size="sm" tone="muted">was <Value>{s.formatted}</Value></Text>
                    </Inline>
                  </ListItem>
                );
              })}
            </List>
          </>
        )}
      </Stack>
    </Panel>
  );
}
