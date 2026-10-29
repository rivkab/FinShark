import { useState } from "react";
import { ACCOUNT_TYPES, INSTITUTION_KINDS, type AccountType, type InstitutionKind } from "@finshark/shared";
import type {
  AccountDto,
  FactDto,
  CreateAccountRequest,
  CreateInstitutionRequest,
  DocumentDto,
  InstitutionDto,
  Language,
  SetAccountNameRequest,
  SetAccountNotesRequest,
  SetAccountNumberRequest,
  SetAccountCadenceRequest,
  SetAccountTypeRequest,
  SetAccountOwnersRequest,
} from "@finshark/shared";
import { apiFetch } from "./api.ts";
import { hrefAccount, hrefDocuments, hrefFact } from "./route.ts";
import { AddOwner } from "./AddOwner.tsx";
import { useActor, useRefData } from "./context.tsx";
import { sortInstitutions } from "./institutionSort.ts";
import { sortAccounts, type AccountSortKey, type SortDir } from "./accountSort.ts";
import { NO_FILTERS, NO_TYPE, filterAccounts, hasFilters, type AccountFilters } from "./accountFilter.ts";
import { coverageNote, currencyTotals, newestBalanceDate } from "./accountTotals.ts";
import { formatDay, formatDayShort } from "./displayDate.ts";
import { ACCOUNT_TYPE_LABEL, INSTITUTION_KIND_LABEL, currencyForCountry, languageForCountry } from "./labels.ts";
import { latestBalances } from "./latestBalance.ts";
import { factDateLabel } from "./suggest.ts";
import {
  Alert,
  Button,
  Checkbox,
  DataText,
  DateInput,
  Empty,
  Field,
  FieldGroup,
  FieldRow,
  Form,
  Inline,
  Link,
  Page,
  Panel,
  RowAction,
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
  TextArea,
  TextInput,
  Th,
  Tr,
  Value,
} from "./ds/index.ts";
import { InstitutionName, AccountName, FactAmount, FactConcept, langLabel, useAction, useLoad } from "./ui.tsx";

const ACCOUNT_TYPE_OPTIONS = ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }));
const INSTITUTION_KIND_OPTIONS = INSTITUTION_KINDS.map((k) => ({ value: k, label: INSTITUTION_KIND_LABEL[k] }));
const CADENCE_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Twice a year" },
  { value: "annual", label: "Once a year" },
  { value: "irregular", label: "Irregular" },
];

export function AccountsPage() {
  const { institutions, accounts, people, concepts } = useRefData();
  const docs = useLoad(() => apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents), 0);
  const balances = useLoad(
    () => apiFetch<{ facts: FactDto[] }>("/api/facts").then((r) => latestBalances(r.facts, concepts)),
    0,
  );
  const proposed = useLoad(() => apiFetch<{ facts: FactDto[] }>("/api/facts?status=proposed").then((r) => r.facts), 0);
  const [sort, setSort] = useState<{ key: AccountSortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [filters, setFilters] = useState<AccountFilters>(NO_FILTERS);
  const setFilter = (key: keyof AccountFilters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const shown = filterAccounts(accounts, filters, today);
  const sorted = sortAccounts(shown, sort.key, sort.dir, people);
  const currencies = [...new Set(accounts.map((a) => a.nativeCurrency))].sort();
  /** Clicking the active column flips the direction; another column starts ascending. */
  const sortBy = (key: AccountSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sortHeader = (key: AccountSortKey, label: string) => (
    <Th sort={sort.key === key ? sort.dir : "none"} onSort={() => sortBy(key)}>{label}</Th>
  );

  const newest = balances.data ? newestBalanceDate(balances.data) : null;
  const totals = balances.data ? currencyTotals(accounts, balances.data) : [];
  const conflicts = proposed.data ?? [];
  const toCheck = conflicts.length;

  return (
    <Page eyebrow={newest ? `Latest statements · as of ${formatDay(newest)}` : "Latest statements"} title="Accounts">
      <Stack gap={7}>
        <StatGroup>
          {totals.map((t) => (
            <Stat
              key={t.currency}
              label={`${t.currency} accounts`}
              value={t.formatted === null ? "None" : <Value>{t.formatted}</Value>}
              note={coverageNote(t)}
            />
          ))}
          {proposed.error && <Stat label="Conflicting values" value="?" note="Could not load the conflicts" tone="warning" />}
          {toCheck > 0 && (
            <Stat
              label="Conflicting values"
              value={toCheck === 1 ? "1 value" : `${toCheck} values`}
              note="A different value is already verified for the same thing"
              tone="warning"
            />
          )}
        </StatGroup>

        {toCheck > 0 && (
          <Section title="Conflicting values">
            <Stack gap={3}>
              <Text as="p" tone="muted">
                A different value is already verified for the same kind of number, account, person and date. Open each one to verify it anyway, correct it or delete it.
              </Text>
              <Table aria-label="Conflicting values">
                <TableHead>
                  <Tr>
                    <Th>Kind of number</Th>
                    <Th>Account or person</Th>
                    <Th>Date</Th>
                    <Th align="end">Value</Th>
                    <Th>{""}</Th>
                  </Tr>
                </TableHead>
                <TableBody>
                  {conflicts.map((f) => (
                    <Tr key={f.id}>
                      <Td><FactConcept fact={f} /></Td>
                      <Td>
                        {f.accountName !== null ? <DataText>{f.accountName}</DataText> : f.personName !== null ? <DataText>{f.personName}</DataText> : <Text tone="muted">none</Text>}
                      </Td>
                      <Td><Value>{factDateLabel(f)}</Value></Td>
                      <Td align="end"><FactAmount fact={f} /></Td>
                      <Td><Link href={hrefFact(f.id)}>Open</Link></Td>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          </Section>
        )}

        {accounts.length === 0 ? (
          <Empty>No accounts yet.{institutions.length === 0 ? " Add an institution first." : ""}</Empty>
        ) : (
          <Stack gap={3}>
          <FieldRow align="end">
            <Field label="Institution">
              <Select
                value={filters.institutionId}
                onChange={setFilter("institutionId")}
                placeholder="Any"
                options={sortInstitutions(institutions.filter((i) => accounts.some((a) => a.institutionId === i.id))).map((i) => ({ value: String(i.id), label: i.name, dir: "auto" as const }))}
              />
            </Field>
            <Field label="Type">
              <Select
                value={filters.type}
                onChange={setFilter("type")}
                placeholder="Any"
                options={[...ACCOUNT_TYPE_OPTIONS, { value: NO_TYPE, label: "Not set" }]}
              />
            </Field>
            <Field label="Owner">
              <Select
                value={filters.ownerId}
                onChange={setFilter("ownerId")}
                placeholder="Any"
                options={people.filter((p) => p.ownsAccounts).map((p) => ({ value: String(p.id), label: p.displayName, dir: "auto" as const }))}
              />
            </Field>
            {currencies.length > 1 && (
              <Field label="Currency">
                <Select value={filters.currency} onChange={setFilter("currency")} placeholder="Any" options={currencies.map((c) => ({ value: c, label: c }))} />
              </Field>
            )}
            <Field label="Status">
              <Select
                value={filters.status}
                onChange={setFilter("status")}
                placeholder="Any"
                options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }]}
              />
            </Field>
            {hasFilters(filters) && <Button variant="link" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
          </FieldRow>
          {hasFilters(filters) && (
            <Text tone="muted">Showing {shown.length} of {accounts.length} accounts. The totals above cover all accounts.</Text>
          )}
          {shown.length === 0 ? <Empty>No accounts match these filters.</Empty> : (
          <Table aria-label="Accounts">
            <TableHead>
              <Tr>
                {sortHeader("name", "Account")}
                {sortHeader("institution", "Institution")}
                {sortHeader("type", "Type")}
                {sortHeader("owners", "Owners")}
                <Th>Number</Th>
                <Th align="end">Latest value</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {sorted.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  balance={balances.data ? (balances.data.get(a.id) ?? null) : undefined}
                  docCount={docs.data ? docs.data.filter((d) => d.accountIds.includes(a.id)).length : null}
                />
              ))}
            </TableBody>
          </Table>
          )}
          </Stack>
        )}
      </Stack>

      <Section title="Institutions">
        {institutions.length === 0 ? (
          <Empty>No institutions yet. Add the banks, brokers and funds your documents come from.</Empty>
        ) : (
          <Table aria-label="Institutions">
            <TableHead>
              <Tr><Th>Name</Th><Th>Kind</Th><Th>Country</Th><Th>Language</Th></Tr>
            </TableHead>
            <TableBody>
              {sortInstitutions(institutions).map((i) => (
                <InstitutionRow key={i.id} inst={i} />
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Add">
        <Stack gap={5}>
          {institutions.some((i) => i.kind !== "employer") && <AddAccount />}
          <AddInstitution />
        </Stack>
      </Section>
    </Page>
  );
}

/** Checkboxes for choosing owners, with "Add owner..." to add or promote one in place. */
function OwnerPicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const owners = useRefData().people.filter((p) => p.ownsAccounts);
  return (
    <Stack gap={2}>
      {owners.length > 0 ? (
        <FieldGroup label="Owner(s)">
          {owners.map((p) => (
            <Checkbox
              key={p.id}
              checked={selected.includes(p.id)}
              onChange={(checked) => onChange(checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))}
              label={<DataText>{p.displayName}</DataText>}
            />
          ))}
        </FieldGroup>
      ) : (
        <Text tone="muted">Every account needs an owner. Add one to continue.</Text>
      )}
      <AddOwner onOwner={(p) => onChange(selected.includes(p.id) ? selected : [...selected, p.id])} />
    </Stack>
  );
}

function OwnersView({ account }: { account: AccountDto }) {
  const { people } = useRefData();
  if (account.owners.length === 0) return <Text tone="muted">none recorded</Text>;
  return (
    <Stack gap={1}>
      {account.owners.map((o) => (
        <Text as="div" key={`${o.personId}-${o.role}`}>
          <DataText>{people.find((p) => p.id === o.personId)?.displayName ?? `#${o.personId}`}</DataText>
          {o.role !== "owner" && <Text tone="muted"> ({o.role})</Text>}
          {o.share && <Text tone="muted"> <Value>{o.share}</Value></Text>}
        </Text>
      ))}
    </Stack>
  );
}

/** The latest balance: the amount and its date; a conflicting (proposed) one is flagged. */
function LatestValue({ balance }: { balance: FactDto | null | undefined }) {
  if (balance === undefined) return null;
  if (balance === null) return <Text tone="muted">none yet</Text>;
  const date = balance.instantDate ? formatDayShort(balance.instantDate) : "";
  return (
    <Stack gap={1}>
      <Value size="lg">{balance.formatted}</Value>
      {balance.status === "verified" ? (
        <Text size="sm" tone="muted">{date}</Text>
      ) : (
        <StatusMark tone="warning" icon="clock">conflict · {date}</StatusMark>
      )}
    </Stack>
  );
}

function AccountRow({ account: a, docCount, balance }: { account: AccountDto; docCount: number | null; balance: FactDto | null | undefined }) {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [cadence, setCadence] = useState("");
  const [notes, setNotes] = useState("");
  const [altName, setAltName] = useState("");

  const startEdit = () => {
    setSelected(a.owners.map((o) => o.personId));
    setNumber(a.accountNumber ?? "");
    setName(a.displayName);
    setType(a.accountType ?? "");
    setCadence(a.statementCadence ?? "");
    setNotes(a.notes ?? "");
    setAltName(a.altName ?? "");
    setError(null);
    setEditing(true);
  };

  const { run, busy, error, setError } = useAction(async () => {
    const newName = name.trim();
    const newNumber = number.trim() === "" ? null : number.trim();
    const ownersChanged =
      selected.length !== a.owners.length || a.owners.some((o) => !selected.includes(o.personId));
    const numberChanged = newNumber !== (a.accountNumber ?? null);
    const newAlt = altName.trim() === "" ? null : altName.trim();
    if (newName !== a.displayName || newAlt !== (a.altName ?? null)) {
      const body: SetAccountNameRequest = { displayName: newName, altName: newAlt };
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/name`, { method: "PUT", body }));
    }
    if (type !== (a.accountType ?? "")) {
      const body: SetAccountTypeRequest = { accountType: type === "" ? null : (type as AccountType) };
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/type`, { method: "PUT", body }));
    }
    if (cadence !== (a.statementCadence ?? "")) {
      const body: SetAccountCadenceRequest = {
        statementCadence: cadence === "" ? null : (cadence as NonNullable<SetAccountCadenceRequest["statementCadence"]>),
      };
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/cadence`, { method: "PUT", body }));
    }
    const newNotes = notes.trim() === "" ? null : notes.trim();
    if (newNotes !== a.notes) {
      const body: SetAccountNotesRequest = { notes: newNotes };
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/notes`, { method: "PUT", body }));
    }
    if (ownersChanged) {
      // Keep role and share of owners that stay; new ones are plain owners.
      const body: SetAccountOwnersRequest = {
        owners: selected.map((personId) => {
          const existing = a.owners.find((o) => o.personId === personId);
          return { personId, role: existing?.role ?? "owner", share: existing?.share ?? null };
        }),
      };
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/owners`, { method: "PUT", body }));
    }
    if (numberChanged) {
      const body: SetAccountNumberRequest = { accountNumber: newNumber };
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/account-number`, { method: "PUT", body }));
    }
    await reload();
  });

  const save = async () => {
    if (name.trim() === "") return setError("Enter the account's name.");
    if (selected.length === 0) return setError("Choose at least one owner.");
    if (await run()) setEditing(false);
  };

  const cancel = () => { setEditing(false); setError(null); };

  return (
    <>
      <Tr>
        <Td>
          <RowAction onClick={startEdit}>Edit</RowAction>
          <Stack gap={1}>
            <Text weight="semibold"><Link href={hrefAccount(a.id)}><AccountName account={a} /></Link></Text>
            {docCount !== null && (
              <Text as="div" size="sm">
                {docCount === 0 ? (
                  <Text tone="muted">no documents</Text>
                ) : (
                  <Link href={hrefDocuments(a.id)}>{docCount} {docCount === 1 ? "document" : "documents"}</Link>
                )}
              </Text>
            )}
            {a.notes && <Text as="div" size="sm" tone="muted"><DataText block>{a.notes}</DataText></Text>}
          </Stack>
        </Td>
        <Td><DataText>{a.institutionName}</DataText></Td>
        <Td>{a.accountType ? ACCOUNT_TYPE_LABEL[a.accountType] : <Text tone="muted">not set</Text>}</Td>
        <Td><OwnersView account={a} /></Td>
        <Td>{a.accountNumber ? <Text tone="muted"><Value>{a.accountNumber}</Value></Text> : <Text tone="muted">none</Text>}</Td>
        <Td align="end"><LatestValue balance={balance} /></Td>
      </Tr>
      {editing && (
        <Tr>
          <Td colSpan={6}>
            <Panel title={`Edit ${a.displayName}`}>
              <Form onSubmit={() => void save()}>
                <FieldRow>
                  <Field label="Name" grow><TextInput value={name} onChange={setName} /></Field>
                  <Field label="Name in the other language (optional)" grow><TextInput value={altName} onChange={setAltName} /></Field>
                </FieldRow>
                <FieldRow>
                  <Field label="Type">
                    <Select value={type} onChange={setType} options={ACCOUNT_TYPE_OPTIONS} placeholder="Not set" />
                  </Field>
                  <Field
                    label="Account number"
                    hint={a.accountNumber ? "The old number is kept in the account's history." : undefined}
                  >
                    <TextInput dir="ltr" value={number} onChange={setNumber} />
                  </Field>
                </FieldRow>
                <FieldRow>
                  <Field label="Statement frequency" hint="Used to check that no statement is missing.">
                    <Select value={cadence} onChange={setCadence} options={CADENCE_OPTIONS} placeholder="Not set" />
                  </Field>
                </FieldRow>
                <OwnerPicker selected={selected} onChange={setSelected} />
                <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
                <Alert tone="danger">{error}</Alert>
                <Inline>
                  <Button type="submit" variant="primary" busy={busy}>Save</Button>
                  <Button onClick={cancel} disabled={busy}>Cancel</Button>
                </Inline>
              </Form>
            </Panel>
          </Td>
        </Tr>
      )}
    </>
  );
}

function InstitutionRow({ inst }: { inst: InstitutionDto }) {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState("");

  const { run, busy, error, setError } = useAction(async () => {
    if (kind !== (inst.kind ?? "")) {
      await mutate(() => apiFetch<InstitutionDto>(`/api/institutions/${inst.id}/kind`, { method: "PUT", body: { kind: kind === "" ? null : kind } }));
      await reload();
    }
  });

  const startEdit = () => {
    setKind(inst.kind ?? "");
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    if (await run()) setEditing(false);
  };
  const cancel = () => { setEditing(false); setError(null); };

  return (
    <>
      <Tr>
        <Td>
          <RowAction onClick={startEdit}>Edit</RowAction>
          <InstitutionName inst={inst} />
        </Td>
        <Td>{inst.kind ? INSTITUTION_KIND_LABEL[inst.kind] : <Text tone="muted">not set</Text>}</Td>
        <Td>{inst.country}</Td>
        <Td>{langLabel(inst.language)}</Td>
      </Tr>
      {editing && (
        <Tr>
          <Td colSpan={4}>
            <Panel title={`Edit ${inst.name}`}>
              <Form onSubmit={() => void save()}>
                <Field label="Kind">
                  <Select value={kind} onChange={setKind} options={INSTITUTION_KIND_OPTIONS} placeholder="Not set" />
                </Field>
                <Alert tone="danger">{error}</Alert>
                <Inline>
                  <Button type="submit" variant="primary" busy={busy}>Save</Button>
                  <Button onClick={cancel} disabled={busy}>Cancel</Button>
                </Inline>
              </Form>
            </Panel>
          </Td>
        </Tr>
      )}
    </>
  );
}

function AddInstitution() {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [name, setName] = useState("");
  const [altName, setAltName] = useState("");
  const [country, setCountry] = useState("US");
  const [language, setLanguage] = useState<Language>("en");
  const [kind, setKind] = useState("");

  const { run, busy, error, setError } = useAction(async () => {
    const body: CreateInstitutionRequest = { name: name.trim(), country, language, kind: kind as InstitutionKind, ...(altName.trim() ? { altName: altName.trim() } : {}) };
    await mutate(() => apiFetch<InstitutionDto>("/api/institutions", { method: "POST", body }));
    setName("");
    setAltName("");
    await reload();
  });

  const submit = async () => {
    if (name.trim() === "") return setError("Enter the institution's name.");
    if (kind === "") return setError("Choose whether it is a financial institution or an employer.");
    await run();
  };

  return (
    <Panel title="Add an institution">
      <Form onSubmit={() => void submit()}>
        <FieldRow>
          <Field label="Name, as printed on its documents" grow><TextInput value={name} onChange={setName} /></Field>
          <Field label="Name in the other language (optional)" grow><TextInput value={altName} onChange={setAltName} /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Kind">
            <Select value={kind} onChange={setKind} options={INSTITUTION_KIND_OPTIONS} placeholder="Choose…" />
          </Field>
          <Field label="Country">
            <Select
              value={country}
              onChange={(v) => { setCountry(v); setLanguage(languageForCountry(v)); }}
              options={[{ value: "US", label: "United States" }, { value: "IL", label: "Israel" }]}
            />
          </Field>
          <Field label="Language of its documents">
            <Select
              value={language}
              onChange={(v) => setLanguage(v as Language)}
              options={[{ value: "en", label: "English" }, { value: "he", label: "Hebrew" }]}
            />
          </Field>
        </FieldRow>
        <Alert tone="danger">{error}</Alert>
        <Inline><Button type="submit" variant="primary" busy={busy}>Add institution</Button></Inline>
      </Form>
    </Panel>
  );
}

/**
 * `institutionId` preselects the institution (a document's, when adding from a document).
 * `pickedText` is text boxed on a PDF, offered for the account number. `onCreated` runs after the account exists.
 */
export function AddAccount({
  institutionId: preferredInstitutionId = null,
  pickedText = null,
  onCreated,
}: {
  institutionId?: number | null;
  pickedText?: string | null;
  onCreated?: (account: AccountDto) => void | Promise<void>;
}) {
  const { institutions, accounts, people, reload } = useRefData();
  const { mutate } = useActor();
  const owningPeople = people.filter((p) => p.ownsAccounts);
  const [ownerIds, setOwnerIds] = useState<number[]>(owningPeople.length === 1 ? [owningPeople[0]!.id] : []);
  const sortedInstitutions = sortInstitutions(institutions.filter((i) => i.kind !== "employer"));
  const firstInstitution = sortedInstitutions.find((i) => i.id === preferredInstitutionId) ?? sortedInstitutions[0];
  const [institutionId, setInstitutionId] = useState(String(firstInstitution?.id ?? ""));
  const [displayName, setDisplayName] = useState("");
  const [altName, setAltName] = useState("");
  const [currency, setCurrency] = useState(currencyForCountry(firstInstitution?.country ?? "US"));
  const [openedOn, setOpenedOn] = useState("");
  const [closedOn, setClosedOn] = useState("");
  const [cadence, setCadence] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState("");
  const [notes, setNotes] = useState("");

  const onInstitution = (v: string) => {
    setInstitutionId(v);
    const inst = institutions.find((i) => String(i.id) === v);
    if (inst) setCurrency(currencyForCountry(inst.country));
  };

  const { run, busy, error, setError } = useAction(async () => {
    const body: CreateAccountRequest = {
      owners: ownerIds.map((personId) => ({ personId })),
      institutionId: Number(institutionId),
      displayName: displayName.trim(),
      nativeCurrency: currency,
      ...(altName.trim() ? { altName: altName.trim() } : {}),
      ...(openedOn ? { openedOn } : {}),
      ...(closedOn ? { closedOn } : {}),
      ...(cadence ? { statementCadence: cadence as NonNullable<CreateAccountRequest["statementCadence"]> } : {}),
      accountType: accountType as AccountType,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(accountNumber.trim() ? { accountNumber: accountNumber.trim() } : {}),
    };
    const created = await mutate(() => apiFetch<AccountDto>("/api/accounts", { method: "POST", body }));
    setDisplayName("");
    setAltName("");
    setAccountNumber("");
    setAccountType("");
    setNotes("");
    setOpenedOn("");
    setClosedOn("");
    await reload();
    await onCreated?.(created);
  });

  const submit = async () => {
    if (institutionId === "") return setError("Choose the institution.");
    if (displayName.trim() === "") return setError("Enter the account's name.");
    if (accountType === "") return setError("Choose the account type.");
    if (accountNumber.trim() === "") return setError("Enter the account number.");
    if (ownerIds.length === 0) return setError("Choose at least one owner.");
    await run();
  };

  const sameNumber = accountNumber.trim() === "" ? undefined : accounts.find((a) => a.accountNumber === accountNumber.trim());

  return (
    <Panel title="Add an account">
      <Form onSubmit={() => void submit()}>
        <FieldRow>
          <Field label="Institution">
            <Select
              value={institutionId}
              onChange={onInstitution}
              options={sortedInstitutions.map((i) => ({ value: String(i.id), label: i.name, dir: "auto" as const }))}
            />
          </Field>
          <Field label="Account name" grow><TextInput value={displayName} onChange={setDisplayName} /></Field>
          <Field label="Name in the other language (optional)" grow><TextInput value={altName} onChange={setAltName} /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Type">
            <Select value={accountType} onChange={setAccountType} options={ACCOUNT_TYPE_OPTIONS} placeholder="Choose..." />
          </Field>
          <Field label="Currency">
            <Select
              value={currency}
              onChange={setCurrency}
              options={[{ value: "USD", label: "USD ($)" }, { value: "ILS", label: "ILS (₪)" }]}
            />
          </Field>
          <Field label="Opened (optional)"><DateInput value={openedOn} onChange={setOpenedOn} /></Field>
          <Field label="Closed (optional)"><DateInput value={closedOn} onChange={setClosedOn} /></Field>
          <Field label="How often it sends statements">
            <Select value={cadence} onChange={setCadence} options={CADENCE_OPTIONS} placeholder="Not set" />
          </Field>
          <Field
            label="Account number"
            hint={
              pickedText && pickedText !== accountNumber.trim() ? (
                <Button variant="link" onClick={() => setAccountNumber(pickedText)}>Use boxed text: {pickedText}</Button>
              ) : undefined
            }
          >
            <TextInput dir="ltr" value={accountNumber} onChange={setAccountNumber} />
          </Field>
        </FieldRow>
        {sameNumber && <Alert tone="warning">An account with this number already exists: {sameNumber.displayName} ({sameNumber.institutionName}).</Alert>}
        <OwnerPicker selected={ownerIds} onChange={setOwnerIds} />
        <Field label="Notes (optional)"><TextArea rows={2} value={notes} onChange={setNotes} /></Field>
        <Alert tone="danger">{error}</Alert>
        <Inline><Button type="submit" variant="primary" busy={busy}>Add account</Button></Inline>
      </Form>
    </Panel>
  );
}
