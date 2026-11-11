import { useState } from "react";
import { ACCOUNT_TYPES, type AccountType } from "@finshark/shared";
import type {
  AccountDto,
  SetAccountNameRequest,
  SetAccountNotesRequest,
  SetAccountNumberRequest,
  SetAccountCadenceRequest,
  SetAccountTypeRequest,
  SetAccountOwnersRequest,
} from "@finshark/shared";
import { api } from "./api.ts";
import { AddOwner } from "./AddOwner.tsx";
import { useActor, useRefData } from "./context.tsx";
import { ACCOUNT_TYPE_LABEL } from "./labels.ts";
import {
  Alert,
  Button,
  Checkbox,
  DataText,
  Field,
  FieldGroup,
  FieldRow,
  Form,
  Inline,
  Panel,
  Select,
  Stack,
  Text,
  TextArea,
  TextInput,
} from "./ds/index.ts";
import { useAction } from "./ui.tsx";

export const ACCOUNT_TYPE_OPTIONS = ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }));
export const CADENCE_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Twice a year" },
  { value: "annual", label: "Once a year" },
  { value: "irregular", label: "Irregular" },
];

/** Checkboxes for choosing owners, with "Add owner..." to add or promote one in place. */
export function OwnerPicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
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

/** The form for editing an account; shown on the account's own page. */
export function EditAccount({ account: a, onDone }: { account: AccountDto; onDone: () => void }) {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [selected, setSelected] = useState<number[]>(a.owners.map((o) => o.personId));
  const [number, setNumber] = useState(a.accountNumber ?? "");
  const [name, setName] = useState(a.displayName);
  const [type, setType] = useState(a.accountType ?? "");
  const [cadence, setCadence] = useState(a.statementCadence ?? "");
  const [notes, setNotes] = useState(a.notes ?? "");
  const [altName, setAltName] = useState(a.altName ?? "");

  const { run, busy, error, setError } = useAction(async () => {
    const newName = name.trim();
    const newNumber = number.trim() === "" ? null : number.trim();
    const ownersChanged =
      selected.length !== a.owners.length || a.owners.some((o) => !selected.includes(o.personId));
    const numberChanged = newNumber !== (a.accountNumber ?? null);
    const newAlt = altName.trim() === "" ? null : altName.trim();
    if (newName !== a.displayName || newAlt !== (a.altName ?? null)) {
      const body: SetAccountNameRequest = { displayName: newName, altName: newAlt };
      await mutate(() => api.accounts.setName(a.id, body));
    }
    if (type !== (a.accountType ?? "")) {
      const body: SetAccountTypeRequest = { accountType: type === "" ? null : (type as AccountType) };
      await mutate(() => api.accounts.setType(a.id, body));
    }
    if (cadence !== (a.statementCadence ?? "")) {
      const body: SetAccountCadenceRequest = {
        statementCadence: cadence === "" ? null : (cadence as NonNullable<SetAccountCadenceRequest["statementCadence"]>),
      };
      await mutate(() => api.accounts.setCadence(a.id, body));
    }
    const newNotes = notes.trim() === "" ? null : notes.trim();
    if (newNotes !== a.notes) {
      const body: SetAccountNotesRequest = { notes: newNotes };
      await mutate(() => api.accounts.setNotes(a.id, body));
    }
    if (ownersChanged) {
      // Keep role and share of owners that stay; new ones are plain owners.
      const body: SetAccountOwnersRequest = {
        owners: selected.map((personId) => {
          const existing = a.owners.find((o) => o.personId === personId);
          return { personId, role: existing?.role ?? "owner", share: existing?.share ?? null };
        }),
      };
      await mutate(() => api.accounts.setOwners(a.id, body));
    }
    if (numberChanged) {
      const body: SetAccountNumberRequest = { accountNumber: newNumber };
      await mutate(() => api.accounts.setNumber(a.id, body));
    }
    await reload();
  });

  const save = async () => {
    if (name.trim() === "") return setError("Enter the account's name.");
    if (selected.length === 0) return setError("Choose at least one owner.");
    if (await run()) onDone();
  };

  const cancel = () => { setError(null); onDone(); };

  return (
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
  );
}
