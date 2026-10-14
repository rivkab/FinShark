# pdf-text-check

Spike for FinShark design §14 D4: do the numbers in our real PDFs, especially
Israeli ones, come out of the PDF's text layer correctly? It uses pdf.js, the same
library the app will use. Runs locally; reads only the files you name; makes no
network requests.

## Setup (once)

    cd spikes/pdf-text-check
    npm install

## Use

1. Open a statement in Preview and pick 3–5 amounts you can see, e.g. an ending
   balance and a deposit total.
2. Run:

       node check.mjs ~/path/to/statement.pdf --summary --find 42,318.55 --find 18,240.00

3. Each `find` line reports one of:

   | Result | Meaning |
   |---|---|
   | `OK (one text item)` | Good: drawing a box around it will read it correctly |
   | `SPLIT across N text items` | Readable, but the app must join pieces |
   | `REVERSED` | Digits come out backwards: needs a fix for this bank's PDFs |
   | `PARTIAL` / `NOT FOUND` | Not readable from the text layer as-is |

   The summary also flags pages with no text layer (scans).

`--summary` prints no text from the document, only counts and the amounts you
typed, so its output is safe to paste back. Without `--summary` it lists every
line containing a number, with positions, which helps when diagnosing a problem.
Add `--page 3` to look at a single page.
