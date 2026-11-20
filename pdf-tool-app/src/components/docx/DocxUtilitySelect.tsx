"use client";

import clsx from "clsx";
import { useId, type ReactNode } from "react";
import { DOCX_UTILITIES, type DocxUtilityId } from "./docx-utilities";
import {
  DocxCheckIcon,
  DocxDocumentIcon,
  DocxInfoIcon,
  DocxMergeIcon,
  DocxShieldIcon,
  DocxTextIcon,
} from "./DocxIcons";

interface DocxUtilitySelectProps {
  value: DocxUtilityId;
  onChange: (id: DocxUtilityId) => void;
  disabled?: boolean;
  className?: string;
}

const UTILITY_ICONS: Record<DocxUtilityId, ReactNode> = {
  "extract-text": <DocxTextIcon className="h-5 w-5" />,
  "docx-to-txt": <DocxDocumentIcon className="h-5 w-5" />,
  "inspect-metadata": <DocxInfoIcon className="h-5 w-5" />,
  "remove-metadata": <DocxShieldIcon className="h-5 w-5" />,
  merge: <DocxMergeIcon className="h-5 w-5" />,
};

/** Native radio cards: one keyboard tab stop per group, arrow keys move between tools. */
export function DocxUtilitySelect({
  value,
  onChange,
  disabled = false,
  className = "",
}: DocxUtilitySelectProps) {
  const groupName = useId();
  const helpId = useId();

  return (
    <section aria-labelledby="docx-utility-heading" className={className}>
      <h2
        id="docx-utility-heading"
        className="text-lg font-semibold tracking-tight text-slate-900"
      >
        Choose a tool
      </h2>
      <p id={helpId} className="mt-1 text-sm text-slate-600">
        Every tool works on the same queue. Single-file tools use the first document; merging
        uses every document in order.
      </p>

      <fieldset disabled={disabled} aria-describedby={helpId} className="mt-4 min-w-0">
        <legend className="sr-only">DOCX tool</legend>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DOCX_UTILITIES.map((utility) => {
            const checked = utility.id === value;

            return (
              <label
                key={utility.id}
                className={clsx(
                  "relative flex cursor-pointer flex-col gap-2.5 rounded-xl border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-layah-primary focus-within:ring-offset-2 sm:p-4",
                  checked
                    ? "border-layah-primary bg-blue-50/60"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60",
                  disabled && "cursor-not-allowed opacity-60"
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={utility.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(utility.id)}
                  className="sr-only"
                />

                <span className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={clsx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                      checked
                        ? "border-layah-primary/25 bg-white text-layah-primary"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                    )}
                  >
                    {UTILITY_ICONS[utility.id]}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {utility.label}
                      </span>
                      {checked && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-layah-primary">
                          <DocxCheckIcon className="h-3.5 w-3.5" />
                          Selected
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-600">
                      {utility.summary}
                    </span>
                  </span>
                </span>

                <span
                  className={clsx(
                    "self-start rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    checked
                      ? "border-layah-primary/20 bg-white text-layah-primary"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  )}
                >
                  {utility.requirementLabel}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
