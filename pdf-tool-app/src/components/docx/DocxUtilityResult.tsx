"use client";

import { TXT_MIME_TYPE, toTxtFileName } from "@/lib/docx/docx-to-txt";
import type {
  DocxMergeSourceReport,
  DocxMergeVerification,
} from "@/lib/docx/merge/types";
import type { DocxCleanupVerification } from "@/lib/docx/remove-metadata";
import type { DocxMetadata, DocxWarning } from "@/lib/docx/types";
import {
  DOCX_APPLICATION_FIELDS,
  DOCX_CORE_FIELDS,
  getDocxFieldLabel,
  type DocxFieldDefinition,
} from "./docx-fields";
import { formatBytes, formatCount, formatMetadataDate, pluralize } from "./docx-format";
import {
  DocxCheckList,
  DocxCopyButton,
  DocxDownloadButton,
  DocxFactList,
  DocxResultShell,
  DocxStatGrid,
  type DocxCheck,
} from "./DocxResultParts";
import type { DocxSuccessState } from "./useDocxUtility";

interface ResultProps<K extends DocxSuccessState["utility"]> {
  value: Extract<DocxSuccessState, { utility: K }>["value"];
  warnings: readonly DocxWarning[];
  sources: readonly string[];
}

function ExtractedTextResult({ value, warnings }: ResultProps<"extract-text">) {
  return (
    <DocxResultShell
      title="Extracted text"
      description={`From ${value.fileName}. Formatting, images and layout are not reproduced.`}
      warnings={warnings}
    >
      <DocxStatGrid
        stats={[
          { label: "Characters", value: formatCount(value.characterCount) },
          { label: "Words (approx.)", value: formatCount(value.wordCount) },
        ]}
      />

      {value.text ? (
        <>
          <div
            tabIndex={0}
            role="group"
            aria-label={`Extracted text from ${value.fileName}`}
            className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-layah-primary focus-visible:ring-offset-2"
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
              {value.text}
            </pre>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DocxCopyButton text={value.text} />
            <DocxDownloadButton
              blob={new Blob([value.text], { type: TXT_MIME_TYPE })}
              fileName={toTxtFileName(value.fileName)}
              label="Download as TXT"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Downloads stay on this device. Nothing is uploaded.
          </p>
        </>
      ) : (
        <p
          role="status"
          className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-relaxed text-slate-600"
        >
          No extractable text was found in this document. It may contain only images, drawings
          or content this extractor cannot read.
        </p>
      )}
    </DocxResultShell>
  );
}

function TxtConversionResult({ value, warnings }: ResultProps<"docx-to-txt">) {
  return (
    <DocxResultShell
      title="Plain-text file ready"
      description={`Converted ${value.fileName} to ${value.outputFileName}.`}
      warnings={warnings}
    >
      <DocxFactList
        rows={[
          { label: "Source document", value: value.fileName },
          {
            label: "Output file",
            value: <span className="font-medium">{value.outputFileName}</span>,
          },
          { label: "Format", value: "Plain text, UTF-8, no byte-order mark" },
          { label: "Characters", value: formatCount(value.characterCount) },
          { label: "Words (approx.)", value: formatCount(value.wordCount) },
          { label: "File size", value: formatBytes(value.byteLength) },
        ]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DocxDownloadButton
          blob={value.blob}
          fileName={value.outputFileName}
          label="Download TXT file"
        />
      </div>

      {value.text.length === 0 && (
        <p className="mt-3 text-sm text-slate-600">
          The source contains no extractable text, so the TXT file is empty.
        </p>
      )}

      <p className="mt-2 text-xs text-slate-500">
        The file is built in your browser and is not uploaded anywhere.
      </p>
    </DocxResultShell>
  );
}

function MetadataGroup({
  title,
  fields,
  metadata,
}: {
  title: string;
  fields: readonly DocxFieldDefinition[];
  metadata: DocxMetadata;
}) {
  return (
    <section>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <dl className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
        {fields.map((definition) => {
          const raw = metadata[definition.field];
          const populated =
            typeof raw === "number" || (typeof raw === "string" && raw.trim().length > 0);

          return (
            <div
              key={definition.field}
              className="grid gap-0.5 bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-baseline sm:gap-4"
            >
              <dt className="text-sm text-slate-600">{definition.label}</dt>
              <dd className="min-w-0 break-words text-sm">
                {!populated ? (
                  <span className="italic text-slate-400">Not set</span>
                ) : definition.kind === "date" ? (
                  <time dateTime={String(raw)} className="text-slate-900">
                    {formatMetadataDate(String(raw))}
                  </time>
                ) : definition.kind === "number" ? (
                  <span className="text-slate-900">{formatCount(Number(raw))}</span>
                ) : (
                  <span className="text-slate-900">{String(raw)}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function MetadataResult({
  value,
  warnings,
  sources,
}: ResultProps<"inspect-metadata">) {
  const populatedCount = Object.keys(value).length;

  return (
    <DocxResultShell
      title="Document properties"
      description={`Supported properties read from ${sources[0] ?? "the selected document"}.`}
      warnings={warnings}
    >
      {populatedCount === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          No supported document properties are set in this file.
        </p>
      ) : (
        <div className="space-y-5">
          <MetadataGroup
            title="Document properties"
            fields={DOCX_CORE_FIELDS}
            metadata={value}
          />
          <MetadataGroup
            title="Application properties"
            fields={DOCX_APPLICATION_FIELDS}
            metadata={value}
          />
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Only the supported properties stored in the document-properties parts are shown. This
        is not a complete inspection of every kind of metadata a Word file can contain.
      </p>
    </DocxResultShell>
  );
}

const CLEANUP_CHECKS: readonly {
  key: keyof DocxCleanupVerification;
  label: string;
}[] = [
  { key: "packageValid", label: "Cleaned package passed full DOCX validation" },
  { key: "metadataRemovalConfirmed", label: "Supported properties are no longer readable" },
  { key: "documentContentUnchanged", label: "Document content is byte-for-byte unchanged" },
  { key: "otherPartsUnchanged", label: "All other package parts are byte-for-byte unchanged" },
];

function MetadataRemovalResult({ value, warnings }: ResultProps<"remove-metadata">) {
  const checks: DocxCheck[] = CLEANUP_CHECKS.map((check) => ({
    label: check.label,
    ok: value.verification[check.key],
  }));

  return (
    <DocxResultShell
      title="Cleaned copy ready"
      description={`${value.outputFileName} was built and verified in your browser. The original upload was not changed.`}
      warnings={warnings}
    >
      <DocxStatGrid
        stats={[
          { label: "Properties removed", value: formatCount(value.removedProperties.length) },
          { label: "Empty fields removed", value: formatCount(value.emptyProperties.length) },
          { label: "Output size", value: formatBytes(value.byteLength) },
        ]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DocxDownloadButton
          blob={value.blob}
          fileName={value.outputFileName}
          label="Download cleaned DOCX"
        />
      </div>

      <div className="mt-5">
        <DocxCheckList checks={checks} title="Checks confirmed" />
      </div>

      <section className="mt-5" aria-label="Removed properties">
        <h4 className="text-sm font-semibold text-slate-900">Removed properties</h4>
        {value.removedProperties.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            No supported property held a value in this document.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {value.removedProperties.map((property) => (
              <li
                key={`${property.field}-${property.part}-${property.element}`}
                className="flex flex-col gap-0.5 bg-white px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
              >
                <span className="text-sm font-medium text-slate-800">
                  {getDocxFieldLabel(property.field)}
                </span>
                <span className="break-all text-[11px] text-slate-500">
                  {property.element} &middot; {property.part}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {value.emptyProperties.length > 0 && (
        <section className="mt-5" aria-label="Empty supported fields removed">
          <h4 className="text-sm font-semibold text-slate-900">
            Supported fields removed without a value
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            These elements existed but never carried information. They are removed as well.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {value.emptyProperties.map((property) => (
              <li
                key={`${property.field}-${property.part}-${property.element}`}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
              >
                {getDocxFieldLabel(property.field)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {value.retainedProperties.length > 0 && (
        <section className="mt-5" aria-label="Retained properties">
          <h4 className="text-sm font-semibold text-slate-900">
            Properties outside supported coverage
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            These elements were left in place. Their values are not displayed.
          </p>
          <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {value.retainedProperties.map((property) => (
              <li
                key={`${property.part}-${property.element}`}
                className="flex flex-col gap-0.5 bg-white px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
              >
                <span className="break-all text-sm text-slate-800">
                  {property.element}
                </span>
                <span className="text-[11px] text-slate-500">
                  {property.part} &middot; {property.valuePresent ? "contains a value" : "empty"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {value.retainedParts.length > 0 && (
        <section className="mt-5" aria-label="Retained metadata parts">
          <h4 className="text-sm font-semibold text-slate-900">Retained metadata parts</h4>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {value.retainedParts.map((part) => (
              <li key={part} className="break-all">
                {part}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
        <h4 className="text-sm font-semibold text-slate-900">What this does not remove</h4>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          This tool removes only the supported document and application properties listed above.
          Custom properties, thumbnails, tracked changes, comments, embedded objects and other
          parts may still contain identifying information. This is not complete anonymization.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          The cleaned copy was produced separately; your uploaded file remains unchanged.
        </p>
      </section>
    </DocxResultShell>
  );
}

const MERGE_CHECKS: readonly { key: keyof DocxMergeVerification; label: string }[] = [
  { key: "packageValid", label: "Merged package passed full DOCX validation" },
  { key: "documentBodyValid", label: "Document body has a valid structure" },
  { key: "paragraphOrderPreserved", label: "Paragraphs and tables are preserved in order" },
  { key: "numberingResolved", label: "Numbering references resolve" },
  { key: "styleReferencesResolved", label: "Style references resolve" },
  { key: "relationshipsResolved", label: "Relationships and their targets resolve" },
  { key: "mediaPreserved", label: "Imported media is present and readable" },
  { key: "hyperlinksPreserved", label: "Imported hyperlinks keep their targets" },
  { key: "bookmarksValid", label: "Bookmarks and internal anchors are valid" },
  { key: "namespacesValid", label: "Namespaces used by the output are declared" },
  { key: "inputsUnchanged", label: "Original inputs were not modified" },
  { key: "textPreserved", label: "Extracted text matches the source order" },
];

function describeImports(source: DocxMergeSourceReport): string {
  const parts: string[] = [];
  const add = (count: number, singular: string) => {
    if (count > 0) parts.push(`${count} ${pluralize(count, singular)}`);
  };

  add(source.stylesImported, "style");
  add(source.numberingImported, "numbering definition");
  add(source.mediaImported, "media file");
  add(source.hyperlinksImported, "hyperlink");
  add(source.bookmarksRenumbered, "renamed bookmark");

  return parts.length > 0
    ? `Imported ${parts.join(", ")}.`
    : "No additional parts were imported from this document.";
}

function MergeResult({ value, warnings }: ResultProps<"merge">) {
  const checks: DocxCheck[] = MERGE_CHECKS.map((check) => ({
    label: check.label,
    ok: value.verification[check.key],
  }));

  return (
    <DocxResultShell
      title="Merged document ready"
      description={`${value.sourceCount} documents merged in queue order into ${value.outputFileName}.`}
      warnings={warnings}
    >
      <DocxStatGrid
        stats={[
          { label: "Documents", value: formatCount(value.sourceCount) },
          { label: "Paragraphs", value: formatCount(value.merged.paragraphs) },
          { label: "Tables", value: formatCount(value.merged.tables) },
          { label: "Styles", value: formatCount(value.merged.styles) },
          { label: "Media imported", value: formatCount(value.merged.media) },
          { label: "Hyperlinks imported", value: formatCount(value.merged.hyperlinks) },
          { label: "Bookmarks imported", value: formatCount(value.merged.bookmarks) },
          { label: "Section breaks", value: formatCount(value.merged.sectionBreaks) },
          { label: "Output size", value: formatBytes(value.byteLength) },
        ]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DocxDownloadButton
          blob={value.blob}
          fileName={value.outputFileName}
          label="Download merged DOCX"
        />
      </div>

      <section className="mt-5" aria-label="Merge sources">
        <h4 className="text-sm font-semibold text-slate-900">Sources, in merge order</h4>
        <ol className="mt-2 space-y-2">
          {value.sources.map((source, index) => (
            <li
              key={`${source.fileName}-${index}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 break-words text-sm font-medium text-slate-900">
                  {index + 1}. {source.fileName}
                </p>
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {index === 0 ? "Host document" : `Document ${index + 1}`}
                </span>
              </div>
              <p className="mt-1 break-words text-xs leading-relaxed text-slate-500">
                {formatCount(source.paragraphCount)}{" "}
                {pluralize(source.paragraphCount, "paragraph")},{" "}
                {formatCount(source.tableCount)} {pluralize(source.tableCount, "table")}.{" "}
                {index === 0 ? "Supplied the host package and layout." : describeImports(source)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-5">
        <DocxCheckList checks={checks} title="Merge verified" />
      </div>
    </DocxResultShell>
  );
}

/** Renders the success state for whichever utility produced it. */
export function DocxUtilityResult({ state }: { state: DocxSuccessState }) {
  switch (state.utility) {
    case "extract-text":
      return (
        <ExtractedTextResult
          value={state.value}
          warnings={state.warnings}
          sources={state.sources}
        />
      );
    case "docx-to-txt":
      return (
        <TxtConversionResult
          value={state.value}
          warnings={state.warnings}
          sources={state.sources}
        />
      );
    case "inspect-metadata":
      return (
        <MetadataResult
          value={state.value}
          warnings={state.warnings}
          sources={state.sources}
        />
      );
    case "remove-metadata":
      return (
        <MetadataRemovalResult
          value={state.value}
          warnings={state.warnings}
          sources={state.sources}
        />
      );
    case "merge":
      return (
        <MergeResult value={state.value} warnings={state.warnings} sources={state.sources} />
      );
  }
}
