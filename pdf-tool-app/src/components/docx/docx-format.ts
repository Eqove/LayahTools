/** Shared formatting for DOCX result views. Pure functions only. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = value >= 10 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
}

/** Grouped digits, e.g. 12345 -> "12,345". Fixed locale so server and client agree. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Formats an ISO 8601 timestamp from document properties.
 *
 * Document dates are stored as UTC and are shown as UTC so the same file does not appear to have
 * been created at different times in different timezones.
 */
export function formatMetadataDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(time));
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
