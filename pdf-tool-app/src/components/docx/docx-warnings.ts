/** Warning presentation helpers. Pure functions only. */

import type { DocxWarning } from "@/lib/docx/types";

/**
 * Removes exact duplicates. Processors can legitimately report the same finding through more
 * than one stage (for example a validation warning and a processing warning), and showing the
 * same sentence twice in a result panel is noise.
 */
export function uniqueDocxWarnings(warnings: readonly DocxWarning[]): DocxWarning[] {
  const seen = new Set<string>();
  const result: DocxWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}\u0000${warning.message}\u0000${warning.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(warning);
  }

  return result;
}
