import { useRef, useState, type DragEvent } from "react";
import type { DocumentDto } from "@finshark/shared";
import { apiFetch, errorText, uploadPdf } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { hrefDocument, hrefDocuments } from "./route.ts";
import { describeUpload, periodLabel, type UploadOutcome } from "./suggest.ts";
import { ErrorNote, useLoad, AccountName } from "./ui.tsx";
import { Cell, Text, Value } from "./Value.tsx";
import { pickLabel } from "./labels.ts";

interface FileResult {
  name: string;
  state: "uploading" | "done" | "error";
  outcome?: UploadOutcome;
  error?: string;
}

export function DocumentsPage({ accountId }: { accountId: number | null }) {
  const { mutate } = useActor();
  const { accounts } = useRefData();
  const docs = useLoad(() => apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents), 0);
  const shown = (docs.data ?? []).filter((d) => accountId === null || d.accountIds.includes(accountId));
  const account = accountId === null ? undefined : accounts.find((a) => a.id === accountId);
  const [results, setResults] = useState<FileResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setResults(files.map((f) => ({ name: f.name, state: "uploading" })));
    for (const [i, file] of files.entries()) {
      const patch = (r: Partial<FileResult>) => setResults((all) => all.map((x, j) => (j === i ? { ...x, ...r } : x)));
      try {
        const res = await mutate(() => uploadPdf(file));
        patch({ state: "done", outcome: describeUpload(res) });
      } catch (e) {
        patch({ state: "error", error: errorText(e) });
      }
    }
    await docs.reload();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void upload([...e.dataTransfer.files]);
  };

  return (
    <section>
      <h1>Documents</h1>
      <div
        className={`dropzone${dragging ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>Drag PDF files here, or</p>
        <button onClick={() => input.current?.click()}>Choose PDF files...</button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i} className={r.state}>
              <Text>{r.name}</Text>: <UploadStatus r={r} />
            </li>
          ))}
        </ul>
      )}

      <h2>{account ? <>Documents for <AccountName account={account} /></> : accountId ? "Documents for an unknown account" : "All documents"}</h2>
      <div className="filters">
        <label>
          <span>Account</span>
          <select value={accountId ?? ""} onChange={(e) => { window.location.hash = hrefDocuments(Number(e.target.value) || null).slice(1); }}>
            <option value="">Any</option>
            {accounts.map((a) => <option key={a.id} value={a.id} dir="auto">{a.displayName}</option>)}
          </select>
        </label>
        {accountId !== null && <a href={hrefDocuments()}>Show all documents</a>}
      </div>
      <ErrorNote>{docs.error}</ErrorNote>
      {docs.data && docs.data.length === 0 && <p>No documents yet. Add a PDF above to get started.</p>}
      {docs.data && docs.data.length > 0 && shown.length === 0 && <p>No documents are linked to this account yet.</p>}
      {shown.length > 0 && <DocumentTable docs={shown} />}
    </section>
  );
}

function UploadStatus({ r }: { r: FileResult }) {
  if (r.state === "uploading") return <>uploading...</>;
  if (r.state === "error") return <span className="error">failed. {r.error}</span>;
  const o = r.outcome!;
  return (
    <>
      <span className={o.kind === "imported" ? "ok" : "warn"}>{o.text}</span>
      {o.related.map((id) => (
        <a key={id} href={hrefDocument(id)}> #{id}</a>
      ))}
      {o.kind !== "duplicate" && o.documentId !== null && (
        <>
          {" "}
          <a href={hrefDocument(o.documentId)}>Open it</a>
        </>
      )}
    </>
  );
}

function DocumentTable({ docs }: { docs: DocumentDto[] }) {
  const { institutions, accounts, docTypes } = useRefData();
  return (
    <table className="data">
      <thead>
        <tr><th>File</th><th>Institution</th><th>Type</th><th>Period</th><th>Accounts</th><th className="num">Numbers</th><th>Status</th></tr>
      </thead>
      <tbody>
        {docs.map((d) => {
          const inst = institutions.find((i) => i.id === d.institutionId);
          const type = docTypes.find((t) => t.id === d.docType);
          return (
            <tr key={d.id}>
              <Cell><a href={hrefDocument(d.id)}>{d.originalFilename}</a></Cell>
              <Cell>{inst ? <Text>{inst.name}</Text> : <span className="muted">not set</span>}</Cell>
              <td>{type ? pickLabel(type.labelEn, type.labelHe, d.language) : <span className="muted">not set</span>}</td>
              <td><Value>{periodLabel(d)}</Value></td>
              <Cell>
                {d.accountIds.map((id) => {
                  const a = accounts.find((x) => x.id === id);
                  return a ? <div key={id}><AccountName account={a} /></div> : null;
                })}
              </Cell>
              <td className="num">{d.factCount}</td>
              <td><span className={`badge doc-${d.status}`}>{d.status === "inbox" ? "needs review" : d.status}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
