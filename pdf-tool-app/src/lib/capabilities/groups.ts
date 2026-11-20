/** How tools are grouped in menus, the six "start here" tools, and plain-word tool search. Pure: no React. */
import { CAPABILITY_REGISTRY } from "./registry";
import type { Capability } from "./types";

export const TOOL_GROUPS = [
  { id: "organize", title: "Organize pages" },
  { id: "create", title: "Create & edit" },
  { id: "secure", title: "Secure" },
  { id: "understand", title: "Understand & extract" },
  { id: "convert", title: "Convert" },
]
  .map((g) => ({ ...g, items: Object.values(CAPABILITY_REGISTRY).filter((c) => c.category === g.id) }))
  .filter((g) => g.items.length > 0);

/** The big cards shown after a file is dropped. Everything else is under "More tools". */
export const TOP_TOOLS: { id: string; label: string; hint: string; icon: string }[] = [
  { id: "pdf.edit", label: "Edit", hint: "Change text, add text, images, shapes", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
  { id: "pdf.sign", label: "Sign", hint: "Put your signature on it", icon: "M3 17c3-3 5-9 8-9s1 7 4 7 3-3 6-3M3 21h18" },
  { id: "pdf.merge", label: "Merge", hint: "Join several PDFs into one", icon: "M8 7h8M8 12h8m-8 5h8M4 4h16v16H4z" },
  { id: "pdf.compress", label: "Compress", hint: "Make the file smaller", icon: "M9 9V4m0 5H4m0 0l5-5m6 5V4m0 5h5m0 0l-5-5M9 15v5m0-5H4m0 0l5 5m6-5v5m0-5h5m0 0l-5 5" },
  { id: "pdf.pdf-to-image", label: "To image", hint: "Save pages as JPG or PNG", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "pdf.split", label: "Split", hint: "Break it into smaller PDFs", icon: "M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" },
];

/** Everyday words people type for each tool. */
const KEYWORDS: Record<string, string> = {
  "pdf.merge": "combine join together append add files one file",
  "pdf.split": "separate divide break cut apart",
  "pdf.extract": "pull out take pages save pages copy pages",
  "pdf.delete": "remove pages erase pages",
  "pdf.rotate": "turn sideways flip orientation landscape portrait",
  "pdf.watermark": "stamp confidential draft logo",
  "pdf.page-numbers": "number pages numbering footer",
  "pdf.blank": "new empty create start",
  "pdf.rearrange": "reorder move pages order sort organize organise",
  "pdf.redact": "hide black out blackout censor sensitive private",
  "pdf.sign": "signature autograph initials esign",
  "pdf.compress": "smaller reduce size shrink optimize optimise email small",
  "pdf.ocr": "scan scanned searchable recognize recognise read text",
  "pdf.pdf-to-image": "jpg jpeg png image picture photo convert",
  "pdf.extract-text": "copy text txt words",
  "pdf.analyze-structure": "headings outline structure",
  "pdf.extract-tables": "table excel csv spreadsheet rows columns",
  "pdf.edit": "change text modify write type add text image whiteout shapes fix typo",
  "pdf.crop": "trim margins cut edges",
  "pdf.fill-form": "form fields fill in application",
  "pdf.flatten": "lock form fields annotations",
  "pdf.metadata": "properties title author info details",
};

/** Tools matching `query`, best first. Every word must match something (name, everyday word or summary). */
export function searchTools(query: string, tools: Capability[] = Object.values(CAPABILITY_REGISTRY)): Capability[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = tools.map((c) => {
    const name = c.name.toLowerCase();
    const keys = (KEYWORDS[c.id] ?? "").split(" ");
    const summary = c.summary.toLowerCase();
    let score = 0;
    for (const w of words) {
      const s = name.split(/\s+/).some((n) => n.startsWith(w)) ? 3
        : keys.some((k) => k.startsWith(w)) ? 2
        : name.includes(w) || summary.includes(w) ? 1
        : 0;
      if (!s) return { c, score: 0 };
      score += s;
    }
    return { c, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.c);
}
