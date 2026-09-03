import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

import { parsePageRanges, parseSplitRanges } from "@/lib/pdf/ranges";

export async function mergePdfFiles(files: File[]) {
  if (files.length < 2) {
    throw new Error("Select at least two PDF files to merge.");
  }

  const merged = await PDFDocument.create();

  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const document = await PDFDocument.load(bytes);
    const copiedPages = await merged.copyPages(document, document.getPageIndices());

    copiedPages.forEach((page) => merged.addPage(page));
  }

  return [
    {
      filename: buildFilename(files[0].name, "merged"),
      bytes: await merged.save(),
    },
  ];
}

export async function splitPdfByRanges(file: File, rangesText: string) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const ranges = parseSplitRanges(rangesText, source.getPageCount());

  return Promise.all(
    ranges.map(async (range, index) => {
      const splitDocument = await PDFDocument.create();
      const copiedPages = await splitDocument.copyPages(source, range);
      copiedPages.forEach((page) => splitDocument.addPage(page));

      return {
        filename: buildFilename(file.name, `part-${index + 1}`),
        bytes: await splitDocument.save(),
      };
    }),
  );
}

export async function extractPdfPages(file: File, pageText: string) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const pages = parsePageRanges(pageText, source.getPageCount());
  const target = await PDFDocument.create();
  const copiedPages = await target.copyPages(source, pages);
  copiedPages.forEach((page) => target.addPage(page));

  return [
    {
      filename: buildFilename(file.name, "extract"),
      bytes: await target.save(),
    },
  ];
}

export async function deletePdfPages(file: File, pageText: string) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const pagesToDelete = parsePageRanges(pageText, source.getPageCount());

  for (const pageIndex of [...pagesToDelete].sort((left, right) => right - left)) {
    source.removePage(pageIndex);
  }

  return [
    {
      filename: buildFilename(file.name, "trimmed"),
      bytes: await source.save(),
    },
  ];
}

export async function rotatePdf(file: File, angle: number) {
  const source = await PDFDocument.load(await file.arrayBuffer());

  source.getPages().forEach((page) => {
    page.setRotation(degrees(angle));
  });

  return [
    {
      filename: buildFilename(file.name, `rotated-${angle}`),
      bytes: await source.save(),
    },
  ];
}

export async function watermarkPdf(file: File, text: string) {
  if (!text.trim()) {
    throw new Error("Enter watermark text.");
  }

  const source = await PDFDocument.load(await file.arrayBuffer());
  const font = await source.embedFont(StandardFonts.HelveticaBold);

  source.getPages().forEach((page) => {
    const { width, height } = page.getSize();

    page.drawText(text, {
      x: width * 0.14,
      y: height * 0.45,
      size: Math.max(28, width * 0.08),
      rotate: degrees(-32),
      font,
      color: rgb(0.84, 0.3, 0.18),
      opacity: 0.18,
    });
  });

  return [
    {
      filename: buildFilename(file.name, "watermarked"),
      bytes: await source.save(),
    },
  ];
}

export async function addPageNumbers(file: File, prefix: string) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const font = await source.embedFont(StandardFonts.Helvetica);
  const totalPages = source.getPageCount();

  source.getPages().forEach((page, index) => {
    const { width } = page.getSize();
    const text = prefix.trim()
      ? `${prefix.trim()} ${index + 1}`
      : `Page ${index + 1} of ${totalPages}`;

    page.drawText(text, {
      x: width - 140,
      y: 18,
      size: 10,
      font,
      color: rgb(0.26, 0.23, 0.19),
    });
  });

  return [
    {
      filename: buildFilename(file.name, "numbered"),
      bytes: await source.save(),
    },
  ];
}

export async function createBlankPdf(options: {
  pageCount: number;
  width: number;
  height: number;
  title: string;
  body: string;
}) {
  const document = await PDFDocument.create();
  const titleFont = await document.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  const pageCount = Math.max(1, options.pageCount);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = document.addPage([options.width, options.height]);

    if (pageIndex === 0) {
      page.drawText(options.title || "Untitled PDF", {
        x: 54,
        y: options.height - 92,
        size: 24,
        font: titleFont,
        color: rgb(0.13, 0.12, 0.11),
      });

      const bodyLines = (options.body || "Add content and export quickly.")
        .split("\n")
        .slice(0, 16);

      bodyLines.forEach((line, index) => {
        page.drawText(line, {
          x: 54,
          y: options.height - 138 - index * 24,
          size: 13,
          font: bodyFont,
          color: rgb(0.23, 0.21, 0.18),
        });
      });
    }
  }

  return [
    {
      filename: "blank-document.pdf",
      bytes: await document.save(),
    },
  ];
}

function buildFilename(originalName: string, suffix: string) {
  const sanitizedName = originalName.toLowerCase().endsWith(".pdf")
    ? originalName.slice(0, -4)
    : originalName;

  return `${sanitizedName}-${suffix}.pdf`;
}
