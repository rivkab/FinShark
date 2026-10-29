import { useState } from "react";
import type { FbarReportDto, FbarRowDto, FbarTestVerdict } from "@finshark/shared";
import { apiFetch } from "./api.ts";
import { formatDay } from "./displayDate.ts";
import { hrefAccount, hrefFact, hrefFbar } from "./route.ts";
import { useLoad } from "./ui.tsx";
import {
  Alert,
  DataText,
  Disclosure,
  Empty,
  Field,
  FieldRow,
  Link,
  List,
  ListItem,
  Loading,
  Page,
  Section,
  Select,
  Stack,
  Stat,
  StatGroup,
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

const TEST_LABEL: Record<FbarTestVerdict, string> = {
  EXCEEDED: "over $10,000",
  NOT_EXCEEDED: "not over $10,000",
  UNDETERMINED: "can't tell yet",
};

export function FbarPage({ year }: { year: number | null }) {
  const report = useLoad(() => apiFetch<FbarReportDto>(`/api/fbar${year ? `?year=${year}` : ""}`), year);
  const [how, setHow] = useState(false);
  const r = report.data;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => thisYear - i);
  const shown = r?.year ?? year ?? thisYear - 1;
  if (!years.includes(shown)) years.push(shown);

  return (
    <Page eyebrow="Report" title="FBAR: foreign accounts">
      <FieldRow align="end">
        <Field label="Calendar year">
          <Select value={String(shown)} onChange={(v) => { window.location.hash = hrefFbar(Number(v)).slice(1); }} options={years.sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }))} />
        </Field>
      </FieldRow>
      <Alert tone="danger">{report.error}</Alert>
      {report.loading && !r && <Loading />}
      {r && (
        <Stack gap={5}>
          <VerdictBanner r={r} />
          <StatGroup>
            <Stat label="Highest balances added up" value={<Value>{r.knownAggregate.formatted}</Value>} note={r.status === "COMPLETE" ? "all accounts complete" : "so far, a minimum"} tone={r.status === "COMPLETE" ? "default" : "warning"} />
            <Stat label="Filing threshold" value={<Value>{r.threshold.formatted}</Value>} note="must be exceeded" />
          </StatGroup>

          <Disclosure summary="How the $10,000 test is applied" open={how} onToggle={setHow}>
            <Stack gap={2}>
              <Text as="p">
                The sources word the threshold two ways, so both are tested. <Text weight="semibold">Highest balances added up:</Text> each
                account's own highest balance of the year, added together, even if they fell on different dates: {TEST_LABEL[r.tests.sumOfMaxima]}.{" "}
                <Text weight="semibold">One date:</Text> the accounts' combined balance on a single date: {TEST_LABEL[r.tests.singleDate.verdict]}
                {r.tests.singleDate.exceededOn ? ` (on ${formatDay(r.tests.singleDate.exceededOn)})` : ""}.
              </Text>
              <Text as="p" tone="muted">
                Highest balance means the highest of the verified statement balances in the year, so it can understate a peak between
                statements. Every amount is converted at the Treasury rate for 31 December. A balance is never carried over from another date.
              </Text>
            </Stack>
          </Disclosure>

          <Section title="Accounts">
            {r.rows.length === 0 ? <Empty>No foreign accounts were open in {r.year}.</Empty> : <RowsTable rows={r.rows} />}
          </Section>

          {r.tests.singleDate.dates.length > 0 && (
            <Section title="Combined balance by date">
              <Table aria-label="Combined balance by date">
                <TableHead>
                  <Tr>
                    <Th>Date</Th>
                    <Th align="end">Combined (USD)</Th>
                    <Th>Accounts with no balance that day</Th>
                  </Tr>
                </TableHead>
                <TableBody>
                  {r.tests.singleDate.dates.map((d) => (
                    <Tr key={d.date}>
                      <Td><Value>{formatDay(d.date)}</Value></Td>
                      <Td align="end"><Value>{d.usd.formatted}</Value></Td>
                      <Td>
                        {d.missingAccountIds.length === 0 ? (
                          <Text tone="muted">none</Text>
                        ) : (
                          <Stack gap={1}>
                            {d.missingAccountIds.map((id) => <AccountLink key={id} id={id} rows={r.rows} />)}
                          </Stack>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
            </Section>
          )}

          {r.notInScope.length > 0 && (
            <Section title="Not open in this year">
              <List>
                {r.notInScope.map((a) => (
                  <ListItem key={a.accountId}>
                    <Link href={hrefAccount(a.accountId)}><DataText>{a.displayName}</DataText></Link>{" "}
                    <Text tone="muted">{a.reason === "opened_after_year" ? `opened after ${r.year}` : `closed before ${r.year}`}</Text>
                  </ListItem>
                ))}
              </List>
            </Section>
          )}
        </Stack>
      )}
    </Page>
  );
}

function AccountLink({ id, rows }: { id: number; rows: FbarRowDto[] }) {
  const row = rows.find((x) => x.accountId === id);
  return <Link href={hrefAccount(id)}><DataText>{row?.displayName ?? `Account ${id}`}</DataText></Link>;
}

function VerdictBanner({ r }: { r: FbarReportDto }) {
  const total = r.knownAggregate.formatted;
  switch (r.verdict) {
    case "REQUIRED":
      return (
        <Alert tone="warning">
          An FBAR is required for {r.year}. The accounts together held more than {r.threshold.formatted} on {formatDay(r.tests.singleDate.exceededOn ?? "")}.
          {r.status !== "COMPLETE" ? " Some data is still missing, which can only raise the figures." : ""}
        </Alert>
      );
    case "NOT_REQUIRED":
      return <Alert tone="success">No FBAR is needed for {r.year}: even adding each account's highest balance gives {total}, not over {r.threshold.formatted}.</Alert>;
    case "DEPENDS_ON_RULE":
      return (
        <Alert tone="warning">
          This depends on how the threshold is read. The accounts' highest balances add up to {total}, over {r.threshold.formatted}, but no single date is shown to
          exceed it. Check the FBAR instructions or ask your preparer. Filing is the safe choice.
        </Alert>
      );
    case "UNDETERMINED":
      return <Alert tone="warning">Can't tell yet: balances are missing or disputed. Known so far: {total}. See the accounts below.</Alert>;
    case "NO_FOREIGN_ACCOUNTS":
      return <Alert tone="info">There are no foreign accounts. An account counts as foreign when its country isn't the US.</Alert>;
  }
}

function RowsTable({ rows }: { rows: FbarRowDto[] }) {
  return (
    <Table aria-label="Foreign accounts">
      <TableHead>
        <Tr>
          <Th>Account</Th>
          <Th align="end">Highest balance</Th>
          <Th align="end">In USD</Th>
          <Th>Rate</Th>
          <Th>Problems</Th>
        </Tr>
      </TableHead>
      <TableBody>
        {rows.map((x) => (
          <Tr key={x.accountId}>
            <Td><Link href={hrefAccount(x.accountId)}><DataText>{x.displayName}</DataText></Link></Td>
            <Td align="end">
              {x.max ? (
                <Stack gap={1}>
                  <Value>{x.max.amount.formatted}</Value>
                  <Text tone="muted" size="sm">
                    {formatDay(x.max.date)}{" "}
                    {x.max.factIds.map((id) => <Link key={id} href={hrefFact(id)}>#{id}</Link>)}
                  </Text>
                </Stack>
              ) : (
                <Text tone="muted">none recorded</Text>
              )}
            </Td>
            <Td align="end">{x.usd ? <Value>{x.usd.formatted}</Value> : <Text tone="muted">not converted</Text>}</Td>
            <Td><RateCell x={x} /></Td>
            <Td><Problems x={x} /></Td>
          </Tr>
        ))}
      </TableBody>
    </Table>
  );
}

function RateCell({ x }: { x: FbarRowDto }) {
  if (x.conversion === null) return <Text tone="muted">n/a</Text>;
  if (x.conversion.kind === "none") return <Text tone="muted">already USD</Text>;
  if (x.conversion.kind === "missing_rate") return <StatusMark tone="danger" icon="cross">no {x.conversion.currency} rate</StatusMark>;
  return <Value>{x.conversion.rate} on {formatDay(x.conversion.rateDate)}</Value>;
}

function Problems({ x }: { x: FbarRowDto }) {
  const none = x.status === "COMPLETE";
  return (
    <Stack gap={1}>
      {none && <StatusMark tone="success" icon="check">complete</StatusMark>}
      {x.conflicts.map((c) => (
        <StatusMark key={c.date} tone="danger" icon="cross">
          {formatDay(c.date)}: {c.values.map((v) => v.amount.formatted).join(" or ")}
        </StatusMark>
      ))}
      {x.missing.length > 0 && <StatusMark tone="warning" icon="dash">no balance for {x.missing.map(formatDay).join(", ")}</StatusMark>}
      {!x.coverageKnown && <StatusMark tone="warning" icon="dash">set a statement cadence to check coverage</StatusMark>}
      {x.max === null && x.coverageKnown && x.missing.length === 0 && <StatusMark tone="warning" icon="dash">no balance recorded</StatusMark>}
      {x.excluded.length > 0 && (
        <StatusMark tone="muted" icon="clock">
          {x.excluded.length} not used ({[...new Set(x.excluded.map((e) => REASON[e.reason]))].join(", ")})
        </StatusMark>
      )}
    </Stack>
  );
}

const REASON = { unverified: "unverified", other_currency: "other currency", no_amount: "no amount" } as const;
