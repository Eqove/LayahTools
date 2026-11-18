/**
 * Browser-local DOCX merge, phase 9.2.
 *
 * The first document is the host package. Later documents contribute block-level body content,
 * their own style definitions (first document wins on conflicts), their numbering definitions
 * under freshly allocated numeric IDs, embedded images, external hyperlinks and bookmarks.
 * Relationship IDs are re-created in the host document relationship scope; media bytes are
 * copied and bookmarks are renumbered. Everything else that depends on a package part the merge
 * cannot remap is still refused rather than dropped.
 *
 * Every input is validated before any work, every output is re-validated and structurally
 * verified, and a failure never returns partial bytes.
 */

import {
  CONTENT_TYPES_PATH,
  DEFAULT_DOCX_LIMITS,
  DOCUMENT_PATH,
  DOCX_MIME_TYPE,
} from "./constants";
import { DocxErrors, toDocxError } from "./errors";
import { planBookmarks } from "./merge/bookmarks";
import {
  collectBodyText,
  countParagraphs,
  countTables,
  mergeDocumentBodies,
  type BodyMergeSource,
} from "./merge/body";
import { mergeNumbering } from "./merge/numbering";
import { readOptionalPartText } from "./merge/package";
import {
  RelationshipImporter,
  type SourceRelationshipResult,
} from "./merge/relationships";
import { mergeStyles } from "./merge/styles";
import type {
  DocxMergeOptions,
  DocxMergeResult,
  DocxMergeSource,
  DocxMergedDocument,
} from "./merge/types";
import {
  detectUnsupportedDocument,
  unsupportedMergeError,
} from "./merge/unsupported";
import { verifyMerge } from "./merge/verify";
import type {
  DocxFileInfo,
  DocxPackage,
  DocxWarning,
} from "./types";
import { describeDocxInput, readDocxBytes, validateDocxFile } from "./validate";
import { readDocxEntryText, saveDocxPackage } from "./zip";

interface LoadedSource {
  fileName: string;
  bytes: Uint8Array;
  info: DocxFileInfo;
  pkg: DocxPackage;
  document: Document;
  stylesXml: string | null;
  numberingXml: string | null;
  documentRelsXml: string | null;
  contentTypesXml: string;
}

/** `merged-<n>-documents.docx`. Counts are clamped to a sane positive integer. */
export function toMergedDocxFileName(count: number): string {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return `merged-${safeCount}-documents.docx`;
}

function resolveOutputName(name: string | undefined, count: number): string {
  const trimmed = name?.trim();
  if (!trimmed) return toMergedDocxFileName(count);
  return /\.docx$/i.test(trimmed) ? trimmed : `${trimmed}.docx`;
}

function mergeFailureWarnings(warnings: DocxWarning[], findings: ReturnType<typeof detectUnsupportedDocument>): void {
  for (const finding of findings) {
    warnings.push({
      code: "MERGE_CONTENT_UNSUPPORTED",
      message: `"${finding.fileName}" contains ${finding.feature}, which cannot be merged yet.`,
      detail: `${finding.fileName}: ${finding.feature} (${finding.detail})`,
    });
  }
}

/**
 * Runs content preparation that can still fail closed after detection (for example an anchor
 * that only becomes unresolvable once all sources are known). Records a warning before rethrowing.
 */
async function prepareWithWarning<T>(
  warnings: DocxWarning[],
  action: () => Promise<T> | T
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const docxError = toDocxError(error);
    if (docxError.code === "UNSUPPORTED_STRUCTURE") {
      warnings.push({
        code: "MERGE_CONTENT_UNSUPPORTED",
        message: docxError.message,
        detail: docxError.detail ?? docxError.message,
      });
    }
    throw error;
  }
}

/**
 * Merges DOCX documents in the supplied order.
 *
 * Array order is merge order: nothing is sorted and duplicate entries are merged as many times as
 * they are supplied. A single source is a validated pass-through re-save.
 */
export async function mergeDocxDocuments(
  sources: readonly DocxMergeSource[],
  options: DocxMergeOptions = {}
): Promise<DocxMergeResult> {
  const limits = options.limits ?? DEFAULT_DOCX_LIMITS;
  const warnings: DocxWarning[] = [];

  if (sources.length === 0) {
    return {
      ok: false,
      error: DocxErrors.emptyDocument("Select at least one DOCX file to merge."),
      warnings,
    };
  }

  const loaded: LoadedSource[] = [];

  // Optional parts are read here (outside the merge pipeline) because they are not needed for
  // validation. A later source with a corrupted, oversized or non-UTF-8 optional part must still
  // come back as a typed failure, never as a rejected promise escaping the public API.
  try {
    for (const source of sources) {
      let info: DocxFileInfo;
      let bytes: Uint8Array;
      try {
        info = describeDocxInput(source.input, {
          name: source.name,
          mimeType: source.mimeType,
        });
        bytes = await readDocxBytes(source.input);
      } catch (error) {
        return { ok: false, error: toDocxError(error), warnings };
      }

      const validated = await validateDocxFile(bytes, {
        name: info.name,
        mimeType: info.mimeType,
        limits,
      });
      if (!validated.ok) {
        return {
          ok: false,
          error: validated.error,
          warnings: [...warnings, ...validated.warnings],
        };
      }
      warnings.push(...validated.warnings);

      const pkg = validated.value.package;
      loaded.push({
        fileName: validated.value.info.name,
        bytes,
        info: validated.value.info,
        pkg,
        document: validated.value.document,
        stylesXml: await readOptionalPartText(pkg, "word/styles.xml", limits),
        numberingXml: await readOptionalPartText(pkg, "word/numbering.xml", limits),
        documentRelsXml: await readOptionalPartText(
          pkg,
          "word/_rels/document.xml.rels",
          limits
        ),
        contentTypesXml: await readDocxEntryText(pkg, CONTENT_TYPES_PATH, limits),
      });
    }
  } catch (error) {
    return { ok: false, error: toDocxError(error), warnings };
  }

  try {
    const totalUncompressed = loaded.reduce(
      (total, source) => total + source.pkg.info.uncompressedSize,
      0
    );
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw DocxErrors.unsupportedStructure(
        "The selected documents expand to more content than this workspace supports.",
        `${totalUncompressed} bytes, limit ${limits.maxUncompressedBytes}`
      );
    }

    for (let index = 1; index < loaded.length; index++) {
      const findings = await prepareWithWarning(warnings, () =>
        detectUnsupportedDocument(
          loaded[index].document,
          loaded[index].pkg.info.entryNames,
          loaded[index].documentRelsXml,
          loaded[index].contentTypesXml,
          loaded[index].numberingXml,
          loaded[index].fileName
        )
      );
      if (findings.length > 0) {
        mergeFailureWarnings(warnings, findings);
        throw unsupportedMergeError(findings);
      }
    }

    const bookmarkPlans = await prepareWithWarning(warnings, () =>
      planBookmarks(
        loaded[0].document,
        loaded[0].fileName,
        loaded.slice(1).map((source) => ({
          fileName: source.fileName,
          document: source.document,
        }))
      )
    );

    const relationshipImporter = new RelationshipImporter(
      loaded[0].pkg,
      loaded[0].documentRelsXml,
      loaded[0].contentTypesXml,
      limits
    );
    const relationshipResults: SourceRelationshipResult[] = [];
    for (let index = 1; index < loaded.length; index++) {
      relationshipResults.push(
        await prepareWithWarning(warnings, () =>
          relationshipImporter.importSource({
            fileName: loaded[index].fileName,
            document: loaded[index].document,
            pkg: loaded[index].pkg,
            relsXml: loaded[index].documentRelsXml,
            contentTypesXml: loaded[index].contentTypesXml,
          })
        )
      );
    }

    const styleResult = mergeStyles(
      loaded[0].stylesXml,
      loaded.slice(1).map((source) => ({
        fileName: source.fileName,
        stylesXml: source.stylesXml,
      })),
      warnings
    );

    const numberingResult = mergeNumbering(
      loaded[0].numberingXml,
      loaded.slice(1).map((source) => ({
        fileName: source.fileName,
        document: source.document,
        numberingXml: source.numberingXml,
      }))
    );

    const sourceTexts = loaded.map((source) => collectBodyText(source.document));
    const sourceParagraphCounts = loaded.map((source) =>
      countParagraphs(source.document)
    );
    const sourceTableCounts = loaded.map((source) => countTables(source.document));

    const bodySources: BodyMergeSource[] = loaded.map((source, index) => ({
      fileName: source.fileName,
      document: source.document,
      numberIdMap:
        index === 0
          ? new Map<number, number>()
          : (numberingResult.numIdMaps[index - 1] ?? new Map<number, number>()),
      relationshipIdMap:
        index === 0
          ? new Map<string, string>()
          : (relationshipResults[index - 1]?.idMap ?? new Map<string, string>()),
      bookmarkPlan: index === 0 ? undefined : bookmarkPlans.plans[index - 1],
      allowedBookmarkNames: bookmarkPlans.finalNames,
    }));

    const bodyResult = await prepareWithWarning(warnings, () => mergeDocumentBodies(bodySources));
    if (bodyResult.xml) {
      loaded[0].pkg.zip.file(DOCUMENT_PATH, bodyResult.xml);
    }
    if (styleResult.xml) {
      loaded[0].pkg.zip.file("word/styles.xml", styleResult.xml);
    }
    if (numberingResult.xml) {
      loaded[0].pkg.zip.file("word/numbering.xml", numberingResult.xml);
    }
    const updatedRels = relationshipImporter.updatedRelsXml();
    if (updatedRels) {
      loaded[0].pkg.zip.file("word/_rels/document.xml.rels", updatedRels);
    }
    const updatedContentTypes = relationshipImporter.updatedContentTypesXml();
    if (updatedContentTypes) {
      loaded[0].pkg.zip.file(CONTENT_TYPES_PATH, updatedContentTypes);
    }

    const saved = await saveDocxPackage(loaded[0].pkg, { limits });
    const outputFileName = resolveOutputName(options.outputName, loaded.length);

    const verification = await verifyMerge({
      outputBytes: saved.bytes,
      outputFileName,
      limits,
      sourceTexts,
      sourceParagraphCounts,
      sourceTableCounts,
      expectedSectionBreaks: bodyResult.sectionBreaks,
      sourceStyleIds: styleResult.sourceStyleIds,
      inputs: sources.map((source) => source.input),
      inputBytes: loaded.map((source) => source.bytes),
      inputNames: loaded.map((source) => source.fileName),
      importedMediaPaths: relationshipImporter.importedMedia,
      importedHyperlinkTargets: relationshipImporter.importedHyperlinks,
      expectedBookmarkCount:
        bookmarkPlans.hostBookmarkCount +
        bookmarkPlans.plans.reduce((total, plan) => total + plan.bookmarkCount, 0),
      importedBookmarkIds: bookmarkPlans.plans.flatMap((plan) => [...plan.idMap.values()]),
      warnings,
    });

    const importedBookmarks = bookmarkPlans.plans.reduce(
      (total, plan) => total + plan.bookmarkCount,
      0
    );
    const importedMedia = relationshipImporter.importedMedia.length;
    const importedHyperlinks = relationshipImporter.importedHyperlinks.length;

    const value: DocxMergedDocument = {
      fileName: loaded[0].fileName,
      outputFileName,
      mimeType: DOCX_MIME_TYPE,
      bytes: saved.bytes,
      blob: saved.blob,
      byteLength: saved.byteLength,
      sourceCount: loaded.length,
      sources: loaded.map((source, index) => ({
        fileName: source.fileName,
        paragraphCount: sourceParagraphCounts[index],
        tableCount: sourceTableCounts[index],
        stylesImported: index === 0 ? 0 : (styleResult.imported[index - 1] ?? 0),
        numberingImported:
          index === 0 ? 0 : (numberingResult.importedNum[index - 1] ?? 0),
        mediaImported:
          index === 0 ? 0 : (relationshipResults[index - 1]?.mediaImported ?? 0),
        hyperlinksImported:
          index === 0 ? 0 : (relationshipResults[index - 1]?.hyperlinksImported ?? 0),
        bookmarksRenumbered:
          index === 0 ? 0 : (bookmarkPlans.plans[index - 1]?.renamedIds ?? 0),
        sectionBreaks: bodyResult.perSource[index]?.sectionBreaks ?? 0,
      })),
      merged: {
        paragraphs: bodyResult.paragraphCount,
        tables: bodyResult.tableCount,
        styles: styleResult.styleCount,
        numberingDefinitions: numberingResult.numberingDefinitions,
        sectionBreaks: bodyResult.sectionBreaks,
        media: importedMedia,
        hyperlinks: importedHyperlinks,
        bookmarks: importedBookmarks,
      },
      verification,
      warnings,
    };

    return { ok: true, value, warnings };
  } catch (error) {
    return { ok: false, error: toDocxError(error), warnings };
  }
}
