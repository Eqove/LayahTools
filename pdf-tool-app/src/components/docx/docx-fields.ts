/**
 * Display labels for the DOCX metadata fields the workspace can show.
 *
 * The inspection result lists every supported field so "not set" is visibly different from
 * "populated". Removal results reuse the same labels for the fields that were removed.
 */

import type { DocxMetadata } from "@/lib/docx/types";

export interface DocxFieldDefinition {
  field: keyof DocxMetadata;
  label: string;
  kind: "text" | "number" | "date";
}

export const DOCX_FIELD_LABELS: Record<keyof DocxMetadata, string> = {
  title: "Title",
  subject: "Subject",
  creator: "Author",
  description: "Description",
  keywords: "Keywords",
  lastModifiedBy: "Last modified by",
  revision: "Revision",
  category: "Category",
  created: "Created",
  modified: "Last modified",
  application: "Application",
  applicationVersion: "Application version",
  company: "Company",
  manager: "Manager",
  pages: "Pages (last saved)",
  words: "Words (last saved)",
  characters: "Characters (last saved)",
};

export const DOCX_CORE_FIELDS: readonly DocxFieldDefinition[] = [
  { field: "title", label: DOCX_FIELD_LABELS.title, kind: "text" },
  { field: "subject", label: DOCX_FIELD_LABELS.subject, kind: "text" },
  { field: "creator", label: DOCX_FIELD_LABELS.creator, kind: "text" },
  { field: "description", label: DOCX_FIELD_LABELS.description, kind: "text" },
  { field: "keywords", label: DOCX_FIELD_LABELS.keywords, kind: "text" },
  { field: "lastModifiedBy", label: DOCX_FIELD_LABELS.lastModifiedBy, kind: "text" },
  { field: "revision", label: DOCX_FIELD_LABELS.revision, kind: "text" },
  { field: "category", label: DOCX_FIELD_LABELS.category, kind: "text" },
  { field: "created", label: DOCX_FIELD_LABELS.created, kind: "date" },
  { field: "modified", label: DOCX_FIELD_LABELS.modified, kind: "date" },
];

export const DOCX_APPLICATION_FIELDS: readonly DocxFieldDefinition[] = [
  { field: "application", label: DOCX_FIELD_LABELS.application, kind: "text" },
  { field: "applicationVersion", label: DOCX_FIELD_LABELS.applicationVersion, kind: "text" },
  { field: "company", label: DOCX_FIELD_LABELS.company, kind: "text" },
  { field: "manager", label: DOCX_FIELD_LABELS.manager, kind: "text" },
  { field: "pages", label: DOCX_FIELD_LABELS.pages, kind: "number" },
  { field: "words", label: DOCX_FIELD_LABELS.words, kind: "number" },
  { field: "characters", label: DOCX_FIELD_LABELS.characters, kind: "number" },
];

export const getDocxFieldLabel = (field: keyof DocxMetadata): string =>
  DOCX_FIELD_LABELS[field] ?? field;
