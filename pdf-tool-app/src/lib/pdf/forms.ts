import {
  EncryptedPDFError,
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFAcroNonTerminal,
  PDFArray,
  PDFDict,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import { compareAnnotations, inspectAnnotations, type AnnotationInfo, type AnnotationInspection } from "./annotations";

/**
 * AcroForm reading and filling (pdf-lib, pure: runs in the browser and in Node tests).
 *
 * Every export is reopened and every written value is read back before the bytes are returned. The input bytes are
 * never modified; callers get a new byte array.
 *
 * Limits (reported, not hidden): XFA data is not supported and is dropped from the exported copy (a warning is returned); field text is drawn with Helvetica
 * (characters outside WinAnsi are rejected); signature and button fields are listed as unsupported.
 */

export type FormFieldType = "text" | "checkbox" | "radio" | "dropdown" | "optionList" | "button" | "signature" | "unknown";
/** text -> string, checkbox -> boolean, radio/dropdown -> option or null, optionList -> chosen options. */
export type FieldValue = string | boolean | string[] | null;
export type FormValues = Record<string, FieldValue>;

export interface FormFieldInfo {
  name: string;
  type: FormFieldType;
  supported: boolean;
  unsupportedReason?: string;
  value: FieldValue;
  options?: string[];
  multiline?: boolean;
  maxLength?: number;
  multiselect?: boolean;
  /** Dropdown that accepts text outside its list. */
  editable?: boolean;
  readOnly: boolean;
  required: boolean;
  /** 0-based pages that show a widget of this field. */
  pageIndexes: number[];
}

export interface FormInfo {
  hasAcroForm: boolean;
  fields: FormFieldInfo[];
  /** Things the user should know, e.g. an XFA form. */
  warnings: string[];
}

export type FormErrorCode = "PASSWORD" | "INVALID" | "NO_FORM" | "VALIDATION" | "VERIFY_FAILED";
export interface FieldError {
  name: string;
  message: string;
}

export class FormError extends Error {
  constructor(
    public readonly code: FormErrorCode,
    message: string,
    public readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "FormError";
  }
}

export async function loadFormDocument(bytes: Uint8Array | ArrayBuffer): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof EncryptedPDFError || /encrypt|password/i.test(msg)) {
      throw new FormError("PASSWORD", "This PDF is password-protected. Unlock it first, then open its form.");
    }
    throw new FormError("INVALID", `This file could not be read as a PDF (${msg}).`);
  }
}

const UNSUPPORTED: Partial<Record<FormFieldType, string>> = {
  button: "Buttons trigger actions and hold no value, so there is nothing to fill.",
  signature: "Signature fields need a digital signature, which this tool cannot create.",
  unknown: "Unrecognised field type; it is left exactly as it is.",
};

function typeOf(field: PDFField): FormFieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "optionList";
  if (field instanceof PDFButton) return "button";
  if (field instanceof PDFSignature) return "signature";
  return "unknown";
}

function valueOf(field: PDFField): FieldValue {
  if (field instanceof PDFTextField) return field.getText() ?? "";
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? null;
  if (field instanceof PDFDropdown) return field.getSelected()[0] ?? null;
  if (field instanceof PDFOptionList) return field.getSelected();
  return null;
}

function describeFields(doc: PDFDocument): FormInfo {
  const warnings: string[] = [];
  const hasAcroForm = doc.catalog.has(PDFName.of("AcroForm"));
  if (!hasAcroForm) return { hasAcroForm: false, fields: [], warnings };

  // pdf-lib deletes XFA data as soon as getForm() runs, so look for it first.
  if (doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.has(PDFName.of("XFA"))) {
    warnings.push("This form also contains XFA data, which is not supported. Only the standard AcroForm fields are read and filled, and the XFA data is not kept in the exported copy.");
  }
  const form = doc.getForm();
  const pageRefs = doc.getPages().map((p) => p.ref.toString());
  const known = new Set<string>();
  const fields: FormFieldInfo[] = form.getFields().map((field) => {
    known.add(field.getName());
    const type = typeOf(field);
    const supported = !UNSUPPORTED[type];
    const info: FormFieldInfo = {
      name: field.getName(),
      type,
      supported,
      value: valueOf(field),
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      pageIndexes: [
        ...new Set(
          field.acroField
            .getWidgets()
            .map((w) => w.P()?.toString())
            .map((ref) => (ref ? pageRefs.indexOf(ref) : -1))
            .filter((i) => i >= 0),
        ),
      ].sort((a, b) => a - b),
    };
    if (!supported) info.unsupportedReason = UNSUPPORTED[type];
    if (field instanceof PDFTextField) {
      info.multiline = field.isMultiline();
      info.maxLength = field.getMaxLength();
    }
    if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) info.options = field.getOptions();
    if (field instanceof PDFDropdown) {
      info.editable = field.isEditable();
      info.multiselect = field.isMultiselect();
    }
    if (field instanceof PDFOptionList) info.multiselect = field.isMultiselect();
    return info;
  });

  // pdf-lib's getFields() silently skips fields with an unrecognised /FT. List them instead of hiding them.
  for (const [acroField] of form.acroForm.getAllFields()) {
    if (acroField instanceof PDFAcroNonTerminal) continue; // parent node of a dotted name, not a field
    const fullName = acroField.getFullyQualifiedName() ?? "(unnamed)";
    if (known.has(fullName)) continue;
    fields.push({
      name: fullName,
      type: "unknown",
      supported: false,
      unsupportedReason: UNSUPPORTED.unknown,
      value: null,
      readOnly: false,
      required: false,
      pageIndexes: [],
    });
  }

  return { hasAcroForm: true, fields, warnings };
}

/** Lists the form fields of a PDF. Throws FormError PASSWORD / INVALID; a PDF without a form returns hasAcroForm false. */
export async function readFormFields(bytes: Uint8Array | ArrayBuffer): Promise<FormInfo> {
  return describeFields(await loadFormDocument(bytes));
}

const quote = (s: string) => `"${s}"`;

/** Font size used for multiline fields whose default appearance asks for auto size (0). */
const MULTILINE_FONT_SIZE = 12;

/** True when the field's /DA font size is 0 (auto) or missing. */
function hasAutoFontSize(field: PDFTextField): boolean {
  const da = field.acroField.getDefaultAppearance();
  const m = da ? /([\d.]+)\s+Tf/.exec(da) : null;
  return !m || Number(m[1]) === 0;
}

/** Checks values against the fields. Returns every problem (not only the first); an empty array means writable. */
export function validateFormValues(fields: FormFieldInfo[], values: FormValues): FieldError[] {
  const errors: FieldError[] = [];
  const byName = new Map(fields.map((f) => [f.name, f]));
  const add = (name: string, message: string) => errors.push({ name, message });
  const notOneOf = (f: FormFieldInfo, v: string) => add(f.name, `${quote(f.name)}: ${quote(v)} is not one of: ${(f.options ?? []).join(", ")}.`);

  for (const [name, value] of Object.entries(values)) {
    const f = byName.get(name);
    if (!f) {
      add(name, `No field named ${quote(name)} in this form.`);
      continue;
    }
    if (!f.supported) {
      add(name, `${quote(name)} cannot be filled: ${f.unsupportedReason}`);
      continue;
    }
    if (f.readOnly) {
      add(name, `${quote(name)} is read-only.`);
      continue;
    }
    switch (f.type) {
      case "text":
        if (typeof value !== "string") add(name, `${quote(name)} is a text field and needs text.`);
        else if (f.maxLength !== undefined && value.length > f.maxLength) add(name, `${quote(name)} allows at most ${f.maxLength} characters (got ${value.length}).`);
        else if (!f.multiline && /[\r\n]/.test(value)) add(name, `${quote(name)} is a single-line field; remove the line break.`);
        break;
      case "checkbox":
        if (typeof value !== "boolean") add(name, `${quote(name)} is a checkbox and must be true or false.`);
        break;
      case "radio":
      case "dropdown":
        if (value === null || value === "") break; // clears the selection
        if (typeof value !== "string") add(name, `${quote(name)} needs one of: ${(f.options ?? []).join(", ")}.`);
        else if (!(f.options ?? []).includes(value) && !(f.type === "dropdown" && f.editable)) notOneOf(f, value);
        break;
      case "optionList":
        if (!Array.isArray(value)) add(name, `${quote(name)} is an option list and needs a list of choices.`);
        else {
          const bad = value.find((v) => !(f.options ?? []).includes(v));
          if (bad !== undefined) notOneOf(f, bad);
          else if (!f.multiselect && value.length > 1) add(name, `${quote(name)} allows only one choice.`);
        }
        break;
    }
  }
  return errors;
}

export interface FieldVerification {
  name: string;
  expected: FieldValue;
  actual: FieldValue;
  ok: boolean;
}

export interface FillResult {
  bytes: Uint8Array;
  /** One entry per written field, read back from the reopened output. */
  verification: FieldVerification[];
  warnings: string[];
}

const sameValue = (a: FieldValue, b: FieldValue) => {
  if (Array.isArray(a) && Array.isArray(b)) return [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
  return a === b;
};
const normalise = (v: FieldValue, type: FormFieldType): FieldValue => ((type === "radio" || type === "dropdown") && v === "" ? null : v);

/**
 * Compares the form read back from the exported file with what was requested: every written value must read back, every
 * other field must keep its value, and no field may appear or disappear. Pure, so the failure paths are testable.
 */
export function verifyFilled(before: FormInfo, after: FormInfo, values: FormValues): { verification: FieldVerification[]; problems: string[] } {
  const names = Object.keys(values);
  const meta = new Map(before.fields.map((f) => [f.name, f]));
  const out = new Map(after.fields.map((f) => [f.name, f]));
  const verification: FieldVerification[] = names.map((name) => {
    const type = meta.get(name)?.type ?? "unknown";
    const expected = normalise(values[name], type);
    const actual = out.get(name)?.value ?? null;
    return { name, expected, actual, ok: out.has(name) && sameValue(expected, normalise(actual, type)) };
  });
  const problems = [
    ...verification.filter((v) => !v.ok).map((v) => `${quote(v.name)} reads back as ${JSON.stringify(v.actual)}, expected ${JSON.stringify(v.expected)}`),
    ...before.fields
      .filter((f) => !names.includes(f.name))
      .filter((f) => !out.has(f.name) || !sameValue(f.value, out.get(f.name)!.value))
      .map((f) => `${quote(f.name)} was not changed by the fill but its value differs after export`),
  ];
  if (after.fields.length !== before.fields.length) problems.push(`field count changed ${before.fields.length} -> ${after.fields.length}`);
  return { verification, problems };
}

/** Writes `values`, exports, reopens the export and checks every written value (and that nothing else changed). */
export async function fillForm(bytes: Uint8Array | ArrayBuffer, values: FormValues): Promise<FillResult> {
  const doc = await loadFormDocument(bytes);
  const info = describeFields(doc);
  if (!info.hasAcroForm || info.fields.length === 0) throw new FormError("NO_FORM", "This PDF has no fillable form fields.");
  const names = Object.keys(values);
  if (!names.length) throw new FormError("VALIDATION", "No values to write: enter a value in at least one field.");

  const problems = validateFormValues(info.fields, values);
  if (problems.length) throw new FormError("VALIDATION", problems.map((p) => p.message).join(" "), problems);

  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const encodeErrors: FieldError[] = [];
  for (const name of names) {
    const field = form.getField(name);
    const value = values[name];
    try {
      if (field instanceof PDFTextField) {
        // pdf-lib's auto font size for a multiline field draws one oversized line and clips the rest.
        if (field.isMultiline() && hasAutoFontSize(field)) field.setFontSize(MULTILINE_FONT_SIZE);
        if (value === "") field.setText(undefined);
        else field.setText(value as string);
      } else if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (value === null || value === "") field.clear();
        else field.select(value as string);
      } else if (field instanceof PDFDropdown) {
        if (value === null || value === "") field.clear();
        else field.select(value as string);
      } else if (field instanceof PDFOptionList) {
        if ((value as string[]).length === 0) field.clear();
        else field.select(value as string[]);
      }
      field.defaultUpdateAppearances(font);
    } catch (e) {
      encodeErrors.push({ name, message: `${quote(name)} could not be written: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  if (encodeErrors.length) throw new FormError("VALIDATION", encodeErrors.map((p) => p.message).join(" "), encodeErrors);

  // Appearances of the written fields were generated above; do not regenerate (and so alter) the untouched ones.
  const out = new Uint8Array(await doc.save({ updateFieldAppearances: false }));

  // Reopen and verify.
  const { verification, problems: mismatches } = verifyFilled(info, await readFormFields(out), values);
  if (mismatches.length) throw new FormError("VERIFY_FAILED", `The exported PDF did not match what was entered: ${mismatches.join("; ")}.`);
  return { bytes: out, verification, warnings: info.warnings };
}

// ---------------------------------------------------------------------------------------------------------------------
// Flattening (A-4.3)
//
// pdf-lib's form.flatten() turns the AcroForm fields into page content. It does NOT flatten other annotations
// (highlights, notes, ink, links, ...): those are left exactly as they are, never removed, and reported. Known pdf-lib
// defects handled here: widgets without an appearance stream make flatten()/removeField() throw, and flatten() leaves
// dangling references in each page's /Annots.
// ---------------------------------------------------------------------------------------------------------------------

export interface FlattenInspection {
  fieldCount: number;
  widgetCount: number;
  /** Non-widget annotations: kept as live annotations, not flattened. */
  keptByType: Record<string, number>;
  keptTotal: number;
  /** Fields whose widgets have no appearance stream (nothing visible to draw). */
  emptyAppearanceFields: string[];
  /** Signature fields that hold a signature value; flattening (like any re-save) invalidates it. */
  signedSignatures: string[];
  warnings: string[];
}

function hasNormalAppearance(widget: { dict: PDFDict }): boolean {
  return !!widget.dict.lookupMaybe(PDFName.of("AP"), PDFDict)?.has(PDFName.of("N"));
}

export async function inspectForFlatten(bytes: Uint8Array | ArrayBuffer): Promise<FlattenInspection> {
  const doc = await loadFormDocument(bytes);
  const info = describeFields(doc);
  const ann = await inspectAnnotations(bytes);
  const { Widget: widgets = 0, ...kept } = ann.byType;
  const out: FlattenInspection = {
    fieldCount: info.fields.length,
    widgetCount: widgets,
    keptByType: kept,
    keptTotal: Object.values(kept).reduce((a, b) => a + b, 0),
    emptyAppearanceFields: [],
    signedSignatures: [],
    warnings: [...info.warnings],
  };
  if (info.hasAcroForm) {
    for (const field of doc.getForm().getFields()) {
      if (field.acroField.getWidgets().some((w) => !hasNormalAppearance(w))) out.emptyAppearanceFields.push(field.getName());
      if (field instanceof PDFSignature && field.acroField.dict.has(PDFName.of("V"))) out.signedSignatures.push(field.getName());
    }
  }
  const unknown = info.fields.filter((f) => f.type === "unknown").map((f) => f.name);
  if (unknown.length) out.warnings.push(`${unknown.length} field${unknown.length > 1 ? "s" : ""} of an unrecognised type (${unknown.join(", ")}) cannot be flattened and stay as live fields.`);
  if (out.signedSignatures.length) out.warnings.push(`Signed signature field${out.signedSignatures.length > 1 ? "s" : ""} (${out.signedSignatures.join(", ")}): flattening invalidates the digital signature.`);
  if (out.keptTotal) out.warnings.push(`${out.keptTotal} other annotation${out.keptTotal > 1 ? "s" : ""} (${Object.entries(kept).map(([t, n]) => `${n} ${t}`).join(", ")}) will be kept as they are. They are not flattened.`);
  return out;
}

export interface FlattenCheck {
  check: string;
  ok: boolean;
  detail?: string;
}

/** Compares annotations/fields before and after flattening. Pure, so its failure paths are testable. */
export function verifyFlattened(
  before: AnnotationInspection,
  after: AnnotationInspection,
  formAfter: FormInfo,
  options: { leftFields?: string[] } = {},
): { checks: FlattenCheck[]; problems: string[] } {
  const left = new Set(options.leftFields ?? []);
  const isWidget = (a: AnnotationInfo) => a.subtype === "Widget";
  const strip = (i: AnnotationInspection, keep: (a: AnnotationInfo) => boolean): AnnotationInspection => ({ ...i, pages: i.pages.map((p) => p.filter(keep)) });
  const checks: FlattenCheck[] = [];
  const add = (check: string, ok: boolean, detail?: string) => checks.push({ check, ok, detail: ok ? undefined : detail });

  const extraFields = formAfter.fields.filter((f) => !left.has(f.name)).map((f) => f.name);
  add("no form fields remain (except those that cannot be flattened)", extraFields.length === 0, `field(s) still present: ${extraFields.join(", ")}`);

  const expectedWidgets = before.pages.flat().filter((a) => isWidget(a) && a.fieldName !== null && left.has(a.fieldName)).length;
  const widgetsAfter = after.byType.Widget ?? 0;
  add("no widget annotations remain", widgetsAfter === expectedWidgets, `${widgetsAfter} widget annotation(s) remain, expected ${expectedWidgets}`);

  add("no dangling annotation references", after.dangling <= before.dangling, `dangling references ${before.dangling} -> ${after.dangling}`);

  const diff = compareAnnotations(strip(before, (a) => !isWidget(a)), strip(after, (a) => !isWidget(a)));
  add("markup annotations preserved unchanged (not removed, not flattened)", diff.ok, diff.messages.join("; "));

  const typeDiffs = Object.keys({ ...before.byType, ...after.byType })
    .filter((t) => t !== "Widget" && (before.byType[t] ?? 0) !== (after.byType[t] ?? 0))
    .map((t) => `${t} ${before.byType[t] ?? 0} -> ${after.byType[t] ?? 0}`);
  add("annotation counts by type unchanged", typeDiffs.length === 0, typeDiffs.join(", "));

  return { checks, problems: checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`) };
}

export interface FlattenReport {
  fieldsFlattened: number;
  widgetsRemoved: number;
  /** Non-widget annotations left in place (not flattened). */
  annotationsKept: number;
  keptByType: Record<string, number>;
  /** Fields that had no appearance stream and so contributed nothing visible. */
  emptyAppearanceFields: string[];
  /** Fields whose appearance was generated before flattening because the file had none. */
  regeneratedAppearances: string[];
  /** Fields of an unrecognised type that could not be flattened. */
  leftFields: string[];
  warnings: string[];
  verification: FlattenCheck[];
}

export interface FlattenResult {
  bytes: Uint8Array;
  report: FlattenReport;
}

/** Flattens the AcroForm fields into page content, then reopens the output and verifies it. The input is never modified. */
export async function flattenForm(bytes: Uint8Array | ArrayBuffer): Promise<FlattenResult> {
  const doc = await loadFormDocument(bytes);
  const info = describeFields(doc);
  if (!info.hasAcroForm || info.fields.length === 0) throw new FormError("NO_FORM", "This PDF has no form fields to flatten.");
  const pre = await inspectForFlatten(bytes);
  const beforeAnn = await inspectAnnotations(bytes);
  const leftFields = info.fields.filter((f) => f.type === "unknown").map((f) => f.name);

  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const emptied: string[] = [];
  const regenerated: string[] = [];
  for (const field of form.getFields()) {
    const missing = field.acroField.getWidgets().filter((w) => !hasNormalAppearance(w));
    if (!missing.length) continue;
    let rebuilt = false;
    if (typeOf(field) !== "signature" && typeOf(field) !== "button") {
      try {
        field.defaultUpdateAppearances(font);
        rebuilt = field.acroField.getWidgets().every((w) => hasNormalAppearance(w));
      } catch {
        rebuilt = false;
      }
    }
    if (rebuilt) {
      regenerated.push(field.getName());
      continue;
    }
    for (const w of missing) {
      const r = w.getRectangle();
      const stream = doc.context.stream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, r.width, r.height] });
      w.dict.set(PDFName.of("AP"), doc.context.obj({ N: doc.context.register(stream) }));
    }
    emptied.push(field.getName());
  }

  form.flatten({ updateFieldAppearances: false });

  // pdf-lib leaves references to the deleted widgets in each page's /Annots.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) if (!(annots.lookup(i) instanceof PDFDict)) annots.remove(i);
    if (annots.size() === 0) page.node.delete(PDFName.of("Annots"));
  }
  if (!leftFields.length) doc.catalog.delete(PDFName.of("AcroForm"));

  const out = new Uint8Array(await doc.save({ updateFieldAppearances: false }));

  const afterAnn = await inspectAnnotations(out);
  const { checks, problems } = verifyFlattened(beforeAnn, afterAnn, await readFormFields(out), { leftFields });
  if (problems.length) throw new FormError("VERIFY_FAILED", `The flattened PDF did not pass verification: ${problems.join("; ")}.`);

  const warnings = [...pre.warnings.filter((w) => !/^\d+ other annotation/.test(w))];
  if (emptied.length) warnings.push(`No visible appearance for ${emptied.join(", ")}: they were removed without drawing anything.`);
  if (regenerated.length) warnings.push(`The file had no appearance for ${regenerated.join(", ")}; one was generated from the field value before flattening.`);
  const keptTotal = pre.keptTotal;
  if (keptTotal) warnings.push(`${keptTotal} other annotation${keptTotal > 1 ? "s were" : " was"} kept as ${keptTotal > 1 ? "annotations" : "an annotation"} and not flattened.`);
  return {
    bytes: out,
    report: {
      fieldsFlattened: info.fields.length - leftFields.length,
      widgetsRemoved: (beforeAnn.byType.Widget ?? 0) - (afterAnn.byType.Widget ?? 0),
      annotationsKept: keptTotal,
      keptByType: pre.keptByType,
      emptyAppearanceFields: emptied,
      regeneratedAppearances: regenerated,
      leftFields,
      warnings,
      verification: checks,
    },
  };
}
