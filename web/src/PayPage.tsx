import { apiFetch } from "./api.ts";
import { useRefData } from "./context.tsx";
import { formatDay, formatDayShort } from "./displayDate.ts";
import { payView, type PayRow, type PayRowKind, type PayValue } from "./payView.ts";
import { InstitutionName, useLoad } from "./ui.tsx";
import type { DocumentDto, FactDto } from "@finshark/shared";
import {
  Alert,
  DataText,
  Empty,
  Heading,
  Link,
  Loading,
  Page,
  Section,
  Stack,
  StatusMark,
  Table,
  TableBody,
  TableHead,
  Td,
  Text,
  Th,
  Tr,
  Value,
} from "./ds/index.ts";

const KIND_LABEL: Record<PayRowKind, string> = { annual: "Annual (tax form)", payslip: "Payslip", period: "Period" };

function periodText(r: PayRow): string {
  if (r.periodStart && r.periodEnd) return `${formatDayShort(r.periodStart)} to ${formatDay(r.periodEnd)}`;
  if (r.periodEnd) return `to ${formatDay(r.periodEnd)}`;
  if (r.periodStart) return `from ${formatDay(r.periodStart)}`;
  return r.taxYear !== null ? `Tax year ${r.taxYear}` : "Period not set";
}

function Values({ values }: { values: PayValue[] }) {
  if (values.length === 0) return <Text tone="subtle">-</Text>;
  return (
    <Stack gap={1} align="end">
      {values.map((v) => (
        <Stack key={v.factId} gap={1} align="end">
          <Link href={v.href} tone={v.conflict ? "warning" : "default"}>
            <Value>{v.formatted}</Value>
          </Link>
          {v.conflict && <StatusMark tone="warning" icon="clock">conflict</StatusMark>}
        </Stack>
      ))}
    </Stack>
  );
}

export function PayPage() {
  const { concepts, institutions, people } = useRefData();
  // All facts, not one request per person: a pay number saved without a person must still show
  // (under "Not shown"), and payView keeps only person-level concepts.
  const loaded = useLoad(async () => {
    const [docs, facts] = await Promise.all([
      apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents),
      apiFetch<{ facts: FactDto[] }>("/api/facts").then((r) => r.facts),
    ]);
    return { docs, facts };
  }, 0);

  if (loaded.error) return <Page title="Pay"><Alert tone="danger">{loaded.error}</Alert></Page>;
  if (!loaded.data) return <Page title="Pay"><Loading /></Page>;

  const view = payView(loaded.data.facts, concepts, loaded.data.docs, institutions, people);

  return (
    <Page title="Pay" eyebrow="Wages and tax withheld, as each document states them" width="wide">
      {view.people.length === 0 && view.notShown.length === 0 && (
        <Empty>No pay numbers yet. Wages and tax withheld from payslips and W-2s appear here once they are saved from a document.</Empty>
      )}
      {view.people.map((p) => (
        <Stack key={p.personId} gap={5}>
          <Heading level={2}><DataText>{p.personName}</DataText></Heading>
          <Stack gap={6}>
            {p.years.map((y) => (
              <Stack key={y.year} gap={2}>
                <Heading level={3}>{y.year}</Heading>
                <Table aria-label={`Pay for ${p.personName} in ${y.year}`}>
                  <TableHead>
                    <Tr>
                      <Th>Employer</Th>
                      <Th>Period</Th>
                      <Th align="end">Wages</Th>
                      <Th align="end">Tax withheld</Th>
                    </Tr>
                  </TableHead>
                  <TableBody>
                    {y.employers.flatMap((e) =>
                      e.rows.map((r) => (
                        <Tr key={r.key}>
                          <Td>{e.employer ? (
                              <InstitutionName inst={e.employer} />
                            ) : e.unclear.length > 0 ? (
                              <Text tone="muted">Employer unclear: <DataText>{e.unclear.map((i) => i.name).join(" / ")}</DataText></Text>
                            ) : (
                              <Text tone="muted">Employer not set</Text>
                            )}</Td>
                          <Td>
                            <Stack gap={1}>
                              <Value>{periodText(r)}</Value>
                              <Text size="xs" tone="muted">{KIND_LABEL[r.kind]}</Text>
                            </Stack>
                          </Td>
                          <Td align="end"><Values values={r.wages} /></Td>
                          <Td align="end"><Values values={r.withheld} /></Td>
                        </Tr>
                      )),
                    )}
                  </TableBody>
                </Table>
              </Stack>
            ))}
          </Stack>
        </Stack>
      ))}
      {view.notShown.length > 0 && (
        <Section title="Not shown">
          <Table aria-label="Pay numbers that cannot be placed in the tables above">
            <TableHead>
              <Tr>
                <Th>Number</Th>
                <Th>Person</Th>
                <Th>Value</Th>
                <Th>Why</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {view.notShown.map((n) => (
                <Tr key={n.factId}>
                  <Td><Link href={n.href}>{n.conceptLabel}</Link></Td>
                  <Td>{n.personName ? <DataText>{n.personName}</DataText> : <Text tone="muted">-</Text>}</Td>
                  <Td><Value>{n.formatted}</Value></Td>
                  <Td>{n.reason}</Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </Page>
  );
}
