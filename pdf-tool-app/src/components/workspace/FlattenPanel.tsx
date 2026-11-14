"use client";

import { ErrorState } from "@/components/ui/ErrorState";
import type { FlattenFlow } from "./useFlattenForm";

/** Right-hand panel for the Flatten Form tool: what will happen, an irreversibility warning and an explicit confirmation. */
export function FlattenPanel({ flow }: { flow: FlattenFlow }) {
  const { analysis, inspection, confirmed, setConfirmed, report, running, retry } = flow;
  const kept = inspection ? Object.entries(inspection.keptByType) : [];

  return (
    <section aria-label="Flatten form" className="flex flex-col gap-3 text-sm text-slate-700">
      {analysis.state === "loading" && (
        <p role="status" aria-live="polite" className="border border-slate-200 bg-slate-50 rounded-md p-3 text-xs text-slate-600">
          Checking the form fields and annotations...
        </p>
      )}

      {analysis.state === "error" && (
        <ErrorState
          title={analysis.code === "PASSWORD" ? "This PDF is password-protected" : "Could not read this PDF"}
          message={analysis.message}
          onRetry={analysis.code === "PASSWORD" ? undefined : retry}
        />
      )}

      {inspection && inspection.fieldCount === 0 && (
        <p role="status" className="border border-slate-200 bg-slate-50 rounded-md p-3">
          This PDF has no form fields, so there is nothing to flatten.
          {inspection.keptTotal > 0 && " Its annotations are not changed by this tool."}
        </p>
      )}

      {inspection && inspection.fieldCount > 0 && (
        <>
          <div data-kind="flatten-summary" className="border border-slate-200 rounded-md p-3 flex flex-col gap-1">
            <strong className="text-slate-900">
              {inspection.fieldCount} form field{inspection.fieldCount > 1 ? "s" : ""} ({inspection.widgetCount} on the pages) will be flattened
            </strong>
            <span className="text-xs text-slate-600">Each field&apos;s current value becomes fixed page content.</span>
          </div>

          {kept.length > 0 && (
            <div data-kind="flatten-kept" className="border border-sky-200 bg-sky-50 text-sky-900 rounded-md p-3 text-xs flex flex-col gap-1">
              <strong>Other annotations are kept, not flattened</strong>
              <span>
                {inspection.keptTotal} annotation{inspection.keptTotal > 1 ? "s" : ""}: {kept.map(([t, n]) => `${n} ${t}`).join(", ")}. Flattening here covers form fields only. These stay as they are in the
                copy; none are removed.
              </span>
            </div>
          )}

          {inspection.warnings
            .filter((w) => !/will be kept as they are/.test(w))
            .map((w) => (
              <p key={w} role="status" className="border border-amber-300 bg-amber-50 text-amber-900 rounded-md p-3 text-xs">
                {w}
              </p>
            ))}
          {inspection.emptyAppearanceFields.length > 0 && (
            <p role="status" className="border border-amber-300 bg-amber-50 text-amber-900 rounded-md p-3 text-xs">
              No visible appearance in the file for: {inspection.emptyAppearanceFields.join(", ")}. They contribute nothing visible and are removed.
            </p>
          )}

          <div role="alert" className="border border-red-200 bg-red-50 text-red-900 rounded-md p-3 text-xs flex flex-col gap-1">
            <strong>Flattening cannot be undone in the new copy</strong>
            <span>The fields become fixed page content and can no longer be edited or filled. Your original file is not changed, and the flattened copy is added to Outputs.</span>
          </div>

          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={confirmed} disabled={running} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I understand that the flattened copy cannot be edited as a form.</span>
          </label>
        </>
      )}

      {report && (
        <div data-kind="flatten-report" className="border border-green-200 bg-green-50 text-green-900 rounded-md p-3 text-xs flex flex-col gap-1">
          <strong>
            Flattened {report.fieldsFlattened} field{report.fieldsFlattened === 1 ? "" : "s"}; checks on the reopened copy:
          </strong>
          <ul className="list-disc pl-4">
            {report.verification.map((v) => (
              <li key={v.check}>
                {v.ok ? "Passed" : "Failed"}: {v.check}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
