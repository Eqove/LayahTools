const PAGE_RANGE_SEGMENT = /^(\d+)(?:-(\d+))?$/;

export function parsePageRanges(input: string, totalPages: number): number[] {
  if (!input.trim()) {
    throw new Error("Enter at least one page or range.");
  }

  const pages = new Set<number>();
  const segments = input
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const match = PAGE_RANGE_SEGMENT.exec(segment);

    if (!match) {
      throw new Error(`Invalid page segment "${segment}". Use formats like 1, 3-5.`);
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;

    if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
      throw new Error(`Pages must stay between 1 and ${totalPages}.`);
    }

    const from = Math.min(start, end);
    const to = Math.max(start, end);

    for (let page = from; page <= to; page += 1) {
      pages.add(page - 1);
    }
  }

  return [...pages].sort((left, right) => left - right);
}

export function parseSplitRanges(input: string, totalPages: number): number[][] {
  if (!input.trim()) {
    throw new Error("Enter one or more page ranges to split.");
  }

  return input
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => parsePageRanges(segment, totalPages));
}
