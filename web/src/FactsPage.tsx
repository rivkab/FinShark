import { useState } from "react";
import type { DocumentDto, FactDetailDto, FactDto, FactEventDto } from "@finshark/shared";
import { ApiError, apiFetch, errorText } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { hrefDocument, hrefFact, hrefFacts } from "./route.ts";
import { factDateLabel } from "./suggest.ts";
import { AccountName, ErrorNote, FactAmount, FactConcept, StatusBadge, Warning, useLoad } from "./ui.tsx";
import { FactFormFields } from "./FactFields.tsx";
import { buildCorrectRequest, formFromFact, mismatchWarning, validateFactForm, type FactFormState } from "./factForm.ts";
import { Cell, Text, Value } from "./Value.tsx";

// ---------------------------------------------------------------- list

export function FactsPage({ filters }: { filters: Record<string, string> }) {
  const { concepts, accounts } = useRefData();
  const docs = useLoad(() => apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents), 0);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const facts = useLoad(() => apiFetch<{ facts: FactDto[] }>(`/api/facts${query ? `?${query}` : ""}`).then((r) => r.facts), query);

  const set = (k: string, v: string) => {
    window.location.hash = hrefFacts({ ...filters, [k]: v }).slice(1);
  };

  return (
    <section>
      <h1>Facts</h1>
      <div className="filters">
        <label>
          <span>Status</span>
          <select value={filters["status"] ?? ""} onChange={(e) => set("status", e.target.value)}>
            <option value="">Any</option>
            <option value="proposed">Not verified</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="superseded">Replaced</option>
          </select>
        </label>
        <label>
          <span>Kind of number</span>
          <select value={filters["concept"] ?? ""} onChange={(e) => set("concept", e.target.value)}>
            <option value="">Any</option>
            {concepts.map((c) => <option key={c.id} value={c.id}>{c.labelEn}{c.jurisdiction === "IL" && c.labelHe ? ` / ${c.labelHe}` : ""}</option>)}
          </select>
        </label>
        <label>
          <span>Account</span>
          <select value={filters["account"] ?? ""} onChange={(e) => set("account", e.target.value)}>
            <option value="">Any</option>
            {accounts.map((a) => <option key={a.id} value={a.id} dir="auto">{a.displayName}</option>)}
          </select>
        </label>
        <label>
          <span>Document</span>
          <select value={filters["document"] ?? ""} onChange={(e) => set("document", e.target.value)}>
            <option value="">Any</option>
            {(docs.data ?? []).map((d) => <option key={d.id} value={d.id} dir="auto">{d.originalFilename}</option>)}
          </select>
        </label>
        {Object.values(filters).some(Boolean) && <a href={hrefFacts()}>Clear filters</a>}
      </div>
      <ErrorNote>{facts.error}</ErrorNote>
      {facts.data && facts.data.length === 0 && <p>No facts match.</p>}
      {facts.data && facts.data.length > 0 && (
        <table className="data">
          <thead>
            <tr><th>Status</th><th>Kind of number</th><th>Account</th><th className="num">Value</th><th>Date</th><th>From</th><th /></tr>
          </thead>
          <tbody>
            {facts.data.map((f) => (
              <tr key={f.id} className={f.status}>
                <td><StatusBadge status={f.status} /></td>
                <Cell><FactConcept fact={f} /></Cell>
                <Cell>
                  {f.accountName ?? <span className="muted">none</span>}
                  {f.accountName === null && <DocumentAccountHint fact={f} docs={docs.data} />}
                </Cell>
                <Cell numeric><FactAmount fact={f} /></Cell>
                <td><Value>{factDateLabel(f)}</Value></td>
                <Cell>
                  {f.sources[0] ? <a href={hrefDocument(f.sources[0].documentId, f.id)}>{f.sources[0].documentName}</a> : <span className="muted">{f.origin}</span>}
                </Cell>
                <td><a href={hrefFact(f.id)}>History</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** A fact recorded without an account whose document is linked to one: show the link, but don't treat it as the fact's account. */
function DocumentAccountHint({ fact, docs }: { fact: FactDto; docs: DocumentDto[] | null }) {
  const { accounts } = useRefData();
  const linked = new Set((docs ?? []).filter((d) => fact.sources.some((s) => s.documentId === d.id)).flatMap((d) => d.accountIds));
  const names = accounts.filter((a) => linked.has(a.id)).map((a) => a.displayName);
  if (names.length === 0) return null;
  return <div className="small muted">its document is linked to <Text>{names.join(", ")}</Text>; this number isn't. <a href={hrefFact(fact.id)}>Fix</a></div>;
}

// ---------------------------------------------------------------- history

export function FactHistory({ id }: { id: number }) {
  const { mutate } = useActor();
  const { people, concepts, accounts } = useRefData();
  const detail = useLoad(() => apiFetch<FactDetailDto>(`/api/facts/${id}`), id);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FactFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteReason, setDeleteReason] = useState<string | null>(null);

  if (detail.error) return <section><p><a href="#/facts">All facts</a></p><ErrorNote>{detail.error}</ErrorNote></section>;
  if (!detail.data) return <p>Loading...</p>;
  const { fact: f, events, supersedes, supersededBy } = detail.data;
  const warning = mismatchWarning(f.valueMatchesSource, f.sources[0]?.quotedText ?? null);

  const reopen = async () => {
    try {
      await mutate(() => apiFetch(`/api/facts/${id}/reopen`, { method: "POST", body: {} }));
      setError(null);
      await detail.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const remove = async () => {
    if (busy || deleteReason === null) return;
    if (deleteReason.trim() === "") return setError("Say why this number is being deleted.");
    setBusy(true);
    try {
      await mutate(() => apiFetch(`/api/facts/${id}/reject`, { method: "POST", body: { reason: deleteReason.trim() } }));
      setError(null);
      setDeleteReason(null);
      await detail.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await mutate(() => apiFetch(`/api/facts/${id}/verify`, { method: "POST", body: {} }));
      setError(null);
      await detail.reload();
    } catch (e) {
      setError(e instanceof ApiError && e.conflicts ? "Not verified: a different value is already verified for the same kind of number, account, person and date." : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submitCorrection = async (verify: boolean) => {
    if (!form || busy) return;
    const concept = concepts.find((c) => c.id === form.conceptId);
    const errs = validateFactForm(form, concept);
    if (errs.length || !concept) return setError(errs.join(" "));
    setBusy(true);
    try {
      const r = await mutate(() =>
        apiFetch<{ fact: FactDto }>(`/api/facts/${id}/correct`, { method: "POST", body: buildCorrectRequest(form, concept, verify) }),
      );
      setError(null);
      setForm(null);
      window.location.hash = hrefFact(r.fact.id).slice(1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const who = (e: FactEventDto) => e.actorName ?? (e.actor !== null ? people.find((p) => p.id === e.actor)?.displayName : null) ?? "someone";

  return (
    <section>
      <p><a href="#/facts">All facts</a></p>
      <h1>Fact #{f.id}</h1>
      <div className="panel">
        <p className="big"><FactAmount fact={f} /> <StatusBadge status={f.status} /></p>
        <dl className="kv">
          <dt>Kind of number</dt><dd><FactConcept fact={f} /></dd>
          <dt>Account</dt><dd>{f.accountName ? <AccountName account={{ displayName: f.accountName, altName: null }} /> : <span className="muted">none</span>}</dd>
          {f.personName && (<><dt>Person</dt><dd><Text>{f.personName}</Text></dd></>)}
          <dt>Date</dt><dd><Value>{factDateLabel(f)}</Value></dd>
          <dt>How it got here</dt><dd>{f.origin === "attestation" ? "A person's statement (no document)" : f.origin}</dd>
          {f.note && (<><dt>Note</dt><dd dir="auto">{f.note}</dd></>)}
        </dl>
        {warning && <Warning>{warning}</Warning>}
        {f.status === "rejected" && <p><button onClick={() => void reopen()}>Reopen</button></p>}
        {f.status === "proposed" && !form && <p><button className="primary" onClick={() => void verify()} disabled={busy}>Verify</button></p>}
        {(f.status === "proposed" || f.status === "verified") && !form && (
          <p><button onClick={() => { setError(null); setForm(formFromFact(f)); }}>Correct this number</button></p>
        )}
        {(f.status === "proposed" || f.status === "verified") && !form && deleteReason === null && (
          <p><button onClick={() => { setError(null); setDeleteReason(""); }}>Delete this number</button></p>
        )}
        {deleteReason !== null && (
          <form onSubmit={(e) => { e.preventDefault(); void remove(); }}>
            <h3>Delete this number</h3>
            <p className="muted small">
              The number is marked rejected and no longer used in answers. It stays in the history, and you can reopen it later.
            </p>
            <label><span>Why</span><input type="text" size={40} autoFocus value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} /></label>
            <p>
              <button type="submit" className="primary" disabled={busy}>Delete</button>{" "}
              <button type="button" disabled={busy} onClick={() => { setDeleteReason(null); setError(null); }}>Cancel</button>
            </p>
          </form>
        )}
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); void submitCorrection(true); }}>
            <h3>Correct this number</h3>
            {f.status === "verified" && (
              <p className="muted small">
                This number is verified. Saving creates a new number that replaces it; the old one stays in the history.
              </p>
            )}
            <FactFormFields form={form} onChange={setForm} concepts={concepts} accounts={accounts} institutionId={null} period={{ periodStart: null, periodEnd: null }} />
            <p>
              <button type="submit" className="primary" disabled={busy}>Save correction and verify</button>{" "}
              <button type="button" disabled={busy} onClick={() => void submitCorrection(false)}>Save without verifying</button>{" "}
              <button type="button" disabled={busy} onClick={() => { setForm(null); setError(null); }}>Cancel</button>
            </p>
          </form>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>

      <h2>Sources</h2>
      {f.sources.length === 0 ? (
        <p className="muted">No document. This is a statement made by a person; see the note above and the timeline below.</p>
      ) : (
        <ul>
          {f.sources.map((s) => (
            <li key={s.id}>
              <a href={hrefDocument(s.documentId, f.id)} dir="auto">{s.documentName}</a>
              {s.pageNo !== null && <>, page {s.pageNo}</>}
              {s.quotedText !== null && <> · text in the box: <Value>{s.quotedText.trim() || "(empty)"}</Value></>}
            </li>
          ))}
        </ul>
      )}

      <h2>Timeline</h2>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <Value>{e.at.replace("T", " ").slice(0, 16)}</Value> · {who(e)} · <strong>{eventText(e)}</strong>
            <EventDetail e={e} />
          </li>
        ))}
      </ul>

      <h2>Replacements</h2>
      {supersedes.length === 0 && supersededBy.length === 0 && <p className="muted">This number has not been corrected or replaced.</p>}
      {(supersedes.length > 0 || supersededBy.length > 0) && (
        <ol className="chain">
          {[...supersededBy].reverse().map((x) => <ChainRow key={x.id} f={x} label="Newer" />)}
          <ChainRow f={f} label="This one" current />
          {supersedes.map((x) => <ChainRow key={x.id} f={x} label="Older" />)}
        </ol>
      )}
    </section>
  );
}

function ChainRow({ f, label, current = false }: { f: FactDto; label: string; current?: boolean }) {
  return (
    <li className={current ? "current" : undefined}>
      <span className="muted">{label}:</span> {current ? <>#{f.id}</> : <a href={hrefFact(f.id)}>#{f.id}</a>} <FactAmount fact={f} /> <StatusBadge status={f.status} />
    </li>
  );
}

function eventText(e: FactEventDto): string {
  switch (e.event) {
    case "proposed": return "added";
    case "verified": return "verified";
    case "corrected": return "corrected";
    case "rejected": return "rejected";
    case "superseded": return "replaced by a correction";
    case "reopened": return "reopened";
  }
}

function EventDetail({ e }: { e: FactEventDto }) {
  const p = e.payload;
  if (e.event === "rejected" && typeof p["reason"] === "string" && p["reason"]) return <div className="small" dir="auto">Reason: {p["reason"]}</div>;
  if (e.event === "corrected" && Array.isArray(p["changed"])) return <div className="small muted">Changed: {(p["changed"] as unknown[]).map(String).join(", ")}</div>;
  if (e.event === "superseded" && typeof p["supersededBy"] === "number") return <div className="small">Replaced by <a href={hrefFact(p["supersededBy"])}>#{p["supersededBy"]}</a></div>;
  if (e.event === "corrected" && typeof p["supersedes"] === "number") return <div className="small">Replaces <a href={hrefFact(p["supersedes"])}>#{p["supersedes"]}</a></div>;
  return null;
}
