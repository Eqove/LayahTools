import type { ToolDescriptor } from "@/lib/pdf/types";

export const TOOL_CONFIG: ToolDescriptor[] = [
  {
    id: "merge",
    name: "Merge PDF",
    summary: "Combine multiple PDFs into one clean final file.",
    acceptsMultiple: true,
    primaryLabel: "Merge Files",
  },
  {
    id: "split",
    name: "Split PDF",
    summary: "Break a PDF into multiple files using page ranges.",
    acceptsMultiple: false,
    primaryLabel: "Split PDF",
  },
  {
    id: "extract",
    name: "Extract Pages",
    summary: "Pull just the pages you need into a new document.",
    acceptsMultiple: false,
    primaryLabel: "Extract Pages",
  },
  {
    id: "delete",
    name: "Delete Pages",
    summary: "Remove unwanted pages before you send the file.",
    acceptsMultiple: false,
    primaryLabel: "Delete Pages",
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    summary: "Fix upside-down scans with a single action.",
    acceptsMultiple: false,
    primaryLabel: "Rotate Pages",
  },
  {
    id: "watermark",
    name: "Add Watermark",
    summary: "Stamp draft, confidential, or brand text across pages.",
    acceptsMultiple: false,
    primaryLabel: "Add Watermark",
  },
  {
    id: "page-numbers",
    name: "Page Numbers",
    summary: "Insert clean page numbers for submissions and reviews.",
    acceptsMultiple: false,
    primaryLabel: "Add Numbers",
  },
  {
    id: "blank",
    name: "Create Blank PDF",
    summary: "Start from scratch and place text on a fresh page.",
    acceptsMultiple: false,
    primaryLabel: "Create PDF",
  },
];
