import { useState } from "react";
import type { PersonDto } from "@finshark/shared";
import { createPerson, renamePerson, setPersonRoles } from "./people.ts";
import { useAction } from "./ui.tsx";
import { Alert, Button, DataText, Field, FieldRow, Form, Heading, Inline, Page, Stack, Text, TextInput } from "./ds/index.ts";

/** One app user: choose them, or edit them in place (rename, or remove them as an app user). */
function UserRow({ person, onChoose, onChanged }: { person: PersonDto; onChoose: () => void; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.displayName);
  const save = useAction(async () => {
    const next = name.trim();
    if (next === "") throw new Error("Enter a name.");
    if (next !== person.displayName) {
      await renamePerson(person.id, next);
      await onChanged();
    }
    setEditing(false);
  });
  // The person stays in history and as an owner; only app use is turned off (DESIGN D13, D16).
  const remove = useAction(async () => {
    await setPersonRoles(person.id, { ownsAccounts: person.ownsAccounts, usesApp: false });
    await onChanged();
  });
  const cancel = () => {
    setEditing(false);
    save.setError(null);
  };

  if (editing) {
    return (
      <Stack gap={2}>
        <Inline gap={2} align="end">
          <Field label="Name" grow>
            <TextInput value={name} onChange={setName} onEnter={() => void save.run()} autoFocus />
          </Field>
          <Button size="sm" variant="primary" onClick={() => void save.run()} busy={save.busy}>Save</Button>
          <Button size="sm" onClick={cancel} disabled={save.busy || remove.busy}>Cancel</Button>
          {person.ownsAccounts && (
            <Button size="sm" variant="danger" onClick={() => void remove.run()} busy={remove.busy} disabled={save.busy}>Remove</Button>
          )}
        </Inline>
        {!person.ownsAccounts && <Text size="sm" tone="muted">They can't be removed: they have history, and don't own any accounts.</Text>}
        <Alert tone="danger">{save.error}</Alert>
        <Alert tone="danger">{remove.error}</Alert>
      </Stack>
    );
  }
  return (
    <Inline gap={2}>
      <Button onClick={onChoose}><DataText>{person.displayName}</DataText></Button>
      <Button variant="link" size="sm" onClick={() => { setName(person.displayName); setEditing(true); }}>Edit</Button>
    </Inline>
  );
}

/** "Who's using FinShark?": app users are chosen, renamed, and added here (DESIGN D16). */
export function WhoIsUsing({
  people,
  onChosen,
  onChanged,
}: {
  people: PersonDto[];
  /** Persist the choice as the acting person. */
  onChosen: (person: PersonDto) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const users = people.filter((p) => p.usesApp);

  const choose = useAction((p: PersonDto) => onChosen(p));
  const add = useAction(async () => {
    const next = name.trim();
    // A name already in the system (names are unique ignoring case) is that person: turn on app use
    // instead of failing or listing them twice.
    const existing = people.find((x) => x.displayName.toLocaleLowerCase() === next.toLocaleLowerCase());
    // A new household member is both an owner and an app user, the usual case (DESIGN D13).
    const p = existing
      ? existing.usesApp ? existing : await setPersonRoles(existing.id, { ownsAccounts: existing.ownsAccounts, usesApp: true })
      : await createPerson({ displayName: next, ownsAccounts: true, usesApp: true });
    await onChanged();
    await onChosen(p);
  });

  return (
    <Page width="narrow" title="Who's using FinShark?">
      <Text as="p">This records who verifies and changes things. It is not a password.</Text>
      <Stack gap={2}>
        {users.map((p) => <UserRow key={p.id} person={p} onChoose={() => void choose.run(p)} onChanged={onChanged} />)}
      </Stack>
      <Alert tone="danger">{choose.error}</Alert>
      <Heading level={2}>Someone else?</Heading>
      <Form onSubmit={() => { if (name.trim() === "") return add.setError("Enter a name."); void add.run(); }}>
        <FieldRow align="end">
          <Field label="Name" grow>
            <TextInput value={name} onChange={setName} />
          </Field>
          <Button type="submit" busy={add.busy}>Add and continue</Button>
        </FieldRow>
        <Alert tone="danger">{add.error}</Alert>
      </Form>
    </Page>
  );
}
