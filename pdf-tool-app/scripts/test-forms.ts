import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { PDFDocument, PDFName } from "pdf-lib";
import { FormError, fillForm, readFormFields, validateFormValues, verifyFilled, type FormFieldInfo } from "../src/lib/pdf/forms";
import { unlockEncryptedPdf } from "../src/lib/pdf/password";
import { loadPdfJsNode } from "./lib/pdfjs-node";

const CORPUS = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const read = (n: string) => new Uint8Array(fs.readFileSync(path.join(CORPUS, n)));
const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return e instanceof FormError ? e.code : `OTHER:${(e as Error).message}`;
  }
};

async function main() {
  console.log("=== A-4.2 ACROFORM FILLING ===\n");
  const bytes = read("form-all-fields.pdf");

  // verifyFilled is what makes "reopen and verify" real; prove it fails when the read-back is wrong.
  const baseInfo = await readFormFields(bytes);
  const withValue = (name: string, value: unknown) => ({ ...baseInfo, fields: baseInfo.fields.map((f) => (f.name === name ? { ...f, value: value as never } : f)) });
  const okRead = withValue("t.name", "Ada");
  check("verifyFilled: matching read-back has no problems", verifyFilled(baseInfo, okRead, { "t.name": "Ada" }).problems.length === 0);
  check("verifyFilled: a value that did not persist is reported", /t\.name.*reads back/.test(verifyFilled(baseInfo, withValue("t.name", "Bob"), { "t.name": "Ada" }).problems.join()));
  check("verifyFilled: a collateral change to an untouched field is reported", /t\.code.*not changed by the fill/.test(verifyFilled(baseInfo, { ...okRead, fields: okRead.fields.map((f) => (f.name === "t.code" ? { ...f, value: "ZZZ" } : f)) }, { "t.name": "Ada" }).problems.join()));
  check("verifyFilled: a vanished field is reported", verifyFilled(baseInfo, { ...okRead, fields: okRead.fields.filter((f) => f.name !== "b.submit") }, { "t.name": "Ada" }).problems.length >= 1);
  check("verifyFilled: option lists compare regardless of order", verifyFilled(baseInfo, withValue("o.interests", ["Travel", "Music"]), { "o.interests": ["Music", "Travel"] }).problems.length === 0);

  // Finding: unlocking drops the form (password.ts copies pages into a clean document). Measured first, before the
  // test pdf.js is loaded (a second pdf.js version in the same process breaks the worker match).
  const unlocked = await unlockEncryptedPdf(new File([bytes as BlobPart], "form.pdf"), "x");
  const afterUnlock = await readFormFields(new Uint8Array(await unlocked.arrayBuffer()));
  console.log(`INFO  unlockEncryptedPdf on a 10-field form PDF leaves ${afterUnlock.fields.length} fields (documented finding, not asserted)`);

  // 1. Detection and listing
  console.log("--- 1. Detect and list fields ---");
  const info = await readFormFields(bytes);
  check("AcroForm detected", info.hasAcroForm && info.fields.length === 10, `${info.fields.length} fields`);
  const by = Object.fromEntries(info.fields.map((f) => [f.name, f])) as Record<string, FormFieldInfo>;
  const types = Object.fromEntries(info.fields.map((f) => [f.name, f.type]));
  const sortedJson = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
  check(
    "field names and types",
    sortedJson(types) ===
      sortedJson({ "t.name": "text", "t.comments": "text", "t.code": "text", "c.subscribe": "checkbox", "r.plan": "radio", "d.country": "dropdown", "o.interests": "optionList", "t.reference": "text", "b.submit": "button", "s.signature": "signature" }),
    JSON.stringify(types),
  );
  check("dotted names are not listed as extra fields (no parent nodes)", info.fields.length === 10);
  check("text options: multiline and maxLength read", by["t.comments"].multiline === true && by["t.code"].maxLength === 5 && by["t.name"].multiline === false);
  check("radio/dropdown/list options listed", by["r.plan"].options?.join() === "free,pro,team" && by["d.country"].options?.join() === "India,Germany,Brazil" && by["o.interests"].options?.length === 4 && by["o.interests"].multiselect === true);
  check("read-only flag read", by["t.reference"].readOnly && !by["t.name"].readOnly);
  check("initial values", by["t.reference"].value === "REF-0001" && by["c.subscribe"].value === false && by["t.name"].value === "");
  check("button and signature listed as unsupported WITH a reason (not dropped)", !by["b.submit"].supported && !by["s.signature"].supported && !!by["b.submit"].unsupportedReason && !!by["s.signature"].unsupportedReason, `${by["b.submit"].unsupportedReason} | ${by["s.signature"].unsupportedReason}`);
  check("supported flags for fillable types", ["t.name", "c.subscribe", "r.plan", "d.country", "o.interests"].every((n) => by[n].supported));
  check("each field reports its page", info.fields.every((f) => f.pageIndexes.join() === "0"));

  const none = await readFormFields(read("simple-text.pdf"));
  check("PDF without a form: hasAcroForm false, no fields", !none.hasAcroForm && none.fields.length === 0);
  const simple = await readFormFields(read("form-acroform.pdf"));
  check("existing corpus form lists its 2 text fields", simple.fields.map((f) => f.name).join() === "applicant.name,applicant.email");

  // A field with an /FT pdf-lib does not recognise is skipped by form.getFields(); it must still be listed.
  const odd = await PDFDocument.load(bytes);
  odd.getForm().getTextField("t.name").acroField.dict.set(PDFName.of("FT"), PDFName.of("Foo"));
  const oddBytes = new Uint8Array(await odd.save());
  const oddInfo = await readFormFields(oddBytes);
  const oddField = oddInfo.fields.find((f) => f.name === "t.name");
  check("unrecognised field type is listed as unknown + unsupported, not dropped", oddInfo.fields.length === 10 && oddField?.type === "unknown" && !oddField.supported && !!oddField.unsupportedReason);
  check("filling an unknown field is refused with VALIDATION", (await code(fillForm(oddBytes, { "t.name": "x" }))) === "VALIDATION");
  const xfa = await PDFDocument.load(bytes);
  xfa.getForm().acroForm.dict.set(PDFName.of("XFA"), xfa.context.obj([]));
  const xfaInfo = await readFormFields(new Uint8Array(await xfa.save({ updateFieldAppearances: false })));
  check("XFA forms produce a visible warning", xfaInfo.warnings.length === 1 && /XFA/.test(xfaInfo.warnings[0]));

  // 2. Validation
  console.log("\n--- 2. Validation ---");
  const v = (values: Record<string, unknown>) => validateFormValues(info.fields, values as never);
  const msgs = (values: Record<string, unknown>) => v(values).map((e) => `${e.name}: ${e.message}`).join(" | ");
  check("valid values: no errors", v({ "t.name": "Ada", "c.subscribe": true, "r.plan": "pro", "d.country": "India", "o.interests": ["Music"] }).length === 0);
  check("unknown field is rejected", /no field named/i.test(msgs({ nope: "x" })), msgs({ nope: "x" }));
  check("text: non-string rejected", /text/i.test(msgs({ "t.name": 5 })), msgs({ "t.name": 5 }));
  check("text: over maxLength rejected", /5/.test(msgs({ "t.code": "ABCDEF" })) && /maximum|too long|at most/i.test(msgs({ "t.code": "ABCDEF" })), msgs({ "t.code": "ABCDEF" }));
  check("text: exactly maxLength accepted", v({ "t.code": "ABCDE" }).length === 0);
  check("text: newline in single-line field rejected", /line break|newline|single-line/i.test(msgs({ "t.name": "a\nb" })), msgs({ "t.name": "a\nb" }));
  check("text: newline in multiline field accepted", v({ "t.comments": "a\nb" }).length === 0);
  check("checkbox: non-boolean rejected", /true or false|boolean/i.test(msgs({ "c.subscribe": "yes" })), msgs({ "c.subscribe": "yes" }));
  check("radio: option not in group rejected, lists the options", /gold/.test(msgs({ "r.plan": "gold" })) && /free/.test(msgs({ "r.plan": "gold" })), msgs({ "r.plan": "gold" }));
  check("dropdown: option not in list rejected", /Mars/.test(msgs({ "d.country": "Mars" })), msgs({ "d.country": "Mars" }));
  check("option list: unknown option rejected", /Chess/.test(msgs({ "o.interests": ["Music", "Chess"] })), msgs({ "o.interests": ["Music", "Chess"] }));
  check("option list: non-array rejected", v({ "o.interests": "Music" }).length === 1);
  check("read-only field rejected", /read-only/i.test(msgs({ "t.reference": "x" })), msgs({ "t.reference": "x" }));
  check("button rejected with its reason", /button/i.test(msgs({ "b.submit": "x" })), msgs({ "b.submit": "x" }));
  check("signature rejected with its reason", /signature/i.test(msgs({ "s.signature": "x" })), msgs({ "s.signature": "x" }));
  check("every problem is reported, not only the first", v({ nope: 1, "t.code": "TOOLONG", "r.plan": "gold" }).length === 3);

  // 3. Fill, export, reopen, verify
  console.log("\n--- 3. Fill, export, reopen ---");
  const before = sha(bytes);
  const values = {
    "t.name": "Ada Lovelace",
    "t.comments": "first line\nsecond line",
    "t.code": "ABC12",
    "c.subscribe": true,
    "r.plan": "pro",
    "d.country": "Germany",
    "o.interests": ["Music", "Travel"],
  };
  const filled = await fillForm(bytes, values);
  check("original bytes are unchanged", sha(bytes) === before);
  check("output is a different, non-empty file", filled.bytes.length > 0 && sha(filled.bytes) !== before);
  check("verification lists every written field as ok", filled.verification.length === 7 && filled.verification.every((x) => x.ok), filled.verification.filter((x) => !x.ok).map((x) => x.name).join());

  const reopened = await readFormFields(filled.bytes);
  const rv = Object.fromEntries(reopened.fields.map((f) => [f.name, f.value])) as Record<string, unknown>;
  check("reopened: text values", rv["t.name"] === "Ada Lovelace" && rv["t.code"] === "ABC12");
  check("reopened: multiline text keeps its line break", rv["t.comments"] === "first line\nsecond line");
  check("reopened: checkbox checked", rv["c.subscribe"] === true);
  check("reopened: radio selection", rv["r.plan"] === "pro");
  check("reopened: dropdown selection", rv["d.country"] === "Germany");
  check("reopened: option list selections", JSON.stringify(rv["o.interests"]) === JSON.stringify(["Music", "Travel"]));
  check("untouched read-only field keeps its value", rv["t.reference"] === "REF-0001");
  check("unsupported fields are still present in the output", reopened.fields.some((f) => f.name === "b.submit") && reopened.fields.some((f) => f.name === "s.signature"));
  check("output opens as a PDF with the same page count", (await PDFDocument.load(filled.bytes)).getPageCount() === 1);

  // independent read-back with PDF.js
  const pdfjs = await loadPdfJsNode(); // loaded after the unlock check: react-pdf's pdf.js and this one cannot share a process
  const task = pdfjs.getDocument({ data: filled.bytes.slice(), useSystemFonts: true });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const anns: { fieldName?: string; fieldValue?: unknown; checkBox?: boolean; buttonValue?: string; radioButton?: boolean }[] = await page.getAnnotations();
  const pv = (n: string) => anns.find((a) => a.fieldName === n)?.fieldValue;
  check("PDF.js reads the text value", pv("t.name") === "Ada Lovelace", JSON.stringify(pv("t.name")));
  check("PDF.js reads the dropdown value", [pv("d.country")].flat().includes("Germany"), JSON.stringify(pv("d.country")));
  check("PDF.js reads the option list values", JSON.stringify([pv("o.interests")].flat().sort()) === JSON.stringify(["Music", "Travel"]), JSON.stringify(pv("o.interests")));
  const sub = anns.find((a) => a.fieldName === "c.subscribe");
  check("PDF.js sees the checkbox as checked", !!sub && sub.fieldValue !== "Off" && sub.fieldValue !== false, JSON.stringify(sub?.fieldValue));
  await task.destroy();

  // Uncheck / clear again and confirm changes persist from a previously filled file
  const again = await fillForm(filled.bytes, { "c.subscribe": false, "r.plan": null, "t.name": "" });
  const rv2 = Object.fromEntries((await readFormFields(again.bytes)).fields.map((f) => [f.name, f.value])) as Record<string, unknown>;
  check("a filled form can be edited again: uncheck, clear radio, empty text", rv2["c.subscribe"] === false && rv2["r.plan"] === null && rv2["t.name"] === "");
  check("untouched values survive the second fill", rv2["t.code"] === "ABC12" && rv2["d.country"] === "Germany");

  // Visible output: a text-only fill must change the rendered page text
  const task2 = pdfjs.getDocument({ data: filled.bytes.slice(), useSystemFonts: true });
  const d2 = await task2.promise;
  const ann2: { fieldName?: string; fieldValue?: unknown }[] = await (await d2.getPage(1)).getAnnotations();
  check("PDF.js field value for t.code matches", ann2.find((a) => a.fieldName === "t.code")?.fieldValue === "ABC12");
  await task2.destroy();

  // 4. Errors
  console.log("\n--- 4. Error handling ---");
  check("empty values -> VALIDATION", (await code(fillForm(bytes, {}))) === "VALIDATION");
  check("invalid values -> VALIDATION, nothing exported", (await code(fillForm(bytes, { "r.plan": "gold" }))) === "VALIDATION");
  check("PDF with no form -> NO_FORM", (await code(fillForm(read("simple-text.pdf"), { x: "y" }))) === "NO_FORM");
  check("readFormFields on corrupt bytes -> INVALID", (await code(readFormFields(new Uint8Array([1, 2, 3, 4])))) === "INVALID");
  check("fillForm on corrupt bytes -> INVALID", (await code(fillForm(new Uint8Array(bytes.slice(0, 300)), { "t.name": "x" }))) === "INVALID");
  check("password-protected PDF -> PASSWORD", (await code(readFormFields(read("password-protected.pdf")))) === "PASSWORD");
  check("password-protected PDF fill -> PASSWORD", (await code(fillForm(read("password-protected.pdf"), { a: "b" }))) === "PASSWORD");
  try {
    await fillForm(bytes, { "t.name": "Ω≈ unencodable ☃" });
    check("characters the form font cannot encode -> VALIDATION naming the field", false, "no error thrown");
  } catch (e) {
    check("characters the form font cannot encode -> VALIDATION naming the field", e instanceof FormError && e.code === "VALIDATION" && /t\.name/.test(e.message), (e as Error).message);
  }
  check("original still unchanged after all failures", sha(bytes) === before);

  // Existing corpus form
  const f2 = await fillForm(read("form-acroform.pdf"), { "applicant.name": "Grace Hopper", "applicant.email": "grace@example.com" });
  const r2 = Object.fromEntries((await readFormFields(f2.bytes)).fields.map((f) => [f.name, f.value]));
  check("form-acroform.pdf: both text fields updated", r2["applicant.name"] === "Grace Hopper" && r2["applicant.email"] === "grace@example.com");

  console.log(`\n=================================================`);
  console.log(failed ? `${failed} FORM TESTS FAILED` : "ALL FORM TESTS PASSED");
  console.log(`=================================================\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
