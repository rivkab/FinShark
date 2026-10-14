import { useState } from "react";
import { PdfViewer, type PdfHighlight, type PdfSelection } from "./PdfViewer.tsx";
import { Cell, Text, Value } from "./Value.tsx";

// Region of "$83,421.17" in sample.pdf (PDF points, unrotated, origin bottom-left).
const EXISTING: PdfHighlight[] = [{ pageNo: 1, rect: [396, 596, 462, 612] }];

export function DemoPage() {
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [highlighted, setHighlighted] = useState(true);

  return (
    <section>
      <h1>Documents</h1>
      <p>
        Demo: drag a rectangle over a number on the sample statement. The page number, the box in PDF points and the text
        under it appear below. The orange box is an existing source region.
      </p>
      <label>
        <input type="checkbox" checked={highlighted} onChange={(e) => setHighlighted(e.target.checked)} /> Show existing
        source region
      </label>
      <PdfViewer source={{ url: "/sample.pdf" }} highlights={highlighted ? EXISTING : []} onSelect={setSelection} />
      <h2>Selection</h2>
      <pre className="selection" data-testid="selection">
        {selection
          ? JSON.stringify({ pageNo: selection.pageNo, rect: selection.rect.map((n) => +n.toFixed(2)), text: selection.text }, null, 2)
          : "Nothing selected yet."}
      </pre>

      <h2>Mixed Hebrew / English cells</h2>
      <table className="data">
        <thead>
          <tr>
            <th>Account</th>
            <th>Label</th>
            <th className="num">Amount</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Example Brokerage ...4821</Cell>
            <Cell>Ending balance</Cell>
            <Cell numeric>
              <Value>$83,421.17</Value>
            </Cell>
            <Cell>
              as of <Value>12/31/2025</Value>
            </Cell>
          </tr>
          <tr>
            <Cell>קרן פנסיה מגדל</Cell>
            <Cell>יתרה לסוף תקופה</Cell>
            <Cell numeric>
              <Value>₪42,318.00</Value>
            </Cell>
            <Cell>
              נכון ל-<Value>31/12/2025</Value>
            </Cell>
          </tr>
          <tr>
            <Cell>
              <Text>בנק לאומי</Text> checking <Value>…9087</Value>
            </Cell>
            <Cell>Interest paid / ריבית</Cell>
            <Cell numeric>
              <Value>₪1,204.33</Value>
            </Cell>
            <Cell>
              <Text>דוח שנתי</Text> (annual report) <Value>2025</Value>
            </Cell>
          </tr>
          <tr>
            <Cell>
              <Text>חשבון חיסכון</Text> <Value>#12-345-678</Value>
            </Cell>
            <Cell>
              <Text>סה"כ הפקדות</Text>
            </Cell>
            <Cell numeric>
              <Value>-₪5,000.00</Value>
            </Cell>
            <Cell>W-2 copy 2 of 3 / עותק 2 מתוך 3</Cell>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
