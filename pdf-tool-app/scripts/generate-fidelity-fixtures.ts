/**
 * A-4 fixtures: form-all-fields.pdf (every AcroForm field type) and annotations-markup.pdf (markup annotations with
 * appearance streams plus one form field). Deterministic (fixed dates, no object streams).
 *
 * Appends/updates entries in manifest.json and fixes annotated.pdf's hasAnnotations flag (it has no /Annots: its
 * "highlight" is a drawn rectangle). It does NOT regenerate the older corpus, so existing sha256 values stay valid.
 * Run: npx tsx scripts/generate-fidelity-fixtures.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, StandardFonts } from "pdf-lib";

const CORPUS_DIR = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const FIXED = new Date("2026-01-01T00:00:00Z");

function newDoc() {
  return PDFDocument.create({ updateMetadata: false }).then((d) => {
    d.setCreationDate(FIXED);
    d.setModificationDate(FIXED);
    d.setProducer("LayahTools corpus");
    d.setCreator("LayahTools corpus");
    return d;
  });
}

/** Form XObject appearance stream with a bounding box and content operators. */
function appearance(doc: PDFDocument, w: number, h: number, ops: string): PDFRef {
  const stream = doc.context.stream(ops, { Type: "XObject", Subtype: "Form", BBox: [0, 0, w, h] });
  return doc.context.register(stream);
}

type Rect = [number, number, number, number];
function addAnnot(doc: PDFDocument, pageIndex: number, dict: Record<string, unknown>, rect: Rect, ap?: string): PDFRef {
  const page = doc.getPage(pageIndex);
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  const entries: Record<string, unknown> = { Type: "Annot", Rect: rect, F: 4, P: page.ref, ...dict };
  if (ap !== undefined) entries.AP = { N: appearance(doc, w, h, ap) };
  const ref = doc.context.register(doc.context.obj(entries as never));
  let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) {
    annots = doc.context.obj([]);
    page.node.set(PDFName.of("Annots"), annots);
  }
  annots.push(ref);
  return ref;
}

/** PDF text string (pdf-lib's obj() would turn a JS string into a name). */
const S = (t: string) => PDFString.of(t);
const quad = (r: Rect) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]];

async function buildFormAllFields(): Promise<Uint8Array> {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Fidelity form: every field type", { x: 50, y: 790, size: 16, font });
  const form = doc.getForm();
  const label = (t: string, y: number) => page.drawText(t, { x: 50, y: y + 6, size: 10, font });

  label("Full name", 740);
  const name = form.createTextField("t.name");
  name.addToPage(page, { x: 200, y: 735, width: 250, height: 22 });

  label("Comments (multiline)", 690);
  const comments = form.createTextField("t.comments");
  comments.enableMultiline();
  comments.addToPage(page, { x: 200, y: 660, width: 250, height: 52 });
  comments.setFontSize(10); // pdf-lib sizes the default appearance to the box (44 pt) otherwise; needs the /DA that addToPage creates

  label("Code (max 5)", 630);
  const code = form.createTextField("t.code");
  code.setMaxLength(5);
  code.addToPage(page, { x: 200, y: 625, width: 100, height: 22 });

  label("Subscribe", 590);
  const sub = form.createCheckBox("c.subscribe");
  sub.addToPage(page, { x: 200, y: 585, width: 18, height: 18 });

  label("Plan", 550);
  const plan = form.createRadioGroup("r.plan");
  plan.addOptionToPage("free", page, { x: 200, y: 545, width: 16, height: 16 });
  plan.addOptionToPage("pro", page, { x: 240, y: 545, width: 16, height: 16 });
  plan.addOptionToPage("team", page, { x: 280, y: 545, width: 16, height: 16 });

  label("Country", 510);
  const country = form.createDropdown("d.country");
  country.addOptions(["India", "Germany", "Brazil"]);
  country.addToPage(page, { x: 200, y: 505, width: 150, height: 22 });

  label("Interests", 440);
  const interests = form.createOptionList("o.interests");
  interests.addOptions(["Reading", "Music", "Sport", "Travel"]);
  interests.enableMultiselect();
  interests.addToPage(page, { x: 200, y: 400, width: 150, height: 70 });

  label("Reference (read-only)", 360);
  const ref = form.createTextField("t.reference");
  ref.setText("REF-0001");
  ref.enableReadOnly();
  ref.addToPage(page, { x: 200, y: 355, width: 150, height: 22 });

  const button = form.createButton("b.submit");
  button.addToPage("Submit", page, { x: 200, y: 310, width: 100, height: 26 });

  // Signature field: pdf-lib can read but not create one, so build the dictionary directly.
  const sig = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: S("s.signature"),
      F: 4,
      Rect: [200, 250, 400, 290],
      P: page.ref,
    }),
  );
  const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
  annots.push(sig);
  form.acroForm.addField(sig);

  return doc.save({ useObjectStreams: false });
}

async function buildAnnotationsMarkup(): Promise<Uint8Array> {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  p1.drawText("Annotated markup fixture", { x: 50, y: 790, size: 16, font });
  const lines = [
    ["Highlighted sentence about browser-first PDF processing.", 740],
    ["Underlined sentence about deterministic operations.", 700],
    ["Struck-through sentence that was withdrawn.", 660],
  ] as const;
  for (const [t, y] of lines) p1.drawText(t, { x: 50, y, size: 12, font });
  p1.drawText("A sticky note and a freehand mark sit below.", { x: 50, y: 620, size: 12, font });
  p2.drawText("Page two: a second highlight on an unrelated page.", { x: 50, y: 740, size: 12, font });

  const hl: Rect = [48, 736, 360, 754];
  addAnnot(doc, 0, { Subtype: "Highlight", NM: S("hl-1"), C: [1, 1, 0], QuadPoints: quad(hl), Contents: S("important") }, hl, "1 1 0 rg 0 0 312 18 re f");
  const ul: Rect = [48, 696, 330, 714];
  addAnnot(doc, 0, { Subtype: "Underline", NM: S("ul-1"), C: [0, 0.6, 0], QuadPoints: quad(ul) }, ul, "0 0.6 0 RG 1 w 0 2 m 282 2 l S");
  const so: Rect = [48, 656, 300, 674];
  addAnnot(doc, 0, { Subtype: "StrikeOut", NM: S("so-1"), C: [1, 0, 0], QuadPoints: quad(so) }, so, "1 0 0 RG 1 w 0 9 m 252 9 l S");

  const note = addAnnot(
    doc,
    0,
    { Subtype: "Text", NM: S("note-1"), Name: "Comment", Contents: S("Check this claim"), C: [1, 0.8, 0], Open: false },
    [400, 600, 420, 620],
    "1 0.8 0 rg 0 0 20 20 re f",
  );
  const popup = addAnnot(doc, 0, { Subtype: "Popup", NM: S("popup-1"), Parent: note, Open: false, F: 28 }, [430, 520, 560, 620]);
  (doc.context.lookup(note, PDFDict)).set(PDFName.of("Popup"), popup);

  addAnnot(
    doc,
    0,
    { Subtype: "Ink", NM: S("ink-1"), C: [0, 0, 1], InkList: [[60, 560, 90, 580, 120, 560, 150, 580]], BS: { W: 2 } },
    [55, 555, 155, 585],
    "0 0 1 RG 2 w 5 5 m 35 25 l 65 5 l 95 25 l S",
  );
  addAnnot(
    doc,
    0,
    { Subtype: "FreeText", NM: S("ft-1"), Contents: S("Free text box"), DA: "/Helv 10 Tf 0 g", C: [1, 1, 1] },
    [200, 540, 330, 580],
    "1 1 1 rg 0 0 130 40 re f 0 0 0 RG 0.5 w 0.25 0.25 129.5 39.5 re S",
  );
  addAnnot(
    doc,
    0,
    { Subtype: "Square", NM: S("sq-1"), C: [0.5, 0, 0.5], BS: { W: 1 } },
    [350, 540, 430, 580],
    "0.5 0 0.5 RG 1 w 0.5 0.5 79 39 re S",
  );
  addAnnot(doc, 0, { Subtype: "Link", NM: S("link-1"), Border: [0, 0, 0], A: { S: "URI", URI: S("https://example.com/") } }, [50, 736, 200, 754]);

  const hl2: Rect = [48, 736, 380, 754];
  addAnnot(doc, 1, { Subtype: "Highlight", NM: S("hl-2"), C: [0.6, 1, 0.6], QuadPoints: quad(hl2) }, hl2, "0.6 1 0.6 rg 0 0 332 18 re f");

  // One form field so a single file mixes widgets and markup (used by the flatten tests).
  p1.drawText("Reviewer:", { x: 50, y: 500, size: 12, font });
  const field = doc.getForm().createTextField("reviewer.name");
  field.setText("A. Reviewer");
  field.addToPage(p1, { x: 120, y: 492, width: 200, height: 22 });

  return doc.save({ useObjectStreams: false });
}

/** Annotation kinds not in annotations-markup.pdf, with author (/T), opacity (/CA), border (/BS) and date (/M) set. */
async function buildAnnotationsMatrix(): Promise<Uint8Array> {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [doc.addPage([595, 842]), doc.addPage([595, 842]), doc.addPage([595, 842])];
  pages.forEach((pg, i) => pg.drawText(`Matrix fixture page ${i + 1}`, { x: 50, y: 790, size: 16, font }));
  const meta = { T: S("Reviewer A"), M: S("D:20260101000000Z"), CA: 0.5 };

  const sq: Rect = [48, 700, 300, 718];
  addAnnot(doc, 0, { Subtype: "Squiggly", NM: S("sg-1"), C: [1, 0, 1], QuadPoints: quad(sq), ...meta }, sq, "1 0 1 RG 1 w 0 2 m 60 6 l 120 2 l 180 6 l 252 2 l S");
  addAnnot(doc, 0, { Subtype: "Circle", NM: S("ci-1"), C: [0, 0.5, 1], BS: { W: 3 }, ...meta }, [320, 680, 400, 740], "0 0.5 1 RG 3 w 4 4 72 52 re S");
  addAnnot(doc, 0, { Subtype: "Line", NM: S("ln-1"), C: [0, 0, 0], L: [60, 600, 260, 640], BS: { W: 2 }, ...meta }, [55, 595, 265, 645], "0 0 0 RG 2 w 5 5 m 205 45 l S");
  addAnnot(doc, 0, { Subtype: "Stamp", NM: S("st-1"), Name: "Approved", ...meta }, [320, 580, 420, 620], "0 0.6 0 RG 2 w 1 1 98 38 re S");
  addAnnot(doc, 0, { Subtype: "Text", NM: S("tx-1"), Name: "Note", Contents: S("no-rotate note"), C: [1, 0.8, 0], F: 28, ...meta }, [450, 700, 470, 720], "1 0.8 0 rg 0 0 20 20 re f");
  addAnnot(doc, 0, { Subtype: "FreeText", NM: S("ft-2"), Contents: S("Typed text"), DA: "/Helv 10 Tf 0 g", C: [1, 1, 1], BS: { W: 1 }, ...meta }, [60, 500, 220, 540], "1 1 1 rg 0 0 160 40 re f 0 0 0 RG 1 w 0.5 0.5 159 39 re S");
  // Internal link: page 1 -> page 3 (the target is a page object, so copying can break it).
  addAnnot(doc, 0, { Subtype: "Link", NM: S("lk-goto"), Border: [0, 0, 2], Dest: [pages[2].ref, "XYZ", 0, 800, 0] }, [50, 430, 200, 450]);

  pages[1].drawText("Reviewer:", { x: 50, y: 700, size: 12, font });
  doc.getForm().createTextField("matrix.field").addToPage(pages[1], { x: 120, y: 692, width: 200, height: 22 });

  addAnnot(doc, 2, { Subtype: "Square", NM: S("sq-3"), C: [0.8, 0.4, 0], BS: { W: 4 }, ...meta }, [100, 600, 220, 680], "0.8 0.4 0 RG 4 w 2 2 116 76 re S");
  return doc.save({ useObjectStreams: false });
}

async function main() {
  const built: { name: string; bytes: Uint8Array }[] = [
    { name: "form-all-fields.pdf", bytes: await buildFormAllFields() },
    { name: "annotations-markup.pdf", bytes: await buildAnnotationsMarkup() },
    { name: "annotations-matrix.pdf", bytes: await buildAnnotationsMatrix() },
  ];
  for (const b of built) fs.writeFileSync(path.join(CORPUS_DIR, b.name), b.bytes);

  const manifestPath = path.join(CORPUS_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const sha = (u: Uint8Array) => crypto.createHash("sha256").update(u).digest("hex");
  const entry = (id: string, name: string, category: string, pageCount: number, expected: Record<string, unknown>) => {
    const b = built.find((x) => x.name === name)!;
    return { id, name, category, sha256: sha(b.bytes), pageCount, expected };
  };
  const fresh = [
    entry("PDF-11", "form-all-fields.pdf", "form-all-fields", 1, {
      hasTextLayer: true,
      hasImages: false,
      hasAnnotations: false, // widgets only; hasForms covers them
      hasForms: true,
      formFields: ["t.name", "t.comments", "t.code", "c.subscribe", "r.plan", "d.country", "o.interests", "t.reference", "b.submit", "s.signature"],
      isEncrypted: false,
    }),
    entry("PDF-12", "annotations-markup.pdf", "annotations", 2, {
      hasTextLayer: true,
      hasImages: false,
      hasAnnotations: true,
      hasForms: true,
      formFields: ["reviewer.name"],
      annotationSubtypes: ["Highlight", "Underline", "StrikeOut", "Text", "Popup", "Ink", "FreeText", "Square", "Link", "Widget"],
      isEncrypted: false,
    }),
    entry("PDF-13", "annotations-matrix.pdf", "annotations", 3, {
      hasTextLayer: true,
      hasImages: false,
      hasAnnotations: true,
      hasForms: true,
      formFields: ["matrix.field"],
      annotationSubtypes: ["Squiggly", "Circle", "Line", "Stamp", "Text", "FreeText", "Link", "Widget", "Square"],
      isEncrypted: false,
    }),
  ];
  manifest.fixtures = [...manifest.fixtures.filter((f: { id: string }) => !fresh.some((n) => n.id === f.id)), ...fresh];
  const annotated = manifest.fixtures.find((f: { name: string }) => f.name === "annotated.pdf");
  if (annotated) annotated.expected.hasAnnotations = false; // verified: annotated.pdf has no /Annots, only a drawn rectangle
  const imageHeavy = manifest.fixtures.find((f: { name: string }) => f.name === "image-heavy.pdf");
  if (imageHeavy) imageHeavy.expected.hasAnnotations = true; // verified: 13 Link annotations on page 6
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  for (const b of built) console.log(`${b.name}  ${b.bytes.length} bytes  sha256 ${sha(b.bytes).slice(0, 12)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
