import { useState } from "react";
import type { DocumentDto } from "@finshark/shared";
import { apiFetch, errorText, uploadPdf } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { hrefDocument, hrefDocuments } from "./route.ts";
import { describeUpload, periodLabel, type UploadOutcome } from "./suggest.ts";
import { useLoad, AccountName, DocStatusBadge } from "./ui.tsx";
import { Alert, DataText, Dropzone, Empty, Field, FieldRow, Link, List, ListItem, Page, Select, Stack, StatusMark, Table, TableBody, TableHead, Td, Text, Th, Tr, Value } from "./ds/index.ts";
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

  return (
    <Page eyebrow={account ? <>Archive · <AccountName account={account} /></> : "Archive"} title="Documents">
      <Dropzone onFiles={(files) => void upload(files)} accept="application/pdf,.pdf" multiple prompt="Drag PDF files here, or" buttonLabel="Choose PDF files…" />

      {results.length > 0 && (
        <List>
          {results.map((r, i) => (
            <ListItem key={i}>
              <DataText>{r.name}</DataText>: <UploadStatus r={r} />
            </ListItem>
          ))}
        </List>
      )}

      <Stack gap={3}>
        <FieldRow align="end">
          <Field label="Account">
            <Select
              value={accountId === null ? "" : String(accountId)}
              onChange={(v) => { window.location.hash = hrefDocuments(Number(v) || null).slice(1); }}
              placeholder="Any"
              options={accounts.map((a) => ({ value: String(a.id), label: a.displayName, dir: "auto" }))}
            />
          </Field>
          {accountId !== null && <Link href={hrefDocuments()}>Show all documents</Link>}
        </FieldRow>
        {accountId !== null && !account && <Text tone="muted">Documents for an unknown account</Text>}
        <Alert tone="danger">{docs.error}</Alert>
        {docs.data && docs.data.length === 0 && <Empty>No documents yet. Add a PDF above to get started.</Empty>}
        {docs.data && docs.data.length > 0 && shown.length === 0 && <Empty>No documents are linked to this account yet.</Empty>}
        {shown.length > 0 && <DocumentTable docs={shown} />}
      </Stack>
    </Page>
  );
}

function UploadStatus({ r }: { r: FileResult }) {
  if (r.state === "uploading") return <StatusMark tone="muted" icon="clock">uploading…</StatusMark>;
  if (r.state === "error") return <StatusMark tone="danger" icon="cross">failed. {r.error}</StatusMark>;
  const o = r.outcome!;
  return (
    <>
      {o.kind === "imported" ? <StatusMark tone="success" icon="check">{o.text}</StatusMark> : <StatusMark tone="warning" icon="dash">{o.text}</StatusMark>}
      {o.related.map((id) => (
        <Text key={id}> <Link href={hrefDocument(id)}>#{id}</Link></Text>
      ))}
      {o.kind !== "duplicate" && o.documentId !== null && (
        <>
          {" "}
          <Link href={hrefDocument(o.documentId)}>Open it</Link>
        </>
      )}
    </>
  );
}

function DocumentTable({ docs }: { docs: DocumentDto[] }) {
  const { institutions, accounts, docTypes } = useRefData();
  return (
    <Table aria-label="Documents">
      <TableHead>
        <Tr>
          <Th>File</Th>
          <Th>Institution</Th>
          <Th>Type</Th>
          <Th>Period</Th>
          <Th>Accounts</Th>
          <Th align="end">Numbers</Th>
          <Th>Status</Th>
        </Tr>
      </TableHead>
      <TableBody>
        {docs.map((d) => {
          const inst = institutions.find((i) => i.id === d.institutionId);
          const type = docTypes.find((t) => t.id === d.docType);
          return (
            <Tr key={d.id}>
              <Td><Link href={hrefDocument(d.id)}><DataText>{d.originalFilename}</DataText></Link></Td>
              <Td>{inst ? <DataText>{inst.name}</DataText> : <Text tone="muted">not set</Text>}</Td>
              <Td>{type ? <DataText>{pickLabel(type.labelEn, type.labelHe, d.language)}</DataText> : <Text tone="muted">not set</Text>}</Td>
              <Td><Value>{periodLabel(d)}</Value></Td>
              <Td>
                <Stack gap={1}>
                  {d.accountIds.map((id) => {
                    const a = accounts.find((x) => x.id === id);
                    return a ? <AccountName key={id} account={a} /> : null;
                  })}
                </Stack>
              </Td>
              <Td align="end"><Value>{d.factCount}</Value></Td>
              <Td><DocStatusBadge status={d.status} /></Td>
            </Tr>
          );
        })}
      </TableBody>
    </Table>
  );
}
