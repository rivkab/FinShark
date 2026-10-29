import { useMemo } from "react";
import { apiFetch, errorText } from "./api.ts";
import { balanceRows, compactAmount, pointDetail, pointHref } from "./accountChart.ts";
import { balanceSeries } from "./balanceSeries.ts";
import { useRefData } from "./context.tsx";
import { formatDay, formatDayShort } from "./displayDate.ts";
import { ACCOUNT_TYPE_LABEL } from "./labels.ts";
import { latestBalances } from "./latestBalance.ts";
import { otherNumbers } from "./otherNumbers.ts";
import { hrefFact, hrefDocuments } from "./route.ts";
import { AccountName, FactConcept, InstitutionName, useLoad } from "./ui.tsx";
import type { FactDto } from "@finshark/shared";
import {
  Alert,
  DataText,
  Empty,
  Inline,
  Link,
  Loading,
  Page,
  Section,
  Stack,
  Stat,
  StatusMark,
  Table,
  TableBody,
  TableHead,
  Td,
  Text,
  Th,
  TimeSeriesChart,
  Tr,
  Value,
} from "./ds/index.ts";

export function AccountPage({ id }: { id: number }) {
  const { accounts, concepts, institutions } = useRefData();
  const account = accounts.find((a) => a.id === id);
  const facts = useLoad(() => apiFetch<{ facts: FactDto[] }>(`/api/facts?account=${id}`).then((r) => r.facts), id);

  const series = useMemo(
    () => (account && facts.data ? balanceSeries(account, facts.data, concepts) : null),
    [account, facts.data, concepts],
  );
  const latest = useMemo(() => (facts.data ? (latestBalances(facts.data, concepts).get(id) ?? null) : undefined), [facts.data, concepts, id]);

  const others = useMemo(() => (facts.data ? otherNumbers(id, facts.data, concepts) : []), [facts.data, concepts, id]);

  if (!account) {
    return (
      <Page title="Account not found" back={{ href: "#/accounts", label: "Accounts" }}>
        <Empty>There is no account with this number.</Empty>
      </Page>
    );
  }

  const institution = institutions.find((i) => i.id === account.institutionId);
  const eyebrow = (
    <>
      {account.accountType ? ACCOUNT_TYPE_LABEL[account.accountType] : "Account"} ·{" "}
      {institution ? <InstitutionName inst={institution} /> : <DataText>{account.institutionName}</DataText>}
    </>
  );

  const chartPoints = series?.points.map((p) => ({
    key: `${p.date}|${p.minor}`,
    date: p.date,
    minor: p.minor,
    label: p.formatted,
    detail: pointDetail(p),
    tone: p.conflict ? ("warning" as const) : ("default" as const),
    href: pointHref(p),
  }));
  const rows = series ? balanceRows(series.points) : [];

  return (
    <Page
      back={{ href: "#/accounts", label: "Accounts" }}
      eyebrow={eyebrow}
      title={<AccountName account={account} />}
      actions={
        latest === undefined ? null : latest === null ? (
          <Text tone="muted">No balance yet</Text>
        ) : (
          <Stat
            label="Latest value"
            value={<Value size="lg">{latest.formatted}</Value>}
            note={
              latest.status === "verified" ? (
                latest.instantDate ? formatDay(latest.instantDate) : undefined
              ) : (
                <StatusMark tone="warning" icon="clock">conflict · {latest.instantDate ? formatDayShort(latest.instantDate) : ""}</StatusMark>
              )
            }
            tone={latest.status === "verified" ? "default" : "warning"}
            href={hrefFact(latest.id)}
          />
        )
      }
    >
      <Section title="Balance over time">
        <Stack gap={3}>
          <Alert tone="danger">{facts.error ? errorText(facts.error) : null}</Alert>
          {facts.loading && <Loading />}
          {series && chartPoints && chartPoints.length > 0 && (
            <TimeSeriesChart
              aria-label={`Balance of this account over time, in ${series.currency}`}
              points={chartPoints}
              segments={series.segments}
              gaps={series.gaps}
              formatTick={(m) => compactAmount(m, series.currency)}
              start={series.start}
              end={series.end}
              endMarker={series.closed}
            />
          )}
          {series && chartPoints && chartPoints.length === 0 && <Empty>No balances recorded for this account yet.</Empty>}
          {series && series.notPlotted.length > 0 && (
            <Alert tone="warning">
              <Stack gap={1}>
                <Text weight="semibold">
                  Not plotted: {series.notPlotted.length} {series.notPlotted.length === 1 ? "value" : "values"} not in {series.currency} or without an exact amount.
                </Text>
                {series.notPlotted.map((f) => (
                  <Text key={f.id} as="div" size="sm">
                    <Link href={hrefFact(f.id)}>
                      <Value>{f.formatted}</Value> · {f.instantDate ? formatDay(f.instantDate) : ""}
                    </Link>
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}
        </Stack>
      </Section>

      {rows.length > 0 && (
        <Section title="Balances">
          <Table aria-label="Balances of this account, newest first">
            <TableHead>
              <Tr>
                <Th>Date</Th>
                <Th align="end">Value</Th>
                <Th>Source</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <Tr key={r.key}>
                  <Td><Value>{formatDay(r.date)}</Value></Td>
                  <Td align="end">
                    <Stack gap={1} align="end">
                      <Value>{r.formatted}</Value>
                      {r.conflict && <StatusMark tone="warning" icon="clock">conflict</StatusMark>}
                    </Stack>
                  </Td>
                  <Td>
                    <Stack gap={1}>
                      {r.sources.map((s) => (
                        <Text key={`${s.factId}|${s.documentId}|${s.pageNo}`} as="div" size="sm">
                          <Link href={s.href}>
                            {s.documentName === null ? "attested" : <DataText>{s.documentName}</DataText>}
                          </Link>
                          {s.pageNo !== null && <Text tone="muted"> · page {s.pageNo}</Text>}
                        </Text>
                      ))}
                    </Stack>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {others.length > 0 && (
        <Section title="Other numbers">
          <Table aria-label="Other numbers of this account, newest first">
            <TableHead>
              <Tr>
                <Th>Kind of number</Th>
                <Th>Period</Th>
                <Th align="end">Value</Th>
                <Th>Source</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {others.map((r) => (
                <Tr key={r.fact.id}>
                  <Td><FactConcept fact={r.fact} /></Td>
                  <Td><Value>{r.period}</Value></Td>
                  <Td align="end">
                    <Stack gap={1} align="end">
                      <Value>{r.fact.formatted}</Value>
                      {r.conflict && <StatusMark tone="warning" icon="clock">conflict</StatusMark>}
                    </Stack>
                  </Td>
                  <Td>
                    <Stack gap={1}>
                      {r.sources.map((s) => (
                        <Text key={`${s.factId}|${s.documentId}|${s.pageNo}`} as="div" size="sm">
                          <Link href={s.href}>
                            {s.documentName === null ? "attested" : <DataText>{s.documentName}</DataText>}
                          </Link>
                          {s.pageNo !== null && <Text tone="muted"> · page {s.pageNo}</Text>}
                        </Text>
                      ))}
                    </Stack>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      <Section title="More">
        <Stack gap={2}>
          <Inline gap={4}>
            <Link href={hrefDocuments(id)}>Documents for this account</Link>
          </Inline>
          {account.notes && <Text as="div" tone="muted"><DataText block>{account.notes}</DataText></Text>}
        </Stack>
      </Section>
    </Page>
  );
}
