import type { Metadata } from "next";
import { DocxWorkspace } from "@/components/docx/DocxWorkspace";

export const metadata: Metadata = {
  title: "DOCX Workspace | LayahTools",
  description:
    "Add Word documents to a local queue, review validation feedback, and arrange the order you want to work in.",
};

export default function DocxPage() {
  return <DocxWorkspace />;
}
