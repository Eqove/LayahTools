import { init } from "@embedpdf/pdfium";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

// 1. Setup PDFium
async function getPdfium() {
  const pdfiumWasm = await fs.readFile(
    path.join(__dirname, "../node_modules/@embedpdf/pdfium/dist/pdfium.wasm")
  );
  const pdfium = await init({ wasmBinary: pdfiumWasm });
  pdfium.PDFiumExt_Init();
  return pdfium;
}

async function createTestPDF(outPath: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello 2025 PDFium Spike", { x: 50, y: 350, font, size: 24, color: rgb(0,0,0) });
  page.drawText("John Smith", { x: 50, y: 300, font, size: 14, color: rgb(0,0,0) });
  page.drawText("Total: $500", { x: 50, y: 280, font, size: 14, color: rgb(0,0,0) });
  
  // Create a 1x1 red PNG pixel
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);
  const image = await doc.embedPng(pngBytes);
  page.drawImage(image, { x: 400, y: 300, width: 50, height: 50 });
  
  const bytes = await doc.save();
  await fs.writeFile(outPath, bytes);
  return bytes;
}

async function runSpike() {
  console.log("=== PDFium Engine Spike ===");
  const testDir = path.join(__dirname, "../test-corpus");
  await fs.mkdir(testDir, { recursive: true }).catch(() => {});
  
  const pdfium = await getPdfium();
  console.log("✅ PDFium Loaded");

  const pdfPath = path.join(testDir, "test.pdf");
  const bytes = await createTestPDF(pdfPath);
  console.log("✅ Test PDF created");

  const wasm = (pdfium as any).pdfium;

  // Load PDF into PDFium
  const ptr = wasm._malloc(bytes.length);
  wasm.HEAPU8.set(bytes, ptr);
  
  const doc = pdfium.FPDF_LoadMemDocument(ptr, bytes.length, "");
  console.log(`Document loaded. Handle: ${doc}`);

  const pageCount = pdfium.FPDF_GetPageCount(doc);
  console.log(`Pages: ${pageCount}`);
  
  const page = pdfium.FPDF_LoadPage(doc, 0);
  console.log(`Page handle: ${page}`);
  
  const objCount = pdfium.FPDFPage_CountObjects(page);
  console.log(`Objects on page 1: ${objCount}`);
  
  for (let i = 0; i < objCount; i++) {
    const obj = pdfium.FPDFPage_GetObject(page, i);
    const type = pdfium.FPDFPageObj_GetType(obj);
    console.log(`\nObject ${i}: Type ${type}`); // 1 = text, 2 = path, 3 = image
    
    if (type === 1) { // TEXT
      // Try to get bounds
      const leftPtr = wasm._malloc(4);
      const bottomPtr = wasm._malloc(4);
      const rightPtr = wasm._malloc(4);
      const topPtr = wasm._malloc(4);
      
      pdfium.FPDFPageObj_GetBounds(obj, leftPtr, bottomPtr, rightPtr, topPtr);
      const left = wasm.getValue(leftPtr, "float");
      const bottom = wasm.getValue(bottomPtr, "float");
      const right = wasm.getValue(rightPtr, "float");
      const top = wasm.getValue(topPtr, "float");
      console.log(`  Bounds: l=${left}, b=${bottom}, r=${right}, t=${top}`);
      
      wasm._free(leftPtr);
      wasm._free(bottomPtr);
      wasm._free(rightPtr);
      wasm._free(topPtr);

      // Extract text
      const bufferPtr = wasm._malloc(1024);
      const textPage = pdfium.FPDFText_LoadPage(page);
      
      const reqSize = pdfium.FPDFTextObj_GetText(obj, textPage, bufferPtr, 1024);
      
      if (reqSize > 0) {
        // UTF-16LE decode
        const textBytes = wasm.HEAPU8.slice(bufferPtr, bufferPtr + reqSize);
        let text = "";
        for (let j = 0; j < textBytes.length - 2; j += 2) {
          const code = textBytes[j] | (textBytes[j+1] << 8);
          if (code === 0) break;
          text += String.fromCharCode(code);
        }
        console.log(`  Text: "${text}"`);
        let newText = "";
        if (text === "Hello 2025 PDFium Spike") {
          newText = "Hello 2026 PDFium Spike";
        } else if (text === "John Smith") {
          newText = "Utkarsh Sharma";
        } else if (text === "Total: $500") {
          newText = "Total: $1,250";
        }
        
        if (newText) {
          console.log(`  Replacing with: "${newText}"`);
          // FPDFText_SetText takes (text_object, utf16le_string_ptr)
          const newTextPtr = wasm._malloc(newText.length * 2 + 2);
          wasm.stringToUTF16(newText, newTextPtr, newText.length * 2 + 2);
          
          const success = pdfium.FPDFText_SetText(obj, newTextPtr);
          console.log(`  SetText success: ${success}`);
          wasm._free(newTextPtr);

          // Let's test a transform (move it up by 10 and right by 10)
          // Matrix: [a, b, c, d, e, f] where e=translateX, f=translateY
          // We must get the original matrix first
          // Matrix is a 24-byte struct containing 6 floats
          const matrixPtr = wasm._malloc(24);
          const hasMatrix = pdfium.FPDFPageObj_GetMatrix(obj, matrixPtr);
          if (hasMatrix) {
            const a = wasm.getValue(matrixPtr, "float");
            const b = wasm.getValue(matrixPtr + 4, "float");
            const c = wasm.getValue(matrixPtr + 8, "float");
            const d = wasm.getValue(matrixPtr + 12, "float");
            const e = wasm.getValue(matrixPtr + 16, "float");
            const f = wasm.getValue(matrixPtr + 20, "float");
            console.log(`  Original Matrix: a=${a}, b=${b}, c=${c}, d=${d}, e=${e}, f=${f}`);

            // Apply a relative transform using FPDFPageObj_Transform
            pdfium.FPDFPageObj_Transform(obj, 1.1, 0, 0, 1.1, 10, 10);
            console.log(`  Transform applied (scale 1.1, offset +10, +10)`);
          }
          wasm._free(matrixPtr);
        }
      }
      
      wasm._free(bufferPtr);
      pdfium.FPDFText_ClosePage(textPage);
    } else if (type === 3) { // IMAGE
      console.log("  Image Object Detected");
      
      // Get Bounds
      const leftPtr = wasm._malloc(4);
      const bottomPtr = wasm._malloc(4);
      const rightPtr = wasm._malloc(4);
      const topPtr = wasm._malloc(4);
      
      pdfium.FPDFPageObj_GetBounds(obj, leftPtr, bottomPtr, rightPtr, topPtr);
      const left = wasm.getValue(leftPtr, "float");
      const bottom = wasm.getValue(bottomPtr, "float");
      const right = wasm.getValue(rightPtr, "float");
      const top = wasm.getValue(topPtr, "float");
      console.log(`  Image Bounds: l=${left}, b=${bottom}, r=${right}, t=${top}`);
      
      wasm._free(leftPtr);
      wasm._free(bottomPtr);
      wasm._free(rightPtr);
      wasm._free(topPtr);

      // Transform image (Move right by 50)
      pdfium.FPDFPageObj_Transform(obj, 1, 0, 0, 1, 50, 0);
      console.log("  Image moved right by 50");
    }
  }

  // Create new text object
  console.log("\n=== Testing New Text Object ===");
  const newFontName = "Helvetica"; // standard 14 font
  const newTextObj = pdfium.FPDFPageObj_NewTextObj(doc, newFontName, 18);
  if (newTextObj) {
    const newTextStr = "New Text Inserted via PDFium!";
    const strPtr = wasm._malloc(newTextStr.length * 2 + 2);
    wasm.stringToUTF16(newTextStr, strPtr, newTextStr.length * 2 + 2);
    
    const setSuccess = pdfium.FPDFText_SetText(newTextObj, strPtr);
    wasm._free(strPtr);
    
    if (setSuccess) {
      pdfium.FPDFPageObj_Transform(newTextObj, 1, 0, 0, 1, 200, 200);
      pdfium.FPDFPage_InsertObject(page, newTextObj);
      console.log("  Successfully created, positioned, and inserted new text object");
    } else {
      console.log("  Failed to set text on new object");
    }
  }

  // Generate the new page content streams
  pdfium.FPDFPage_GenerateContent(page);

  // Generate the PDF
  console.log("\n=== Saving Mutated PDF ===");
  const outChunks: Uint8Array[] = [];
  
  const writeBlockFn = wasm.addFunction((pThis: number, pData: number, size: number) => {
    const chunk = new Uint8Array(wasm.HEAPU8.subarray(pData, pData + size));
    outChunks.push(chunk);
    return 1; // true/success
  }, "iiii"); // iiii = returns int, takes (int, int, int)
  
  const pFileWrite = wasm._malloc(8);
  wasm.setValue(pFileWrite, 1, "i32"); // version = 1
  wasm.setValue(pFileWrite + 4, writeBlockFn, "i32"); // WriteBlock func ptr

  // FPDF_SaveAsCopy flags: 0 = none
  pdfium.FPDF_SaveAsCopy(doc, pFileWrite, 0);
  
  wasm._free(pFileWrite);
  wasm.removeFunction(writeBlockFn);
  
  const totalSize = outChunks.reduce((acc, c) => acc + c.length, 0);
  const outBytes = new Uint8Array(totalSize);
  let offset = 0;
  for (const c of outChunks) {
    outBytes.set(c, offset);
    offset += c.length;
  }
  
  const outPath = path.join(testDir, "test-mutated.pdf");
  await fs.writeFile(outPath, outBytes);
  console.log(`✅ Saved ${outPath} (${totalSize} bytes)`);

  console.log("\n=== Clean up ===");
  pdfium.FPDF_ClosePage(page);
  pdfium.FPDF_CloseDocument(doc);
  wasm._free(ptr);
  console.log("Done.");
}

runSpike().catch(console.error);
