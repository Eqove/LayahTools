"use client";

import clsx from "clsx";
import { ErrorState } from "@/components/ui/ErrorState";
import type { FieldValue, FormFieldInfo } from "@/lib/pdf/forms";
import type { FormFillFlow } from "./useFormFill";

const TYPE_LABEL: Record<FormFieldInfo["type"], string> = {
  text: "Text",
  checkbox: "Checkbox",
  radio: "Radio group",
  dropdown: "Dropdown",
  optionList: "Option list",
  button: "Button",
  signature: "Signature",
  unknown: "Unknown",
};

const INPUT = "border border-slate-300 rounded-md px-2 py-1 text-sm bg-white disabled:bg-slate-100 disabled:text-slate-500 w-full";

function FieldControl({ field, value, onChange, id, disabled }: { field: FormFieldInfo; value: FieldValue; onChange: (v: FieldValue) => void; id: string; disabled: boolean }) {
  switch (field.type) {
    case "text":
      return field.multiline ? (
        <textarea id={id} className={INPUT} rows={3} disabled={disabled} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className={INPUT} type="text" disabled={disabled} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {value === true ? "Checked" : "Unchecked"}
        </label>
      );
    case "radio":
      return (
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-x-4 gap-y-1">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name={id} disabled={disabled} checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
          {!disabled && value !== null && (
            <button type="button" className="text-xs text-slate-500 underline" onClick={() => onChange(null)}>
              Clear
            </button>
          )}
        </div>
      );
    case "dropdown":
      return (
        <select id={id} className={INPUT} disabled={disabled} value={(value as string | null) ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
          <option value="">(none)</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "optionList":
      return (
        <select
          id={id}
          className={INPUT}
          multiple
          size={Math.min(5, Math.max(2, (field.options ?? []).length))}
          disabled={disabled}
          value={(value as string[]) ?? []}
          onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
        >
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    default:
      return null;
  }
}

/** Right-hand panel for the Fill Form tool: every field with its type, an input per supported type, live validation. */
export function FormFillPanel({ flow }: { flow: FormFillFlow }) {
  const { analysis, info, fields, draft, setValue, reset, retry, changedCount, errorFor, running, disabledReason } = flow;

  return (
    <section aria-label="Form fields" className="flex flex-col gap-3 text-sm text-slate-700">
      {analysis.state === "loading" && (
        <p role="status" aria-live="polite" className="border border-slate-200 bg-slate-50 rounded-md p-3 text-xs text-slate-600">
          Reading the form fields...
        </p>
      )}

      {analysis.state === "error" && (
        <ErrorState
          title={analysis.code === "PASSWORD" ? "This PDF is password-protected" : "Could not read this PDF"}
          message={analysis.message}
          onRetry={analysis.code === "PASSWORD" ? undefined : retry}
        />
      )}

      {info && !info.hasAcroForm && (
        <p role="status" className="border border-slate-200 bg-slate-50 rounded-md p-3">
          This PDF has no AcroForm, so there are no fillable fields.
        </p>
      )}
      {info && info.hasAcroForm && fields.length === 0 && (
        <p role="status" className="border border-slate-200 bg-slate-50 rounded-md p-3">
          This PDF has an empty form: it declares no fields.
        </p>
      )}

      {info?.warnings.map((w) => (
        <p key={w} role="status" className="border border-amber-300 bg-amber-50 text-amber-900 rounded-md p-3 text-xs">
          {w}
        </p>
      ))}

      {fields.length > 0 && (
        <>
          <p className="text-xs text-slate-500">
            {fields.length} field{fields.length > 1 ? "s" : ""}
            {fields.some((f) => !f.supported) ? `, ${fields.filter((f) => !f.supported).length} cannot be filled` : ""}. Only the fields you change are written.
          </p>
          <ul className="flex flex-col gap-3" aria-label="Form fields">
            {fields.map((f, i) => {
              const id = `ff-${i}`;
              const disabled = !f.supported || f.readOnly || running;
              const err = errorFor(f.name);
              const value = f.name in draft ? draft[f.name] : f.value;
              return (
                <li key={f.name} data-field-type={f.type} className={clsx("border rounded-md p-3 flex flex-col gap-1.5", err ? "border-red-300 bg-red-50/40" : "border-slate-200")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <label id={`${id}-label`} htmlFor={id} className="font-medium text-slate-900 break-all">
                      {f.name}
                      {f.required && <span className="text-red-600" aria-label="required"> *</span>}
                    </label>
                    <span className="text-[11px] text-slate-500 shrink-0">
                      {TYPE_LABEL[f.type]}
                      {f.pageIndexes.length ? ` · p. ${f.pageIndexes.map((p) => p + 1).join(", ")}` : ""}
                    </span>
                  </div>
                  {f.supported ? (
                    <>
                      <FieldControl field={f} value={value} onChange={(v) => setValue(f.name, v)} id={id} disabled={disabled} />
                      {f.readOnly && <span className="text-xs text-slate-500">Read-only: this field cannot be changed.</span>}
                      {f.maxLength !== undefined && !f.readOnly && <span className="text-xs text-slate-500">Up to {f.maxLength} characters.</span>}
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">Not filled: {f.unsupportedReason}</span>
                  )}
                  {err && (
                    <span role="alert" className="text-xs text-red-700">
                      {err}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {changedCount > 0 && (
            <button type="button" onClick={reset} disabled={running} className="self-start text-xs text-slate-600 underline disabled:opacity-50">
              Reset {changedCount} change{changedCount > 1 ? "s" : ""}
            </button>
          )}
        </>
      )}

      {disabledReason && !running && fields.length > 0 && <p className="text-xs text-slate-500">{disabledReason}</p>}

      <p className="text-xs text-slate-500">
        The filled copy is added to Outputs and re-opened to check every value. Your original file is not changed.
      </p>
    </section>
  );
}
