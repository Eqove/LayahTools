# DOCX Merge — Developer Notes

Browser-local merge of two or more `.docx` files. Public entry point:
`src/lib/docx/merge.ts` (`mergeDocxDocuments`). Pure TypeScript; no UI, backend, network or AI,
and no PDF imports.

> **Scope:** this is a merge of a supported WordprocessingML subset, not a full Word clone.
> Unsupported package structures are refused rather than dropped. Do not describe the output as
> "fully Word-compatible" or "lossless".

---

## 1. How a merge runs

1. Every input is read into a private byte copy and validated (`validateDocxFile`): name/MIME,
   size, OLE/encryption signature, ZIP signature, entry/size limits, required parts, and
   well-formed main document XML.
2. Optional parts (`styles.xml`, `numbering.xml`, `word/_rels/document.xml.rels`,
   `[Content_Types].xml`) are read for every input. A corrupt optional part is a typed failure.
3. The first document is the **host**. The uncompressed total across all inputs is checked.
4. Every **non-host** document is inspected for unsupported content before any package work.
   Any finding refuses the whole merge (`UNSUPPORTED_STRUCTURE`, with
   `MERGE_CONTENT_UNSUPPORTED` warnings).
5. Bookmarks are planned, relationships/media are imported, styles and numbering are
   reconciled, then the bodies are spliced.
6. The host in-memory ZIP is re-saved, then the output is validated again and structurally
   verified. A failed verification returns no bytes.

Array order is merge order. Duplicate entries are merged as many times as supplied. A single
input is a validated pass-through re-save.

---

## 2. Supported merge structures

| Structure | Behaviour |
| --- | --- |
| Paragraphs, runs, tables, nested tables | Imported in order; paragraph/table counts preserved. |
| Lists / numbering | Imported definitions get fresh numeric IDs; `w:numId` references remapped. |
| Paragraph and character styles | Missing definitions imported verbatim; first document wins conflicts. |
| Embedded images (`image` relationship, internal target) | Media bytes copied unchanged; reference remapped; content type registered. |
| External hyperlinks (`hyperlink` relationship, `TargetMode="External"`) | Exact URL preserved; new external relationship created; `r:id` remapped. |
| Bookmarks | Unique numeric IDs; start/end remapped; names preserved unless they collide. |
| Internal anchors (`w:hyperlink w:anchor`) | Rewritten with bookmark renames; must resolve in the same source or the host. |
| Field instructions (`w:fldSimple`, `w:instrText`) | Bookmark names updated in a single pass; names split across runs are refused. |
| Inline/anchored pictures | Preserved as DrawingML; only their media relationships are remapped. |
| Sections | Earlier sources' body-level `sectPr` becomes an inline break; the last source with one supplies the final body-level `sectPr`. |
| Namespaces | Missing root declarations copied; `mc:Ignorable` unioned and filtered to declared prefixes. |

---

## 3. Structures that are refused (non-host inputs)

Detected by `merge/unsupported.ts`. Presence in a **non-host** input fails the whole merge; the
host may retain any of them because its own package is only appended to.

- Headers and footers (parts and `w:headerReference` / `w:footerReference`)
- Footnotes and endnotes (parts and references)
- Comments (parts, `w:commentReference`, comment ranges)
- Charts and chart-ex drawings (`c:` / `cx:` content)
- SmartArt diagrams (`dgm:` content)
- OLE objects and embedded packages (`w:object`, `o:OLEObject`, `word/embeddings/`)
- Custom XML parts and `w:customXml` markup
- Digital signatures (`_xmlsignatures/`)
- ActiveX controls (parts and `w:control`)
- Embedded fonts (`word/fonts/`)
- `altChunk` content
- Subdocuments (`w:subDoc`)
- Glossary documents
- Picture bullets / relationship-dependent numbering
- Unknown relationship types
- External (linked) images, internal hyperlink relationships, missing media parts
- Malformed bookmarks, duplicate relationship IDs, missing or non-image media content types

These are rejected, never silently discarded. `w:object`, chart, diagram and similar checks look
at the body XML, so an unsupported structure is caught even when its part happens to be absent.

---

## 4. Fail-closed behaviour

- Every public call returns `DocxProcessingResult`: `{ ok: true, value, warnings }` or
  `{ ok: false, error, warnings }`. It never rejects for bad input.
- No partial output: bytes are returned only after the saved package re-validates and the
  structural verification passes.
- Failures use the existing closed error-code set (`INVALID_FILE`, `UNSUPPORTED_FORMAT`,
  `CORRUPTED_PACKAGE`, `EMPTY_DOCUMENT`, `ENCRYPTED_DOCUMENT`, `UNSUPPORTED_STRUCTURE`,
  `PROCESSING_FAILURE`). No merge-specific error codes were added.
- Warning codes are fixed: `MERGE_STYLE_CONFLICT`, `MERGE_CONTENT_UNSUPPORTED`,
  `MERGE_TEXT_MISMATCH` (plus the shared package warnings).
- Error `message` is user-facing; raw XML / technical evidence stays in `detail`.
- Inputs are never mutated. Verification reads every input back and compares it byte-for-byte,
  on success and on failure.

---

## 5. Style conflict behaviour

- The host `styles.xml` is the base. `w:docDefaults` and `w:latentStyles` are host-only.
- A style missing from the host is imported verbatim.
- The same `styleId` with a **different** definition is skipped and reported as
  `MERGE_STYLE_CONFLICT`. The first document's definition is used.
- A missing or different non-host `w:docDefaults` is reported, not imported, because adopting it
  would silently reformat host content.
- Style IDs are never renamed or duplicated, so imported body references keep resolving.

---

## 6. Numbering reconciliation

- Imported `w:abstractNum` and `w:num` definitions receive fresh numeric IDs above the host's
  existing IDs. IDs are numbers, never concatenated strings.
- `w:numId` references in imported body content and `w:num` → `w:abstractNumId` links are
  rewritten through per-document maps.
- A source that uses lists without a numbering part, references a missing definition, or uses
  picture bullets is refused.

---

## 7. Relationship and media handling

- Relationship IDs are scoped to the `.rels` part that owns them. Only the source's
  `word/_rels/document.xml.rels` is imported, and only into the host's document relationships.
- New relationship IDs are allocated numerically above the host's existing `rId<n>` values and
  never collide with a host ID.
- Only internal `image` and external `hyperlink` relations may appear in imported body content.
  Every other use is refused.
- Media bytes are copied unchanged into `word/media/`. Destination names are deterministic and
  collision-free (`image1.png`, `image1-2.png`, ...), and the copy is scoped to one source so two
  different files with the same name cannot share bytes.
- The source content type must be an `image/*` type. Missing declarations are refused. When the
  host already binds the extension to a different type, a part-level `Override` is added instead
  of changing host semantics.
- Hyperlink targets are copied exactly and never fetched. `TargetMode="External"` is always set.

---

## 8. Bookmark handling

- Imported bookmarks receive the smallest free non-negative IDs; start/end pairs are remapped.
- Names are preserved unless they collide with the host or an earlier import. A collision gets a
  deterministic `_<n>` suffix (40-character limit respected).
- Internal anchors and field instructions (`REF`, `PAGEREF`, `HYPERLINK \l`, ...) follow the
  rename in a single pass, so chained renames do not rewrite a token twice.
- A name split across field runs is refused. An anchor that matches only another imported source
  is refused as ambiguous.
- Imported bookmark pairing is verified. Host-only bookmarks pass through untouched, though
  global ID/name uniqueness and anchor resolution are still checked.

---

## 9. Section-property behaviour

- The host body's `sectPr` is removed and re-used as an inline break when a later source supplies
  the final section; otherwise it is restored as the body-level `sectPr`.
- Each earlier source's body-level `sectPr` becomes a paragraph-level `sectPr` on a new empty
  paragraph after that source's content.
- The last source with a body-level `sectPr` supplies the final one.
- More than one body-level `sectPr` in an input is refused. Header/footer references in section
  properties are refused.

---

## 10. Verification

Structural checks are authoritative and throw if they fail (no output is returned):

- Output re-validates as a DOCX package.
- At most one body-level `sectPr`, and it is last.
- Every body `r:*` reference resolves in the document relationship scope; every internal
  relationship target exists; media parts are readable and carry image content types.
- Imported hyperlink targets exist and are external.
- Content types cover every entry; no Override points at a missing part.
- Numbering and style references resolve; IDs are unique.
- Bookmark IDs/names are unique, imported pairs match, every anchor resolves.
- Namespace prefixes and `mc:Ignorable` tokens resolve.
- Paragraph/table counts match the inputs plus generated section breaks, and `<w:t>` text appears
  in input order.
- Every input still reads back byte-identically.

Mammoth is used only as a tolerant text cross-check. `MERGE_TEXT_MISMATCH` is a warning and never
downgrades a structural failure. Mammoth's known limitations (tables, text boxes, fields) can
therefore produce a warning on a structurally sound document.

---

## 11. Limits and resource handling

`DEFAULT_DOCX_LIMITS` (`src/lib/docx/constants.ts`): 50 MiB file, 2000 entries, 200 MiB declared
uncompressed total, 64 MiB per entry, compression-ratio warning above 200:1. Limits are enforced
before decompression where the ZIP directory allows it and again on each part's real byte length.
The same limits apply to the saved output and to verification.

Multi-file work is sequential: inputs are validated, imported and serialised one at a time. Every
part is read through `readDocxEntry`, which never returns more than `maxEntryBytes`.

---

## 12. Known limitations

- No headers/footers, notes, comments, charts, SmartArt, OLE, ActiveX, custom XML, signatures,
  embedded fonts, `altChunk`, subdocuments or glossary content in imported documents.
- Themes, `settings.xml`, `fontTable.xml` and `webSettings.xml` are not imported, so imported
  content uses the host's theme/fonts/settings where those are referenced indirectly.
- Tracked changes are copied as ordinary body XML; the merge does not accept/reject revisions.
- Images are not decoded, transcoded or deduplicated by content hash. A source that is merged
  twice contributes its media twice.
- Fields that reference a bookmark unrelated to a rename are not re-evaluated or repaired.
- Media/relationship handling is limited to the main document part.
- A crafted ZIP whose directory lies about uncompressed sizes is caught only after that part is
  decompressed; the per-part size check still refuses oversized results, but a hostile archive
  can force one bounded decompression.
- Output correctness is verified structurally and with macOS `textutil`; it has not been opened
  in Microsoft Word or LibreOffice on this machine.

---

## 13. Tests

```bash
cd pdf-tool-app
npm run test:docx     # all DOCX suites (foundation, text, metadata, merge)
npx tsx scripts/test-docx-merge.ts   # merge suite only
```

The merge suite builds fixtures in memory (paragraphs, tables, numbering, images, hyperlinks,
bookmarks, sections, namespaces, corrupt packages) and also merges real `.docx` files when they
are present on the machine. Real fixtures are read-only inputs.
