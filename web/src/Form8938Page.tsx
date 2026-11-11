import { Fragment, useState, type ReactNode } from "react";
import type { FilingStatus, Form8938ReportDto, Form8938RowDto, Form8938ValueDto, FbarTestVerdict, Us8938TermId } from "@finshark/shared";
import { FILING_STATUSES, US_8938_TERM_IDS } from "@finshark/shared";
import { api } from "./api.ts";
import { formatDay } from "./displayDate.ts";
import { hrefAccount, hrefFact, hrefForm8938 } from "./route.ts";
import { useAction, useLoad } from "./ui.tsx";
import {
  appliedText, choiceToResidence, classificationBody, classificationProblem, excludedSummary, FILING_STATUS_LABEL, groupRows,
  maximumNotes, needsClassifying, needsReason, ownersHint, reasonViews, RESIDENCE_LABEL, residenceToChoice, taxGroupView,
  TERM_LABEL, termForTreatment, TEST_LABEL, TREATMENT_LABEL, valueNote, verdictView, type ResidenceChoice,
} from "./form8938View.ts";
import {
  Alert, Button, DataText, Disclosure, Empty, Field, FieldRow, KeyValues, Link, List, ListItem, Loading, Page, Section, Select,
  Stack, Stat, StatGroup, StatusMark, Table, TableBody, TableHead, Td, Text, TextInput, Th, Tr, Value,
} from "./ds/index.ts";

export function Form8938Page({ year }: { year: number | null }) {
  const report = useLoad(() => api.form8938.report(year), year);
  const r = report.data;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => thisYear - i);
  const shown = r?.year ?? year ?? thisYear - 1;
  if (!years.includes(shown)) years.push(shown);

  return (
    <Page eyebrow="Report" title="Form 8938: foreign financial assets">
      <FieldRow align="end">
        <Field label="Tax year">
          <Select value={String(shown)} onChange={(v) => { window.location.hash = hrefForm8938(Number(v)).slice(1); }} options={years.sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }))} />
        </Field>
      </FieldRow>
      <Alert tone="danger">{report.error}</Alert>
      {report.loading && !r && <Loading />}
      {r && (
        <Stack gap={5}>
          <Settings key={`${r.year}-${r.filingStatus}-${r.abroad}`} r={r} onSaved={report.reload} />
          <Verdict r={r} />
          <Tests r={r} />
          <Section title="Accounts">
            <AccountsSection r={r} onChanged={report.reload} />
          </Section>
          <PartV r={r} />
          <PartIII r={r} />
          <Others r={r} />
          <Alert tone="info">
            Part IV (Forms 3520, 5471, 8621 and 8865) must be checked by your preparer. FinShark does not track it. Foreign mutual funds, such as
            Israeli ones, are often passive foreign investment companies (PFICs), which need Form 8621, and FinShark does not identify them.
          </Alert>
        </Stack>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- settings

function Settings({ r, onSaved }: { r: Form8938ReportDto; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState<string>(r.filingStatus ?? "");
  const [res, setRes] = useState<ResidenceChoice>(residenceToChoice(r.abroad));
  const { run, busy, error } = useAction(async () => {
    await api.taxYears.set(r.year, { filingStatus: status === "" ? null : (status as FilingStatus), abroad8938: choiceToResidence(res) });
    await onSaved();
  });
  const dirty = status !== (r.filingStatus ?? "") || res !== residenceToChoice(r.abroad);
  return (
    <Section title={`Tax year ${r.year}`}>
      <Stack gap={3}>
        <FieldRow align="end">
          <Field label="Filing status" hint="Only married filing jointly is supported.">
            <Select
              value={status}
              onChange={setStatus}
              placeholder="Not set"
              options={FILING_STATUSES.map((s) => ({ value: s, label: s === "married_joint" ? FILING_STATUS_LABEL[s] : `${FILING_STATUS_LABEL[s]} (not supported)` }))}
            />
          </Field>
          <Field label="Residence" hint="You tell FinShark the answer; it does not count days.">
            <Select value={res} onChange={(v) => setRes(v as ResidenceChoice)} options={(["us", "abroad", "unset"] as const).map((k) => ({ value: k, label: RESIDENCE_LABEL[k] }))} />
          </Field>
          <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => void run()}>Save</Button>
        </FieldRow>
        <Text as="p" tone="muted" size="sm">
          "Living abroad" means a bona fide resident of a foreign country for a whole tax year, or present abroad for 330 full days in 12 consecutive months.
          The thresholds are higher then. If residence is not set, both are tested.
        </Text>
        <Alert tone="danger">{error}</Alert>
      </Stack>
    </Section>
  );
}

// ---------------------------------------------------------------- verdict

function AccountLinks({ ids, r }: { ids: number[]; r: Form8938ReportDto }) {
  const names = new Map<number, string>();
  for (const x of r.rows) names.set(x.accountId, x.displayName);
  for (const x of r.notReportable) names.set(x.accountId, x.displayName);
  return (
    <>
      {ids.map((id) => (
        <Fragment key={id}>
          {" "}
          <Link href={hrefAccount(id)}><DataText>{names.get(id) ?? `Account ${id}`}</DataText></Link>
        </Fragment>
      ))}
    </>
  );
}

function Verdict({ r }: { r: Form8938ReportDto }) {
  const v = verdictView(r);
  const reasons = reasonViews(r);
  return (
    <Stack gap={3}>
      <Alert tone={v.tone}>
        <Text weight="semibold">{v.headline}</Text> {v.detail}
      </Alert>
      {reasons.length > 0 && (
        <List>
          {reasons.map((x, i) => (
            <ListItem key={i}>
              {x.text}
              <AccountLinks ids={x.accountIds} r={r} />
            </ListItem>
          ))}
        </List>
      )}
      <Text as="p" tone="muted" size="sm">{appliedText(r)}</Text>
    </Stack>
  );
}

// ---------------------------------------------------------------- tests

const testText = (v: FbarTestVerdict, threshold: string) => `${TEST_LABEL[v]} ${threshold}`;

function Tests({ r }: { r: Form8938ReportDto }) {
  const [how, setHow] = useState(false);
  const scenarios = r.applied === "both" ? ([["us", "Living in the US"], ["abroad", "Living abroad"]] as const) : r.applied === "us" ? ([["us", "Living in the US"]] as const) : ([["abroad", "Living abroad"]] as const);
  const t = r.totals;
  const singleText = (p: { verdict: FbarTestVerdict; exceededOn: string | null }, th: string) => `${testText(p.verdict, th)}${p.exceededOn ? ` (on ${formatDay(p.exceededOn)})` : ""}`;
  return (
    <Section title="Threshold tests">
      <Stack gap={3}>
        <Table aria-label="Threshold tests">
          <TableHead>
            <Tr>
              <Th>Test</Th>
              <Th align="end">Counted accounts</Th>
              <Th align="end">Also counting undecided accounts</Th>
              <Th>Against</Th>
            </Tr>
          </TableHead>
          <TableBody>
            {scenarios.map(([key, label]) => {
              const s = r.scenarios[key];
              const ye = s.thresholds.yearEnd.formatted;
              const at = s.thresholds.anyTime.formatted;
              return [
                <Tr key={`${key}-h`}><Td><Text weight="semibold">{label}</Text></Td><Td /><Td /><Td /></Tr>,
                <Tr key={`${key}-ye`}>
                  <Td>Last day of the year</Td>
                  <Td align="end"><Stack gap={1}><Value>{t.yearEnd.counted.formatted}</Value><Text size="sm" tone="muted">{testText(s.yearEnd.counted, ye)}</Text></Stack></Td>
                  <Td align="end"><Stack gap={1}><Value>{t.yearEnd.withUnresolved.formatted}</Value><Text size="sm" tone="muted">{testText(s.yearEnd.withUnresolved, ye)}</Text></Stack></Td>
                  <Td><Value>{ye}</Value></Td>
                </Tr>,
                <Tr key={`${key}-sm`}>
                  <Td>At any time: highest balances added up</Td>
                  <Td align="end"><Stack gap={1}><Value>{t.sumOfMaxima.counted.formatted}</Value><Text size="sm" tone="muted">{testText(s.sumOfMaxima.counted, at)}</Text></Stack></Td>
                  <Td align="end"><Stack gap={1}><Value>{t.sumOfMaxima.withUnresolved.formatted}</Value><Text size="sm" tone="muted">{testText(s.sumOfMaxima.withUnresolved, at)}</Text></Stack></Td>
                  <Td><Value>{at}</Value></Td>
                </Tr>,
                <Tr key={`${key}-sd`}>
                  <Td>At any time: one date</Td>
                  <Td align="end"><Text size="sm" tone="muted">{singleText(s.singleDate.counted, at)}</Text></Td>
                  <Td align="end"><Text size="sm" tone="muted">{singleText(s.singleDate.withUnresolved, at)}</Text></Td>
                  <Td><Value>{at}</Value></Td>
                </Tr>,
              ];
            })}
          </TableBody>
        </Table>
        <Text as="p" tone="muted" size="sm">
          Amounts are known values only{r.status === "COMPLETE" ? "" : ", so they are minimums while data is missing"}. "Counted" covers financial accounts and pension plans; the other
          column adds accounts marked "ask the preparer" or not yet classified.
        </Text>
        <Disclosure summary="Two readings of 'at any time'" open={how} onToggle={setHow}>
          <Stack gap={2}>
            <Text as="p">
              The instructions don't say whether "at any time in the year" means each account's own highest value added up, even if they fell on
              different dates, or the combined value on one date. Both are shown. <Text weight="semibold">Highest balances added up</Text> is the stricter reading.
            </Text>
            <Text as="p" tone="muted">
              Highest value means the highest verified statement balance, so it can understate a peak between statements. Pension plans use their 31 December value only.
              Amounts are converted at the Treasury rate for 31 December.
            </Text>
            {t.singleDate.counted.length > 0 && (
              <Table aria-label="Combined value by date (counted accounts)">
                <TableHead><Tr><Th>Date</Th><Th align="end">Combined (USD)</Th><Th>Accounts with no balance that day</Th></Tr></TableHead>
                <TableBody>
                  {t.singleDate.counted.map((d) => (
                    <Tr key={d.date}>
                      <Td><Value>{formatDay(d.date)}</Value></Td>
                      <Td align="end"><Value>{d.usd.formatted}</Value></Td>
                      <Td>{d.missingAccountIds.length === 0 ? <Text tone="muted">none</Text> : <Stack gap={1}>{d.missingAccountIds.map((id) => <AccountLinks key={id} ids={[id]} r={r} />)}</Stack>}</Td>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
            )}
          </Stack>
        </Disclosure>
      </Stack>
    </Section>
  );
}

// ---------------------------------------------------------------- accounts

function FactLinks({ ids }: { ids: number[] }) {
  return <>{ids.map((id) => <Fragment key={id}> <Link href={hrefFact(id)}>#{id}</Link></Fragment>)}</>;
}

function ValueCell({ v, extra }: { v: Form8938ValueDto; extra?: ReactNode }) {
  const note = valueNote(v);
  return (
    <Stack gap={1}>
      {v.native ? <Value>{v.native.formatted}</Value> : <StatusMark tone={v.source === "conflict" ? "danger" : "warning"} icon={v.source === "conflict" ? "cross" : "dash"}>{v.source === "conflict" ? "conflict" : "missing"}</StatusMark>}
      {v.usd && v.native && v.usd.currency !== v.native.currency && <Text size="sm" tone="muted"><Value>{v.usd.formatted}</Value></Text>}
      {v.native && !v.usd && v.native.currency !== "USD" && <Text size="sm" tone="warning">not converted</Text>}
      {v.date && <Text size="sm" tone="muted">{formatDay(v.date)}<FactLinks ids={v.factIds} /></Text>}
      {note && <Text size="sm" tone={note.tone}>{note.text}</Text>}
      {extra}
    </Stack>
  );
}

function RateCell({ x }: { x: Form8938RowDto }) {
  if (x.conversion.kind === "none") return <Text tone="muted">already USD</Text>;
  if (x.conversion.kind === "missing_rate") return <StatusMark tone="danger" icon="cross">rate missing ({x.conversion.currency})</StatusMark>;
  return <Value>{x.conversion.rate} on {formatDay(x.conversion.rateDate)}</Value>;
}

function AccountsSection({ r, onChanged }: { r: Form8938ReportDto; onChanged: () => Promise<void> }) {
  if (r.rows.length === 0) return <Empty>No foreign accounts were open in {r.year}.</Empty>;
  const { counted, undecided } = groupRows(r.rows);
  const table = (rows: Form8938RowDto[], label: string) => (
    <Table aria-label={label}>
      <TableHead>
        <Tr>
          <Th>Account</Th>
          <Th>Treatment</Th>
          <Th align="end">Maximum value</Th>
          <Th align="end">Year-end value</Th>
          <Th>Rate</Th>
        </Tr>
      </TableHead>
      <TableBody>
        {rows.map((x) => (
          <Tr key={x.accountId}>
            <Td><Link href={hrefAccount(x.accountId)}><DataText>{x.displayName}</DataText></Link></Td>
            <Td><Treatment x={x} year={r.year} onChanged={onChanged} /></Td>
            <Td align="end"><ValueCell v={x.maximum} extra={maximumNotes(x.maximum).filter((n) => n.text !== valueNote(x.maximum)?.text).map((n) => <Text key={n.text} size="sm" tone={n.tone}>{n.text}</Text>)} /></Td>
            <Td align="end"><ValueCell v={x.yearEnd} /></Td>
            <Td><RateCell x={x} /></Td>
          </Tr>
        ))}
      </TableBody>
    </Table>
  );
  return (
    <Stack gap={4}>
      {counted.length > 0 && table(counted, "Counted accounts")}
      {undecided.length > 0 && (
        <Stack gap={2}>
          <Text weight="semibold">Undecided accounts</Text>
          <Text as="p" tone="muted" size="sm">These are not in the "counted" totals. Classify each one below; the choice applies from {r.year} onward.</Text>
          {table(undecided, "Undecided accounts")}
        </Stack>
      )}
    </Stack>
  );
}

function Treatment({ x, year, onChanged }: { x: Form8938RowDto; year: number; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(needsClassifying(x) && x.treatment === "not_classified");
  const [term, setTerm] = useState<string>(termForTreatment(x.treatment) ?? "");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const termId = term === "" ? null : (term as Us8938TermId);
  const problem = classificationProblem(termId, reason);
  const { run, busy, error } = useAction(async () => {
    if (termId === null || problem) return;
    await api.accounts.setUs8938(x.accountId, classificationBody(year, termId, reason));
    setEditing(false);
    await onChanged();
  });
  if (!editing) {
    return (
      <Stack gap={1}>
        <Text>{TREATMENT_LABEL[x.treatment]}</Text>
        <Button variant="link" size="sm" onClick={() => setEditing(true)}>change</Button>
      </Stack>
    );
  }
  return (
    <Stack gap={2}>
      <Select value={term} onChange={setTerm} placeholder="Choose..." aria-label={`Treatment for ${x.displayName}`} options={US_8938_TERM_IDS.map((t) => ({ value: t, label: TERM_LABEL[t] }))} />
      {termId !== null && needsReason(termId) && <TextInput value={reason} onChange={setReason} aria-label="Reason this account is not reportable" placeholder="Why is it not reportable?" />}
      <Text size="sm" tone="muted">Applies from {year} onward.</Text>
      {touched && problem && <Text size="sm" tone="danger">{problem}</Text>}
      <Alert tone="danger">{error}</Alert>
      <Stack gap={1}>
        <Button size="sm" variant="primary" busy={busy} onClick={() => { setTouched(true); if (!problem) void run(); }}>Save</Button>
        {x.treatment !== "not_classified" && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------- Part V / VI

function PartV({ r }: { r: Form8938ReportDto }) {
  const counted = r.rows.filter((x) => x.counted);
  if (counted.length === 0) return null;
  return (
    <Section title="Account details (Parts V and VI)">
      <Stack gap={2}>
        {counted.map((x) => <Detail key={x.accountId} x={x} />)}
      </Stack>
    </Section>
  );
}

function Detail({ x }: { x: Form8938RowDto }) {
  const [open, setOpen] = useState(false);
  const d = x.details;
  return (
    <Disclosure summary={<DataText>{x.displayName}</DataText>} meta={TREATMENT_LABEL[x.treatment]} open={open} onToggle={setOpen}>
      <KeyValues
        items={[
          { label: "Account identifiers", value: d.identifiers.length ? d.identifiers.map((i) => <Text key={`${i.kind}${i.value}`} as="p"><Text tone="muted">{i.kind}</Text> <Value>{i.value}</Value></Text>) : <Text tone="muted">none recorded</Text> },
          { label: "Institution", value: d.institutionName ? <DataText>{d.institutionName}</DataText> : <Text tone="muted">none recorded</Text> },
          { label: "Opened during the year", value: d.openedDuringYear ? "Yes" : "No" },
          { label: "Closed during the year", value: d.closedDuringYear ? "Yes" : "No" },
          { label: "Owners", value: <><DataText>{d.owners.map((o) => o.displayName).join(", ")}</DataText>{d.owners.length > 0 ? " " : ""}<Text tone="muted">{ownersHint(d.owners)}</Text></> },
          { label: "Maximum value", value: x.maximum.usd ? <Value>{x.maximum.usd.formatted}</Value> : <Text tone="warning">not available</Text> },
          { label: "Currency", value: d.currency },
          { label: "Exchange rate", value: d.rate ? <Value>{d.rate.rate} on {formatDay(d.rate.rateDate)}</Value> : x.conversion.kind === "none" ? <Text tone="muted">not needed</Text> : <Text tone="warning">rate missing</Text> },
          { label: "Institution mailing address", value: <Text tone="muted">not in FinShark</Text> },
          { label: "Institution GIIN", value: <Text tone="muted">not in FinShark</Text> },
        ]}
      />
    </Disclosure>
  );
}

// ---------------------------------------------------------------- Part III

function PartIII({ r }: { r: Form8938ReportDto }) {
  const counted = r.rows.filter((x) => x.counted && x.taxItems);
  if (counted.length === 0) return null;
  return (
    <Section title="Tax items (Part III)">
      <Stack gap={3}>
        <Text as="p" tone="muted" size="sm">Interest and dividends for {r.year}, from each account's other numbers. Where each item was reported on the return is left to your preparer.</Text>
        {r.taxItemsStatus !== "COMPLETE" && <Alert tone="warning">Some tax items are incomplete or in conflict. See below.</Alert>}
        {counted.map((x) => {
          const t = x.taxItems!;
          const ex = excludedSummary(t);
          return (
            <Stack key={x.accountId} gap={2}>
              <Link href={hrefAccount(x.accountId)}><DataText>{x.displayName}</DataText></Link>
              {t.noTaxItems && <StatusMark tone="warning" icon="dash">No tax items found for {r.year}. Part V has a box for that; check it is right.</StatusMark>}
              {t.groups.map((g) => {
                const v = taxGroupView(g);
                return (
                  <Stack key={g.genericConceptId + g.currency} gap={1}>
                    <Text><Text weight="semibold">{v.label}</Text>: {v.total ? <Value>{v.total}</Value> : <Text tone="warning">no total</Text>}{v.totalNote ? <Text tone="muted"> ({v.totalNote})</Text> : null}<FactLinks ids={g.factIds} /></Text>
                    {v.problems.map((p) => <StatusMark key={p} tone="warning" icon="dash">{p}</StatusMark>)}
                    {g.periods.filter((p) => p.disagreeing).map((p) => (
                      <StatusMark key={p.periodStart} tone="danger" icon="cross">
                        {formatDay(p.periodStart)} to {formatDay(p.periodEnd)}: {p.disagreeing!.map((d) => d.amount.formatted).join(" or ")}
                      </StatusMark>
                    ))}
                  </Stack>
                );
              })}
              {ex && <Text size="sm" tone="muted">{ex}<FactLinks ids={t.excluded.map((e) => e.factId)} /></Text>}
            </Stack>
          );
        })}
      </Stack>
    </Section>
  );
}

// ---------------------------------------------------------------- lists

function Others({ r }: { r: Form8938ReportDto }) {
  if (r.notReportable.length === 0 && r.notInScope.length === 0) return null;
  return (
    <Stack gap={4}>
      {r.notReportable.length > 0 && (
        <Section title="Not reportable">
          <List>
            {r.notReportable.map((a) => (
              <ListItem key={a.accountId}>
                <Link href={hrefAccount(a.accountId)}><DataText>{a.displayName}</DataText></Link>{" "}
                <Text tone="muted">{a.reason ?? "no reason recorded"}</Text>
              </ListItem>
            ))}
          </List>
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
  );
}
