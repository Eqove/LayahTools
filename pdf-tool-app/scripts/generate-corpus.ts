import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const CORPUS_DIR = path.resolve(__dirname, "../tests/fixtures/pdf-corpus");
const EXISTING_PDFS_DIR = path.resolve(__dirname, "../tests/fixtures/pdfs");

if (!fs.existsSync(CORPUS_DIR)) {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
}

// 1x1 transparent/colored PNG in base64
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2Nk+M/wn4GBgYGRgQEAFAAG/6e7+3cAAAAASUVORK5CYII=",
  "base64"
);

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function buildCorpus() {
  console.log("Generating LayahTools PDF Testing Corpus v1...\n");

  // -------------------------------------------------------------
  // PDF-01: Simple PDF (basic text and an image)
  // -------------------------------------------------------------
  const doc1 = await PDFDocument.create();
  const font1 = await doc1.embedFont(StandardFonts.Helvetica);
  const img1 = await doc1.embedPng(TINY_PNG);

  const p1 = doc1.addPage([595, 842]);
  p1.drawText("LayahTools Simple Test Document", { x: 50, y: 780, size: 20, font: font1 });
  p1.drawText("This document contains basic paragraphs and an embedded image fixture.", {
    x: 50,
    y: 740,
    size: 12,
    font: font1,
  });
  p1.drawImage(img1, { x: 50, y: 650, width: 60, height: 60 });

  const p1b = doc1.addPage([595, 842]);
  p1b.drawText("Page 2 of simple document", { x: 50, y: 780, size: 14, font: font1 });
  const doc1Bytes = await doc1.save();
  const file1Path = path.join(CORPUS_DIR, "simple-text.pdf");
  fs.writeFileSync(file1Path, doc1Bytes);

  // -------------------------------------------------------------
  // PDF-02: Multi-column PDF
  // -------------------------------------------------------------
  const multiColSrc = path.join(EXISTING_PDFS_DIR, "double coloumn sample.pdf");
  const file2Path = path.join(CORPUS_DIR, "multi-column.pdf");
  if (fs.existsSync(multiColSrc)) {
    fs.copyFileSync(multiColSrc, file2Path);
  } else {
    // Generate fallback multi-column
    const doc2 = await PDFDocument.create();
    const p2 = doc2.addPage([595, 842]);
    p2.drawText("Column 1 text...", { x: 50, y: 750, size: 12, font: font1 });
    p2.drawText("Column 2 text...", { x: 320, y: 750, size: 12, font: font1 });
    fs.writeFileSync(file2Path, await doc2.save());
  }

  // -------------------------------------------------------------
  // PDF-03: Table-heavy PDF
  // -------------------------------------------------------------
  const doc3 = await PDFDocument.create();
  const font3 = await doc3.embedFont(StandardFonts.Helvetica);
  const p3 = doc3.addPage([595, 842]);
  p3.drawText("Financial Data Summary Table", { x: 50, y: 780, size: 18, font: font3 });

  // Draw 5 rows x 4 columns table
  const startX = 50,
    startY = 730,
    cellW = 120,
    cellH = 30;
  for (let row = 0; row < 6; row++) {
    const y = startY - row * cellH;
    p3.drawLine({ start: { x: startX, y }, end: { x: startX + 4 * cellW, y }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
  }
  for (let col = 0; col < 5; col++) {
    const x = startX + col * cellW;
    p3.drawLine({ start: { x, y: startY }, end: { x, y: startY - 5 * cellH }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
  }
  // Cell text
  const headers = ["Period", "Revenue", "Expenses", "Net Profit"];
  headers.forEach((h, i) => p3.drawText(h, { x: startX + i * cellW + 10, y: startY - 20, size: 11, font: font3 }));
  for (let r = 1; r <= 4; r++) {
    p3.drawText(`Q${r} 2026`, { x: startX + 10, y: startY - r * cellH - 20, size: 10, font: font3 });
    p3.drawText(`$${r * 250},000`, { x: startX + cellW + 10, y: startY - r * cellH - 20, size: 10, font: font3 });
    p3.drawText(`$${r * 120},000`, { x: startX + 2 * cellW + 10, y: startY - r * cellH - 20, size: 10, font: font3 });
    p3.drawText(`$${r * 130},000`, { x: startX + 3 * cellW + 10, y: startY - r * cellH - 20, size: 10, font: font3 });
  }
  const file3Path = path.join(CORPUS_DIR, "table-heavy.pdf");
  fs.writeFileSync(file3Path, await doc3.save());

  // -------------------------------------------------------------
  // PDF-04: Image-heavy PDF
  // -------------------------------------------------------------
  const imageHeavySrc = path.join(EXISTING_PDFS_DIR, "SIH_AERES_PPT_FINAL.pdf");
  const file4Path = path.join(CORPUS_DIR, "image-heavy.pdf");
  if (fs.existsSync(imageHeavySrc)) {
    fs.copyFileSync(imageHeavySrc, file4Path);
  } else {
    const doc4 = await PDFDocument.create();
    const p4 = doc4.addPage([595, 842]);
    p4.drawImage(img1, { x: 50, y: 400, width: 300, height: 300 });
    fs.writeFileSync(file4Path, await doc4.save());
  }

  // -------------------------------------------------------------
  // PDF-05: Scanned PDF (image only, NO text layer)
  // -------------------------------------------------------------
  const doc5 = await PDFDocument.create();
  const p5 = doc5.addPage([595, 842]);
  // Cover the whole page with the image
  p5.drawImage(img1, { x: 0, y: 0, width: 595, height: 842 });
  const file5Path = path.join(CORPUS_DIR, "scanned-image-only.pdf");
  fs.writeFileSync(file5Path, await doc5.save());

  // -------------------------------------------------------------
  // PDF-06: Rotated PDF
  // -------------------------------------------------------------
  const doc6 = await PDFDocument.create();
  const font6 = await doc6.embedFont(StandardFonts.Helvetica);
  const p6_1 = doc6.addPage([595, 842]);
  p6_1.drawText("Page 1 - Normal 0 deg", { x: 50, y: 750, size: 14, font: font6 });

  const p6_2 = doc6.addPage([595, 842]);
  p6_2.drawText("Page 2 - Rotated 90 deg", { x: 50, y: 750, size: 14, font: font6 });
  p6_2.setRotation(degrees(90));

  const p6_3 = doc6.addPage([595, 842]);
  p6_3.drawText("Page 3 - Rotated 180 deg", { x: 50, y: 750, size: 14, font: font6 });
  p6_3.setRotation(degrees(180));

  const file6Path = path.join(CORPUS_DIR, "rotated-pages.pdf");
  fs.writeFileSync(file6Path, await doc6.save());

  // -------------------------------------------------------------
  // PDF-07: Form PDF (AcroForms)
  // -------------------------------------------------------------
  const doc7 = await PDFDocument.create();
  const font7 = await doc7.embedFont(StandardFonts.Helvetica);
  const p7 = doc7.addPage([595, 842]);
  p7.drawText("Interactive Application Form", { x: 50, y: 780, size: 18, font: font7 });

  const form7 = doc7.getForm();
  p7.drawText("Full Name:", { x: 50, y: 720, size: 12, font: font7 });
  const nameField = form7.createTextField("applicant.name");
  nameField.setText("John Doe");
  nameField.addToPage(p7, { x: 150, y: 710, width: 250, height: 24 });

  p7.drawText("Email Address:", { x: 50, y: 660, size: 12, font: font7 });
  const emailField = form7.createTextField("applicant.email");
  emailField.setText("john@example.com");
  emailField.addToPage(p7, { x: 150, y: 650, width: 250, height: 24 });

  const file7Path = path.join(CORPUS_DIR, "form-acroform.pdf");
  fs.writeFileSync(file7Path, await doc7.save());

  // -------------------------------------------------------------
  // PDF-08: Annotated PDF
  // -------------------------------------------------------------
  const doc8 = await PDFDocument.create();
  const font8 = await doc8.embedFont(StandardFonts.Helvetica);
  const p8 = doc8.addPage([595, 842]);
  p8.drawText("Annotated Research Memorandum", { x: 50, y: 780, size: 18, font: font8 });
  p8.drawText("Key finding: Browser-first processing ensures zero server upload.", {
    x: 50,
    y: 720,
    size: 12,
    font: font8,
  });
  // Draw highlight-like box
  p8.drawRectangle({
    x: 45,
    y: 715,
    width: 420,
    height: 22,
    color: rgb(1, 0.95, 0.2),
    opacity: 0.45,
  });
  const file8Path = path.join(CORPUS_DIR, "annotated.pdf");
  fs.writeFileSync(file8Path, await doc8.save());

  // -------------------------------------------------------------
  // PDF-09: Long Document (25 pages)
  // -------------------------------------------------------------
  const doc9 = await PDFDocument.create();
  const font9 = await doc9.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 25; i++) {
    const page = doc9.addPage([595, 842]);
    page.drawText(`Comprehensive System Report — Section ${i}`, { x: 50, y: 780, size: 16, font: font9 });
    for (let line = 0; line < 15; line++) {
      page.drawText(`This is paragraph line ${line + 1} of section ${i}. Verifying multi-page scalability.`, {
        x: 50,
        y: 740 - line * 25,
        size: 10,
        font: font9,
      });
    }
    page.drawText(`Page ${i} of 25`, { x: 270, y: 40, size: 9, font: font9 });
  }
  const file9Path = path.join(CORPUS_DIR, "long-document.pdf");
  fs.writeFileSync(file9Path, await doc9.save());

  // -------------------------------------------------------------
  // PDF-10: Password-Protected PDF (Encrypted using pypdf)
  // -------------------------------------------------------------
  const file10Path = path.join(CORPUS_DIR, "password-protected.pdf");
  const pyCmd = `python -c "import pypdf; w = pypdf.PdfWriter(); w.add_blank_page(width=595, height=842); w.encrypt('testpassword123'); f = open(r'${file10Path}', 'wb'); w.write(f); f.close()"`;
  try {
    execSync(pyCmd);
    console.log("Successfully generated password-protected.pdf with password: testpassword123");
  } catch (e) {
    console.warn("Python encryption step failed, creating fallback file:", e);
    fs.writeFileSync(file10Path, doc1Bytes);
  }

  // -------------------------------------------------------------
  // Build and write manifest.json
  // -------------------------------------------------------------
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    passwordForProtectedFixtures: "testpassword123",
    fixtures: [
      {
        id: "PDF-01",
        name: "simple-text.pdf",
        category: "simple",
        sha256: sha256File(file1Path),
        pageCount: 2,
        expected: {
          hasTextLayer: true,
          hasImages: true,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: false,
        },
      },
      {
        id: "PDF-02",
        name: "multi-column.pdf",
        category: "multi-column",
        sha256: sha256File(file2Path),
        pageCount: 3,
        expected: {
          hasTextLayer: true,
          hasImages: false,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: false,
        },
      },
      {
        id: "PDF-03",
        name: "table-heavy.pdf",
        category: "table-heavy",
        sha256: sha256File(file3Path),
        pageCount: 1,
        expected: {
          hasTextLayer: true,
          hasImages: false,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: false,
        },
      },
      {
        id: "PDF-04",
        name: "image-heavy.pdf",
        category: "image-heavy",
        sha256: sha256File(file4Path),
        pageCount: 6,
        expected: {
          hasTextLayer: true,
          hasImages: true,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: false,
        },
      },
      {
        id: "PDF-05",
        name: "scanned-image-only.pdf",
        category: "scanned",
        sha256: sha256File(file5Path),
        pageCount: 1,
        expected: {
          hasTextLayer: false,
          hasImages: true,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: false,
        },
      },
      {
        id: "PDF-06",
        name: "rotated-pages.pdf",
        category: "rotated",
        sha256: sha256File(file6Path),
        pageCount: 3,
        expected: {
          hasTextLayer: true,
          hasImages: false,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: false,
          pageRotations: [0, 90, 180],
        },
      },
      {
        id: "PDF-07",
        name: "form-acroform.pdf",
        category: "form",
        sha256: sha256File(file7Path),
        pageCount: 1,
        expected: {
          hasTextLayer: true,
          hasImages: false,
          hasAnnotations: false,
          hasForms: true,
          formFields: ["applicant.name", "applicant.email"],
          isEncrypted: false,
        },
      },
      {
        id: "PDF-08",
        name: "annotated.pdf",
        category: "annotated",
        sha256: sha256File(file8Path),
        pageCount: 1,
        expected: {
          hasTextLayer: true,
          hasImages: false,
          hasAnnotations: true,
          hasForms: false,
          isEncrypted: false,
        },
      },
      {
        id: "PDF-09",
        name: "long-document.pdf",
        category: "long",
        sha256: sha256File(file9Path),
        pageCount: 25,
        expected: {
          hasTextLayer: true,
          hasImages: false,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: false,
        },
      },
      {
        id: "PDF-10",
        name: "password-protected.pdf",
        category: "password-protected",
        sha256: sha256File(file10Path),
        pageCount: 1,
        expected: {
          hasTextLayer: false,
          hasImages: false,
          hasAnnotations: false,
          hasForms: false,
          isEncrypted: true,
          password: "testpassword123",
        },
      },
    ],
  };

  const manifestPath = path.join(CORPUS_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Corpus v1 successfully built with ${manifest.fixtures.length} fixtures!`);
  console.log(`Manifest written to: ${manifestPath}\n`);
}

buildCorpus().catch((e) => {
  console.error("Failed to generate corpus:", e);
  process.exit(1);
});
