import {
  EncryptedPDFError,
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFAcroNonTerminal,
  PDFDict,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";

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
