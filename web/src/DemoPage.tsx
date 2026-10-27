import { useState } from "react";
import { PdfViewer, type PdfHighlight, type PdfSelection } from "./pdf/PdfViewer.tsx";
import { Checkbox, DataText, KeyValues, Page, Panel, Section, Stack, Table, TableBody, TableHead, Td, Text, Th, Tr, Value } from "./ds/index.ts";

// Region of "$83,421.17" in sample.pdf (PDF points, unrotated, origin bottom-left).
const EXISTING: PdfHighlight[] = [{ pageNo: 1, rect: [396, 596, 462, 612] }];

export function DemoPage() {
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [highlighted, setHighlighted] = useState(true);

  return (
    <Page title="Viewer demo">
      <Stack gap={5}>
        <Text as="p">
          Demo: drag a rectangle over a number on the sample statement. The page number, the box in PDF points and the text
          under it appear below. The orange box is an existing source region.
        </Text>
        <Checkbox checked={highlighted} onChange={setHighlighted} label="Show existing source region" />
        <PdfViewer source={{ url: "/sample.pdf" }} highlights={highlighted ? EXISTING : []} onSelect={setSelection} />
      </Stack>
      <Section title="Selection">
        <Panel>
          {selection ? (
            <KeyValues
              items={[
                { label: "pageNo", value: <Value>{String(selection.pageNo)}</Value> },
                { label: "rect", value: <Value>{selection.rect.map((n) => n.toFixed(2)).join(", ")}</Value> },
                { label: "text", value: <DataText>{selection.text}</DataText> },
              ]}
            />
          ) : (
            <Text as="div">Nothing selected yet.</Text>
          )}
        </Panel>
      </Section>
      <Section title="Mixed Hebrew / English cells">
        <Table aria-label="Mixed Hebrew and English cells">
          <TableHead>
            <Tr>
              <Th>Account</Th>
              <Th>Label</Th>
              <Th align="end">Amount</Th>
              <Th>Note</Th>
            </Tr>
          </TableHead>
          <TableBody>
            <Tr>
              <Td>Example Brokerage ...4821</Td>
              <Td>Ending balance</Td>
              <Td align="end"><Value>$83,421.17</Value></Td>
              <Td>as of <Value>12/31/2025</Value></Td>
            </Tr>
            <Tr>
              <Td><DataText>קרן פנסיה מגדל</DataText></Td>
              <Td><DataText>יתרה לסוף תקופה</DataText></Td>
              <Td align="end"><Value>₪42,318.00</Value></Td>
              <Td><DataText>נכון ל-</DataText><Value>31/12/2025</Value></Td>
            </Tr>
            <Tr>
              <Td><DataText>בנק לאומי</DataText> checking <Value>…9087</Value></Td>
              <Td>Interest paid / <DataText>ריבית</DataText></Td>
              <Td align="end"><Value>₪1,204.33</Value></Td>
              <Td><DataText>דוח שנתי</DataText> (annual report) <Value>2025</Value></Td>
            </Tr>
            <Tr>
              <Td><DataText>חשבון חיסכון</DataText> <Value>#12-345-678</Value></Td>
              <Td><DataText>סה"כ הפקדות</DataText></Td>
              <Td align="end"><Value>-₪5,000.00</Value></Td>
              <Td>W-2 copy 2 of 3 / <DataText>עותק 2 מתוך 3</DataText></Td>
            </Tr>
          </TableBody>
        </Table>
      </Section>
    </Page>
  );
}
