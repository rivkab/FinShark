import { useState } from "react";
import type { PersonDto } from "@finshark/shared";
import { useActor } from "./context.tsx";
import { apiFetch, errorText } from "./api.ts";
import { useAction } from "./ui.tsx";
import {
  Alert,
  Button,
  Checkbox,
  DataText,
  Field,
  FieldRow,
  Form,
  Inline,
  Page,
  Panel,
  RowAction,
  Table,
  TableBody,
  TableHead,
  Td,
  Text,
  TextInput,
  Th,
  Tr,
} from "./ds/index.ts";

const NEED_A_ROLE = "Choose at least one: owns accounts or uses FinShark.";

/** One-field form that adds a person to the household. */
export function AddPersonForm({
  onAdded,
  label = "Add person",
  askRoles = false,
}: {
  onAdded: (p: PersonDto) => void | Promise<void>;
  label?: string;
  /** Show the owns-accounts and uses-FinShark choices. Without them the person is both. */
  askRoles?: boolean;
}) {
  const [name, setName] = useState("");
  const [ownsAccounts, setOwnsAccounts] = useState(true);
  const [usesApp, setUsesApp] = useState(true);

  const add = useAction(async () => {
    const p = await apiFetch<PersonDto>("/api/people", { method: "POST", body: { displayName: name.trim(), ownsAccounts, usesApp } });
    setName("");
    await onAdded(p);
  });

  const submit = () => {
    if (name.trim() === "") return add.setError("Enter a name.");
    if (!ownsAccounts && !usesApp) return add.setError(NEED_A_ROLE);
    void add.run();
  };

  return (
    <Form onSubmit={submit}>
      <FieldRow align="end">
        <Field label="Name" grow>
          <TextInput value={name} onChange={setName} />
        </Field>
        <Button type="submit" busy={add.busy}>{label}</Button>
      </FieldRow>
      {askRoles && <RoleChecks ownsAccounts={ownsAccounts} usesApp={usesApp} onChange={(o, u) => { setOwnsAccounts(o); setUsesApp(u); }} />}
      <Alert tone="danger">{add.error}</Alert>
    </Form>
  );
}

function RoleChecks({ ownsAccounts, usesApp, onChange }: { ownsAccounts: boolean; usesApp: boolean; onChange: (ownsAccounts: boolean, usesApp: boolean) => void }) {
  return (
    <Inline gap={4}>
      <Checkbox checked={ownsAccounts} onChange={(c) => onChange(c, usesApp)} label="Owns accounts" />
      <Checkbox checked={usesApp} onChange={(c) => onChange(ownsAccounts, c)} label="Uses FinShark" />
    </Inline>
  );
}

function YesNo({ yes }: { yes: boolean }) {
  return yes ? <>Yes</> : <Text tone="muted">No</Text>;
}

function PersonRow({ person, current, onChanged }: { person: PersonDto; current: boolean; onChanged: () => Promise<void> }) {
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [ownsAccounts, setOwnsAccounts] = useState(person.ownsAccounts);
  const [usesApp, setUsesApp] = useState(person.usesApp);

  const save = useAction(async () => {
    await mutate(() => apiFetch<PersonDto>(`/api/people/${person.id}/roles`, { method: "PUT", body: { ownsAccounts, usesApp } }));
    await onChanged();
  });

  const startEdit = () => {
    setOwnsAccounts(person.ownsAccounts);
    setUsesApp(person.usesApp);
    save.setError(null);
    setEditing(true);
  };
  const submit = async () => {
    if (!ownsAccounts && !usesApp) return save.setError(NEED_A_ROLE);
    if (await save.run()) setEditing(false);
  };

  return (
    <Tr>
      <Td>
        <DataText>{person.displayName}</DataText>
        {current && <Text tone="muted"> (using FinShark now)</Text>}
        {editing ? (
          <Inline gap={2}>
            <Button size="sm" onClick={() => void submit()} busy={save.busy}>Save</Button>
            <Button size="sm" onClick={() => setEditing(false)} disabled={save.busy}>Cancel</Button>
            <Alert tone="danger">{save.error}</Alert>
          </Inline>
        ) : (
          <RowAction onClick={startEdit}>Edit</RowAction>
        )}
      </Td>
      {editing ? (
        <Td colSpan={2}>
          <RoleChecks ownsAccounts={ownsAccounts} usesApp={usesApp} onChange={(o, u) => { setOwnsAccounts(o); setUsesApp(u); }} />
        </Td>
      ) : (
        <>
          <Td><YesNo yes={person.ownsAccounts} /></Td>
          <Td><YesNo yes={person.usesApp} /></Td>
        </>
      )}
    </Tr>
  );
}

export function PeoplePage({ people, personId, onAdded }: { people: PersonDto[]; personId: string; onAdded: () => Promise<void> }) {
  return (
    <Page eyebrow="Household" title="People">
      <Text as="p">
        <Text weight="semibold">Owns accounts</Text>: can be the owner of an account, or the person a number such as W-2 wages
        belongs to. <Text weight="semibold">Uses FinShark</Text>: can be chosen as the person using the app. FinShark records
        who did what; it is not a password, and everyone sees everything.
      </Text>
      <Table aria-label="People">
        <TableHead>
          <Tr><Th>Name</Th><Th>Owns accounts</Th><Th>Uses FinShark</Th></Tr>
        </TableHead>
        <TableBody>
          {people.map((p) => <PersonRow key={p.id} person={p} current={String(p.id) === personId} onChanged={onAdded} />)}
        </TableBody>
      </Table>
      <Panel title="Add a person">
        <AddPersonForm onAdded={onAdded} askRoles />
      </Panel>
    </Page>
  );
}
