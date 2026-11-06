import { useEffect, useState } from "react";
import type { BackupFileDto, BackupSetupResponse, BackupStatusDto } from "@finshark/shared";
import { api } from "./api.ts";
import { backupCheck, formatBytes, formatWhen } from "./backupView.ts";
import { useAction, useLoad } from "./ui.tsx";
import {
  Alert,
  Button,
  Empty,
  Field,
  FieldRow,
  Form,
  Inline,
  KeyValues,
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
  TextInput,
  Th,
  Tr,
  Value,
} from "./ds/index.ts";

const MIN_PASSPHRASE = 10;

const CHECK_ICON = { success: "check", danger: "cross", warning: "clock", muted: "dash" } as const;

export function BackupsPage() {
  const status = useLoad(() => api.backups.status(), 0);
  const [sheet, setSheet] = useState<BackupSetupResponse | null>(null);
  const s = status.data;

  // While a backup runs, check again every two seconds.
  useEffect(() => {
    if (!s?.running) return;
    const t = setTimeout(() => void status.reload(), 2000);
    return () => clearTimeout(t);
  }, [s, status]);

  if (status.error) return <Page title="Backups"><Alert tone="danger">{status.error}</Alert></Page>;
  if (!s) return <Page title="Backups"><Loading /></Page>;

  return (
    <Page title="Backups" eyebrow="Encrypted copies of this vault">
      <Stack gap={2}>
        {s.warnings.filter((w) => w.code !== "not_set_up").map((w) => (
          <Alert key={w.code} tone="warning">{w.message}</Alert>
        ))}
      </Stack>
      {sheet ? (
        <RecoverySheet sheet={sheet} onConfirmed={(next) => { setSheet(null); status.setData(next); }} />
      ) : !s.setUp ? (
        <SetUp awaiting={s.awaitingConfirmation} onMade={setSheet} />
      ) : (
        <SetUpVault s={s} reload={status.reload} setData={status.setData} />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- setup

function SetUp({ awaiting, onMade }: { awaiting: boolean; onMade: (r: BackupSetupResponse) => void }) {
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const make = useAction(async () => {
    if (pass.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
    if (pass !== again) throw new Error("The two passphrases don't match.");
    onMade(await api.backups.setup({ passphrase: pass }));
  });
  return (
    <Section title="Set up backups">
      <Stack gap={4}>
        {awaiting && (
          <Alert tone="info">
            Setup was started but not finished. The key shown then can't be shown again, so start again; this makes a new key.
          </Alert>
        )}
        <Text as="p">
          FinShark makes a key for this vault. Backups are encrypted with it, so they are safe to keep in a synced folder or on a drive.
          The key is kept in this Mac's Keychain, on a recovery sheet you print, and in a key file next to the backups that opens with a passphrase.
        </Text>
        <Text as="p" tone="muted">
          The passphrase unlocks the key file if this Mac and the recovery sheet are both lost. Choose one you will remember: without the key, the
          backups can't be opened by anyone.
        </Text>
        <Form onSubmit={() => void make.run()}>
          <FieldRow align="end">
            <Field label="Passphrase">
              <TextInput type="password" dir="ltr" value={pass} onChange={setPass} />
            </Field>
            <Field label="Passphrase again">
              <TextInput type="password" dir="ltr" value={again} onChange={setAgain} />
            </Field>
            <Button type="submit" variant="primary" busy={make.busy}>Make the backup key</Button>
          </FieldRow>
        </Form>
        <Alert tone="danger">{make.error}</Alert>
      </Stack>
    </Section>
  );
}

function RecoverySheet({ sheet, onConfirmed }: { sheet: BackupSetupResponse; onConfirmed: (s: BackupStatusDto) => void }) {
  const [last, setLast] = useState("");
  const confirm = useAction(async () => {
    onConfirmed(await api.backups.confirmSetup({ lastChars: last }));
  });
  return (
    <Section title="Recovery sheet" actions={<Button onClick={() => window.print()}>Print</Button>}>
      <Stack gap={4}>
        <Alert tone="warning">
          Print this page and keep it somewhere safe, such as a home safe. It is shown only once. Anyone with this key can open the backups.
        </Alert>
        <Stack gap={1}>
          {sheet.recoverySheet.split("\n").map((line, i) => (
            <Text key={i} as="div" mono size="sm">{line === "" ? " " : line}</Text>
          ))}
        </Stack>
        <Form onSubmit={() => void confirm.run()}>
          <FieldRow align="end">
            <Field label="Last 6 characters of the private key, from the printed sheet">
              <TextInput dir="ltr" value={last} onChange={setLast} maxLength={6} />
            </Field>
            <Button type="submit" variant="primary" busy={confirm.busy}>Finish setup</Button>
          </FieldRow>
        </Form>
        <Alert tone="danger">{confirm.error}</Alert>
      </Stack>
    </Section>
  );
}

// ---------------------------------------------------------------- set up

function SetUpVault({ s, reload, setData }: { s: BackupStatusDto; reload: () => Promise<void>; setData: (d: BackupStatusDto) => void }) {
  const newest = s.files[0] ?? null;
  const backUp = useAction(async () => {
    await api.backups.run();
    await reload();
  });
  return (
    <>
      {!s.keyOnThisMac && <KeyOnThisMac mismatch={s.keyMismatch} setData={setData} />}

      <Section title="Last backup" actions={<Button variant="primary" busy={backUp.busy || s.running} onClick={() => void backUp.run()}>Back up now</Button>}>
        <Stack gap={3}>
          {s.running && <Text tone="muted">A backup is being written...</Text>}
          {newest ? (
            <KeyValues
              items={[
                { label: "Made", value: <Value>{formatWhen(newest.createdAt)}</Value> },
                { label: "Size", value: <Value>{formatBytes(newest.bytes)}</Value> },
                { label: "Checked", value: <Check f={newest} keyOnThisMac={s.keyOnThisMac} /> },
                s.secondDir !== null && {
                  label: "Second folder",
                  value: newest.copiedAt ? <StatusMark tone="success" icon="check">Copied</StatusMark> : <StatusMark tone="warning" icon="cross">{newest.copyError ?? "Not copied"}</StatusMark>,
                },
              ]}
            />
          ) : (
            !s.running && <Empty>No backups yet.</Empty>
          )}
          <Text as="p" tone="muted" size="sm">
            While FinShark is open it backs up when it starts (if the last backup is over a day old or something changed), and 10 minutes after the last change.
            It keeps one backup a day for a week, one a week for 8 weeks and one a month for 2 years.
          </Text>
          <Alert tone="danger">{backUp.error}</Alert>
        </Stack>
      </Section>

      <SecondFolder s={s} setData={setData} />

      <Section title="All backups">
        {s.files.length === 0 ? (
          <Empty>No backups yet.</Empty>
        ) : (
          <Table aria-label="Backups, newest first">
            <TableHead>
              <Tr>
                <Th>Made</Th>
                <Th align="end">Size</Th>
                <Th>Checked</Th>
                <Th>{null}</Th>
              </Tr>
            </TableHead>
            <TableBody>
              {s.files.map((f) => (
                <BackupRow key={f.name} f={f} keyOnThisMac={s.keyOnThisMac} reload={reload} />
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Restore">
        <Stack gap={2}>
          <Text as="p">
            A backup is restored into a new folder, never over this vault. In a terminal in the FinShark folder, run:
          </Text>
          <Value>npm run restore -- &lt;backup file&gt; &lt;new folder&gt;</Value>
          <Text as="p" tone="muted" size="sm">
            It uses the key in this Mac's Keychain, or asks for the passphrase of the key file next to the backup. Then start FinShark on the new folder with
            FINSHARK_VAULT. Verifying a backup already checks that it restores.
          </Text>
        </Stack>
      </Section>
    </>
  );
}

function Check({ f, keyOnThisMac }: { f: BackupFileDto; keyOnThisMac: boolean }) {
  const c = backupCheck(f, keyOnThisMac);
  return (
    <Stack gap={1}>
      <StatusMark tone={c.tone} icon={CHECK_ICON[c.tone]}>{c.label}</StatusMark>
      {f.problems.map((p, i) => <Text key={i} as="div" size="sm" tone="muted">{p.message}</Text>)}
      {f.vaultWarnings.map((p, i) => <Text key={`v${i}`} as="div" size="sm" tone="muted">Vault check: {p.message}</Text>)}
    </Stack>
  );
}

function BackupRow({ f, keyOnThisMac, reload }: { f: BackupFileDto; keyOnThisMac: boolean; reload: () => Promise<void> }) {
  const verify = useAction(async () => {
    await api.backups.verify(f.name);
    await reload();
  });
  return (
    <Tr>
      <Td><Value>{formatWhen(f.createdAt)}</Value></Td>
      <Td align="end"><Value>{formatBytes(f.bytes)}</Value></Td>
      <Td>
        <Stack gap={1}>
          <Check f={f} keyOnThisMac={keyOnThisMac} />
          {verify.error && <Text size="sm" tone="danger">{verify.error}</Text>}
        </Stack>
      </Td>
      <Td>{keyOnThisMac && <Button size="sm" busy={verify.busy} onClick={() => void verify.run()}>Verify</Button>}</Td>
    </Tr>
  );
}

// ---------------------------------------------------------------- key on this Mac, second folder

function KeyOnThisMac({ mismatch, setData }: { mismatch: boolean; setData: (d: BackupStatusDto) => void }) {
  const [pass, setPass] = useState("");
  const [key, setKey] = useState("");
  const send = (body: { passphrase: string } | { identity: string }) =>
    api.backups.importKey(body).then(setData);
  const byPass = useAction(() => send({ passphrase: pass }));
  const byKey = useAction(() => send({ identity: key }));
  return (
    <Section title="Use this vault's key on this Mac">
      <Stack gap={4}>
        <Alert tone="info">
          {mismatch
            ? "The key in this Mac's Keychain belongs to a different vault or an earlier setup."
            : "This Mac doesn't have the backup key."}{" "}
          Backups are still made, but they can't be verified here until the key is added. Use the key file's passphrase, or the key from the recovery sheet.
        </Alert>
        <Form onSubmit={() => void byPass.run()}>
          <FieldRow align="end">
            <Field label="Passphrase of the key file">
              <TextInput type="password" dir="ltr" value={pass} onChange={setPass} />
            </Field>
            <Button type="submit" busy={byPass.busy}>Use the key file</Button>
          </FieldRow>
        </Form>
        <Alert tone="danger">{byPass.error}</Alert>
        <Form onSubmit={() => void byKey.run()}>
          <FieldRow align="end">
            <Field label="Private key from the recovery sheet">
              <TextInput type="password" dir="ltr" value={key} onChange={setKey} placeholder="AGE-SECRET-KEY-1..." />
            </Field>
            <Button type="submit" busy={byKey.busy}>Use this key</Button>
          </FieldRow>
        </Form>
        <Alert tone="danger">{byKey.error}</Alert>
      </Stack>
    </Section>
  );
}

function SecondFolder({ s, setData }: { s: BackupStatusDto; setData: (d: BackupStatusDto) => void }) {
  const [dir, setDir] = useState(s.secondDir ?? "");
  const save = useAction((p: string | null) =>
    api.backups.setSecondFolder({ path: p }).then((next) => {
      setData(next);
      setDir(next.secondDir ?? "");
    }),
  );
  const choose = useAction(async () => {
    const next = await api.backups.chooseSecondFolder();
    setData(next);
    setDir(next.secondDir ?? "");
  });
  return (
    <Section title="Second folder">
      <Stack gap={3}>
        <Text as="p" tone="muted">
          Each backup is also copied to this folder, for example a folder in iCloud Drive or Dropbox, so a copy leaves this Mac. The files are encrypted
          before they get there; FinShark never uploads anything itself.
        </Text>
        {s.secondDir !== null && s.secondDirProblem && <Alert tone="warning">{s.secondDirProblem}</Alert>}
        <Form onSubmit={() => void save.run(dir.trim() === "" ? null : dir.trim())}>
          <FieldRow align="end">
            <Field label="Folder (full path)">
              <TextInput dir="ltr" value={dir} onChange={setDir} placeholder="/Users/you/Library/Mobile Documents/com~apple~CloudDocs/FinShark backups" />
            </Field>
            <Button type="submit" busy={save.busy}>Save</Button>
            {s.canChooseFolder && <Button busy={choose.busy} onClick={() => void choose.run()}>Choose...</Button>}
            {s.secondDir !== null && <Button variant="ghost" onClick={() => void save.run(null)}>Stop copying</Button>}
          </FieldRow>
        </Form>
        <Alert tone="danger">{save.error ?? choose.error}</Alert>
        {choose.busy && <Text tone="muted" size="sm">Choose the folder in the window that opened (it may be behind the browser).</Text>}
        {s.secondDir === null && <Inline><Text tone="muted" size="sm">No second folder: backups stay on this Mac only.</Text></Inline>}
      </Stack>
    </Section>
  );
}
