import { useState } from "react";
import type { ExchangeRateDto, ImportRatesResponse } from "@finshark/shared";
import { apiFetch, errorText, uploadRatesCsv } from "./api.ts";
import { useActor } from "./context.tsx";
import { formatDay } from "./displayDate.ts";
import { useLoad } from "./ui.tsx";
import { Alert, Dropzone, Empty, Field, List, ListItem, Page, Section, Stack, Table, TableBody, TableHead, Td, Text, TextInput, Th, Tr, Value } from "./ds/index.ts";

const SOURCE_LABEL: Record<string, string> = { us_treasury_reporting: "US Treasury reporting rate" };

export function RatesPage() {
  const { mutate } = useActor();
  const rates = useLoad(() => apiFetch<{ rates: ExchangeRateDto[] }>("/api/exchange-rates").then((r) => r.rates), 0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; r: ImportRatesResponse } | null>(null);

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult({ name: file.name, r: await mutate(() => uploadRatesCsv(file, note)) });
      await rates.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page eyebrow="Reference" title="Exchange rates">
      <Text as="p">
        FinShark never looks rates up online. Download the Reporting Rates of Exchange CSV from the US Treasury (Fiscal Data) and add it
        here. Only Israel-Shekel rows are kept for now. Rates already stored are never overwritten.
      </Text>
      <Section title="Add Treasury rates">
        <Stack gap={3}>
          <Field label="Note (optional)" hint="Where the file came from, e.g. the download date.">
            <TextInput value={note} onChange={setNote} />
          </Field>
          <Dropzone onFiles={(files) => void upload(files)} accept="text/csv,.csv" prompt="Drag the Treasury CSV here, or" buttonLabel="Choose CSV file…" />
          {busy && <Text tone="muted">Importing…</Text>}
          <Alert tone="danger">{error}</Alert>
          {result && <ImportSummary name={result.name} r={result.r} />}
        </Stack>
      </Section>
      <Section title="Stored rates">
        <Stack gap={3}>
          <Alert tone="danger">{rates.error}</Alert>
          {rates.data && rates.data.length === 0 && <Empty>No rates yet. Add the Treasury CSV above.</Empty>}
          {rates.data && rates.data.length > 0 && (
            <Table aria-label="Exchange rates">
              <TableHead>
                <Tr>
                  <Th>Source</Th>
                  <Th>As of</Th>
                  <Th>Currency</Th>
                  <Th align="end">Rate</Th>
                  <Th>Note</Th>
                </Tr>
              </TableHead>
              <TableBody>
                {rates.data.map((r) => (
                  <Tr key={r.id}>
                    <Td>{SOURCE_LABEL[r.sourceId] ?? r.sourceId}</Td>
                    <Td><Value>{formatDay(r.rateDate)}</Value></Td>
                    <Td><Value>1 {r.base} = {r.quote}</Value></Td>
                    <Td align="end"><Value>{r.rate}</Value></Td>
                    <Td>{r.note ?? <Text tone="muted">none</Text>}</Td>
                  </Tr>
                ))}
              </TableBody>
            </Table>
          )}
        </Stack>
      </Section>
    </Page>
  );
}

function ImportSummary({ name, r }: { name: string; r: ImportRatesResponse }) {
  const nothing = r.added === 0 && r.unchanged === 0 && r.conflicts.length === 0;
  return (
    <Stack gap={2}>
      <Alert tone={r.conflicts.length > 0 || nothing ? "warning" : "success"}>
        {name}: {r.added} added, {r.unchanged} already stored
        {r.conflicts.length > 0 ? `, ${r.conflicts.length} differ from what is stored` : ""}
        {r.skippedCurrencies > 0 ? `, ${r.skippedCurrencies} rows for other currencies skipped` : ""}.
        {nothing ? " No Israel-Shekel rates were found in this file." : ""}
      </Alert>
      {r.conflicts.length > 0 && (
        <>
          <Text as="p">These dates already have a different rate. The stored rate was kept. Check which one is right.</Text>
          <List>
            {r.conflicts.map((c) => (
              <ListItem key={`${c.quote}-${c.rateDate}`}>
                <Value>{formatDay(c.rateDate)}</Value>: stored <Value>{c.stored}</Value>, file says <Value>{c.incoming}</Value>
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Stack>
  );
}
