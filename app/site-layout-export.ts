const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function jpegPdf(jpeg: Uint8Array, width: number, height: number) {
  const encoder = new TextEncoder();
  const margin = 24;
  const scale = Math.min((PAGE_WIDTH - margin * 2) / width, (PAGE_HEIGHT - margin * 2) / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const x = (PAGE_WIDTH - drawWidth) / 2;
  const y = (PAGE_HEIGHT - drawHeight) / 2;
  const stream = encoder.encode(`q ${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im1 Do Q`);
  const objects: Uint8Array[] = [
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`),
    concatBytes([encoder.encode(`<< /Length ${stream.length} >>\nstream\n`), stream, encoder.encode("\nendstream")]),
    concatBytes([encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, encoder.encode("\nendstream")]),
  ];
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let cursor = chunks[0].length;
  objects.forEach((object, index) => {
    offsets[index + 1] = cursor;
    const chunk = concatBytes([encoder.encode(`${index + 1} 0 obj\n`), object, encoder.encode("\nendobj\n")]);
    chunks.push(chunk);
    cursor += chunk.length;
  });
  const xrefOffset = cursor;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...objects.map((_, index) => `${String(offsets[index + 1]).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(encoder.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}

export async function siteLayoutPdfFromSvg(svg: SVGSVGElement, fileName: string) {
  const viewBox = svg.viewBox.baseVal;
  const ratio = viewBox.width > 0 && viewBox.height > 0 ? viewBox.width / viewBox.height : 1.6;
  const width = 2600;
  const height = Math.max(1200, Math.round(width / ratio));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.style.background = "#ffffff";
  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("PDF 도면 화면을 준비하지 못했습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const jpegBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
    if (!jpegBlob) throw new Error("PDF 도면 이미지를 만들지 못했습니다.");
    return new File([jpegPdf(new Uint8Array(await jpegBlob.arrayBuffer()), width, height)], fileName, { type: "application/pdf" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("PDF 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
