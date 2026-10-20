/**
 * A one-page A4 PDF with the lines set in Helvetica, written by hand so scripts need no PDF library. Offsets in the
 * cross-reference table are byte positions, which equal string positions because the text is forced to ASCII.
 */
export const minimalPdf = (lines: readonly string[]): Buffer => {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, '?')
  const content = `BT /F1 11 Tf 56 786 Td 16 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = body.length
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
