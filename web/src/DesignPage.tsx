import { useState } from "react";
import {
  Alert,
  AppHeader,
  Avatar,
  Badge,
  Brand,
  Button,
  Checkbox,
  Combobox,
  DataText,
  DateInput,
  Disclosure,
  Dropzone,
  Empty,
  Field,
  FieldGroup,
  FieldRow,
  Form,
  Heading,
  Inline,
  KeyValues,
  Kbd,
  Link,
  LinkButton,
  List,
  ListItem,
  Loading,
  Modal,
  NavTabs,
  Page,
  Panel,
  RowAction,
  Section,
  Select,
  SplitLayout,
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
  Timeline,
  TimelineItem,
  Tr,
  UserChip,
  Value,
} from "./ds/index.ts";
import { AccountName, DocStatusBadge, StatusBadge } from "./ui.tsx";

const CONCEPTS = ["Ending balance", "Interest paid", "Total deposits", "יתרה לסוף תקופה"];

const NAV_ITEMS = [
  { label: "Accounts", href: "#/design", active: false },
  { label: "Documents", href: "#/design", active: true, count: 3 },
  { label: "Facts", href: "#/design", active: false },
  { label: "People", href: "#/design", active: false },
];

/** Every primitive and variant with fake data. Open it at #/design. */
export function DesignPage() {
  return (
    <Page eyebrow="Design system" title="Gallery" actions={<Button variant="primary">Primary action</Button>}>
      <Typography />
      <Chrome />
      <Actions />
      <Forms />
      <Feedback />
      <DataDisplay />
      <Layout />
    </Page>
  );
}

function Typography() {
  return (
    <Section title="Typography">
      <Stack gap={4}>
        <Heading level={1}>Display heading</Heading>
        <Heading level={2}>Section heading</Heading>
        <Heading level={3}>Subsection heading</Heading>
        <Heading level={4}>Label heading</Heading>
        <Stack gap={1}>
          <Text as="p" size="lg">Large body text</Text>
          <Text as="p">Body text with <Text weight="semibold">semibold</Text> and <Text weight="medium">medium</Text> spans.</Text>
          <Text as="p" size="sm" tone="muted">Small muted text</Text>
          <Text as="p" size="xs" tone="subtle">Extra small subtle text</Text>
          <Text as="p" eyebrow>Eyebrow text</Text>
          <Text as="p" tone="success">Success tone</Text>
          <Text as="p" tone="warning">Warning tone</Text>
          <Text as="p" tone="danger">Danger tone</Text>
          <Text as="p" mono>IL12 3456 7890 1234</Text>
        </Stack>
        <Inline gap={4} align="baseline">
          <Value size="sm">₪41,330.00</Value>
          <Value>$12,480.15</Value>
          <Value size="lg">€1,204.33</Value>
          <Value tone="muted">31/12/2025</Value>
          <Kbd>Enter</Kbd>
        </Inline>
        <DataText block>{"Hebrew note: חשבון עו״ש בבנק הגליל\nSecond line of the same note"}</DataText>
      </Stack>
    </Section>
  );
}

function Chrome() {
  return (
    <Section title="App chrome">
      <Stack gap={4}>
        <AppHeader brand={<Brand />} nav={<NavTabs items={NAV_ITEMS} />} user={<UserChip name="Dana Levi" onSwitch={() => undefined} />} />
        <Inline gap={3}>
          <Avatar name="Dana Levi" />
          <Avatar name="Noam" />
        </Inline>
      </Stack>
    </Section>
  );
}

function Actions() {
  return (
    <Section title="Actions">
      <Stack gap={5}>
        <Inline gap={3}>
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link button</Button>
          <Button variant="primary" busy>Busy</Button>
          <Button disabled>Disabled</Button>
          <Button icon="upload">With icon</Button>
        </Inline>
        <Inline gap={3}>
          <Button variant="primary" size="sm">Primary sm</Button>
          <Button size="sm">Secondary sm</Button>
          <Button variant="ghost" size="sm">Ghost sm</Button>
          <Button variant="danger" size="sm">Danger sm</Button>
        </Inline>
        <Inline gap={3}>
          <LinkButton href="#/design" variant="primary">Link as primary</LinkButton>
          <LinkButton href="#/design">Link as secondary</LinkButton>
        </Inline>
        <Inline gap={4}>
          <Link href="#/design">Default link</Link>
          <Link href="#/design" tone="muted">Muted link</Link>
          <Link href="#/design" tone="warning">Warning link</Link>
        </Inline>
      </Stack>
    </Section>
  );
}

function Forms() {
  const [name, setName] = useState("בנק הגליל");
  const [date, setDate] = useState("2025-12-31");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState("");
  const [group, setGroup] = useState("b");
  const [owners, setOwners] = useState({ dana: true, noam: false });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const items = CONCEPTS.filter((c) => c.toLowerCase().includes(query.toLowerCase()));

  return (
    <Section title="Forms">
      <Form onSubmit={() => undefined} gap={5}>
        <FieldRow>
          <Field label="Name" grow hint="Hebrew or English">
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field label="Statement date">
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Kind">
            <Select
              value={kind}
              onChange={setKind}
              placeholder="Choose..."
              options={[
                { value: "checking", label: "Checking" },
                { value: "he", label: "חשבון חיסכון", dir: "auto" },
              ]}
            />
          </Field>
        </FieldRow>
        <Field label="Grouped select">
          <Select
            value={group}
            onChange={setGroup}
            groups={[
              { label: "This institution", options: [{ value: "a", label: "חשבון עו״ש · בנק הגליל · ILS", dir: "auto" }] },
              { label: "Other accounts", options: [{ value: "b", label: "Example Brokerage ...4821 · USD" }] },
            ]}
          />
        </Field>
        <Field label="With an error" error="This field is required">
          <TextInput value="" onChange={() => undefined} placeholder="Placeholder" />
        </Field>
        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} />
        </Field>
        <FieldGroup label="Owners">
          <Checkbox checked={owners.dana} onChange={(v) => setOwners({ ...owners, dana: v })} label="Dana" />
          <Checkbox checked={owners.noam} onChange={(v) => setOwners({ ...owners, noam: v })} label="Noam" />
        </FieldGroup>
        <Field label="Combobox">
          <Combobox
            inputValue={open ? query : (picked ?? "")}
            onInputChange={setQuery}
            open={open}
            onOpenChange={setOpen}
            items={items}
            getKey={(c) => c}
            renderItem={(c) => <DataText>{c}</DataText>}
            onPick={(c) => {
              setPicked(c);
              setQuery("");
            }}
            placeholder="Search, e.g. balance, יתרה"
            aria-label="Kind of number"
          />
        </Field>
        <Inline>
          <Button type="submit" variant="primary">Save</Button>
          <Button>Cancel</Button>
        </Inline>
      </Form>
    </Section>
  );
}

function Feedback() {
  return (
    <Section title="Feedback">
      <Stack gap={4}>
        <Alert tone="danger">Could not save: the server said no.</Alert>
        <Alert tone="warning">An account with this number already exists: חשבון עו״ש (בנק הגליל).</Alert>
        <Alert tone="success">Saved.</Alert>
        <Alert tone="info">Nothing changed.</Alert>
        <Inline gap={2}>
          <Badge tone="neutral">neutral</Badge>
          <Badge tone="success">success</Badge>
          <Badge tone="warning">warning</Badge>
          <Badge tone="danger">danger</Badge>
          <Badge tone="muted">muted</Badge>
          <Badge tone="warning" count>3</Badge>
        </Inline>
        <Inline gap={4}>
          <StatusMark tone="success" icon="check">verified · 30 Sep</StatusMark>
          <StatusMark tone="warning" icon="clock">proposed</StatusMark>
          <StatusMark tone="danger" icon="cross">rejected</StatusMark>
          <StatusMark tone="muted" icon="dash">replaced</StatusMark>
        </Inline>
        <Inline gap={2}>
          <StatusBadge status="verified" />
          <StatusBadge status="proposed" />
          <StatusBadge status="rejected" />
          <StatusBadge status="superseded" />
          <DocStatusBadge status="inbox" />
          <DocStatusBadge status="reviewed" />
        </Inline>
        <Empty>No documents yet.</Empty>
        <Loading />
      </Stack>
    </Section>
  );
}

function DataDisplay() {
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [current, setCurrent] = useState("one");
  const rows = [
    { name: "חשבון עו״ש", inst: "בנק הגליל", amount: "₪41,330.00", note: "נכון ל-31/12/2025" },
    { name: "Example Brokerage ...4821", inst: "Example Brokerage", amount: "$12,480.15", note: "as of 12/31/2025" },
    { name: "חשבון חיסכון", inst: "בנק הגליל", amount: "₪5,000.00", note: "Interest paid / ריבית" },
  ];
  const sorted = sort === "asc" ? rows : [...rows].reverse();

  return (
    <Section title="Data display">
      <Stack gap={6}>
        <StatGroup>
          <Stat label="Accounts" value="12" note="3 institutions" />
          <Stat label="Net balance" value={<Value size="lg">$12,480.15</Value>} note="converted" />
          <Stat label="Not verified" value="7" tone="warning" href="#/design" note="Review them" />
        </StatGroup>
        <Table aria-label="Mixed Hebrew and English accounts">
          <TableHead>
            <Tr>
              <Th sort={sort} onSort={() => setSort(sort === "asc" ? "desc" : "asc")}>Account</Th>
              <Th>Institution</Th>
              <Th align="end">Amount</Th>
              <Th>Note</Th>
            </Tr>
          </TableHead>
          <TableBody>
            {sorted.map((r) => (
              <Tr key={r.name}>
                <Td>
                  <RowAction onClick={() => undefined}>Edit</RowAction>
                  <AccountName account={{ displayName: r.name, altName: r.name === "חשבון עו״ש" ? "Checking" : null }} />
                </Td>
                <Td><DataText>{r.inst}</DataText></Td>
                <Td align="end">
                  <Stack gap={1} align="end">
                    <Value>{r.amount}</Value>
                    <StatusMark tone="success" icon="check">verified · 30 Sep</StatusMark>
                  </Stack>
                </Td>
                <Td><DataText>{r.note}</DataText></Td>
              </Tr>
            ))}
            <Tr>
              <Td>Total deposits</Td>
              <Td>-</Td>
              <Td align="end">
                <Stack gap={1} align="end">
                  <Value>₪1,204.33</Value>
                  <StatusMark tone="warning" icon="clock">proposed</StatusMark>
                </Stack>
              </Td>
              <Td>Awaiting review</Td>
            </Tr>
            <Tr tone="muted">
              <Td>Replaced value</Td>
              <Td>-</Td>
              <Td align="end">
                <Stack gap={1} align="end">
                  <Value>₪900.00</Value>
                  <StatusMark tone="muted" icon="dash">replaced</StatusMark>
                </Stack>
              </Td>
              <Td>Muted row</Td>
            </Tr>
          </TableBody>
        </Table>
        <KeyValues
          items={[
            { label: "Institution", value: <DataText>בנק הגליל</DataText> },
            { label: "Currency", value: <Value>ILS</Value> },
            false,
            { label: "Opened", value: <Value>01/03/2019</Value> },
          ]}
        />
        <Inline gap={6} align="start">
          <List divided>
            <ListItem current={current === "one"} onClick={() => setCurrent("one")}>First item (button)</ListItem>
            <ListItem current={current === "two"} onClick={() => setCurrent("two")}>Second item (button)</ListItem>
            <ListItem title="With a title">Plain item</ListItem>
          </List>
          <Timeline>
            <TimelineItem time="30 Sep 2026">Verified by Dana</TimelineItem>
            <TimelineItem time="29 Sep 2026">Proposed from page 2</TimelineItem>
          </Timeline>
        </Inline>
        <Dropzone onFiles={() => undefined} accept="application/pdf" multiple prompt="Drop PDF statements here" buttonLabel="Choose files" />
      </Stack>
    </Section>
  );
}

function Layout() {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  return (
    <Section title="Layout" actions={<Button size="sm" onClick={() => setModal(true)}>Open modal</Button>}>
      <Stack gap={5}>
        <Panel title="Panel" actions={<Button size="sm">Action</Button>}>
          <Text as="p">Panel content on the raised ground.</Text>
        </Panel>
        <Disclosure summary="Disclosure" meta="3 items" open={open} onToggle={setOpen}>
          <Text as="p">Hidden until opened.</Text>
        </Disclosure>
        <SplitLayout
          main={<Panel title="Main"><Text as="p">Main column.</Text></Panel>}
          aside={<Panel title="Aside"><Text as="p">Sticky aside.</Text></Panel>}
        />
      </Stack>
      {modal && (
        <Modal label="Example dialog">
          <Stack gap={4}>
            <Heading level={3}>Example dialog</Heading>
            <Text as="p">Dialogs sit over a scrim and carry the only large shadow.</Text>
            <Inline justify="end">
              <Button variant="primary" onClick={() => setModal(false)}>Close</Button>
            </Inline>
          </Stack>
        </Modal>
      )}
    </Section>
  );
}
