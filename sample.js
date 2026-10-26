// Builds a made-up loan package with mixed Letter and Legal pages, so you can demo the sorter
// without opening anyone's real documents. Every page says SAMPLE and shows its paper size.
window.buildSamplePackage = async function buildSamplePackage() {
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
  const LETTER = [612, 792];
  const LEGAL = [612, 1008];
  const documents = [
    ['Closing Disclosure', 5, LETTER],
    ['Promissory Note', 3, LETTER],
    ['Deed of Trust', 6, LEGAL],
    ['Planned Unit Development Rider', 2, LEGAL],
    ['Signature and Name Affidavit', 1, LETTER],
    ['Notice of Right to Cancel', 2, LETTER],
    ['Compliance Agreement', 1, LEGAL],
    ['Errors and Omissions Agreement', 1, LETTER],
    ['Occupancy Affidavit', 1, LETTER],
    ['Borrower Certification', 1, LETTER]
  ];

  const deep = rgb(0x17 / 255, 0x3d / 255, 0x30 / 255);
  const forest = rgb(0x2a / 255, 0x83 / 255, 0x5f / 255);
  const mint = rgb(0xdc / 255, 0xf0 / 255, 0xe3 / 255);
  const grey = rgb(0.84, 0.87, 0.85);
  const white = rgb(1, 1, 1);

  const pdf = await PDFDocument.create();
  pdf.setTitle('Sample loan package (made up)');
  pdf.setAuthor('Notary Page Sorter');
  pdf.setProducer('Notary Page Sorter');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const total = documents.reduce((sum, d) => sum + d[1], 0);
  const angle = 35 * Math.PI / 180;
  let packagePage = 0;

  for (const [title, count, size] of documents) {
    for (let i = 1; i <= count; i++) {
      packagePage++;
      const [w, h] = size;
      const legal = h > 900;
      const page = pdf.addPage(size);

      const mark = 'SAMPLE';
      const markWidth = bold.widthOfTextAtSize(mark, 110);
      page.drawText(mark, {
        x: w / 2 - (markWidth * Math.cos(angle)) / 2,
        y: h / 2 - (markWidth * Math.sin(angle)) / 2,
        size: 110, font: bold, color: mint, rotate: degrees(35)
      });

      page.drawText(title.toUpperCase(), { x: 54, y: h - 72, size: 15, font: bold, color: deep });
      const of = `Page ${i} of ${count}`;
      page.drawText(of, { x: w - 54 - regular.widthOfTextAtSize(of, 9), y: h - 72, size: 9, font: regular, color: deep });
      page.drawText('Borrower: Jordan Sample     Lender: Example Lending Co.     Loan: 000-000000', { x: 54, y: h - 92, size: 9, font: regular, color: deep });
      page.drawLine({ start: { x: 54, y: h - 104 }, end: { x: w - 54, y: h - 104 }, thickness: 1, color: deep });

      // Grey bars stand in for the small print.
      let y = h - 134;
      for (let line = 0; y > 200; line++) {
        if (line % 9 === 8) { y -= 12; continue; }
        const share = line % 9 === 7 ? 0.45 : 0.78 + ((line * 37) % 22) / 100;
        page.drawRectangle({ x: 54, y, width: (w - 108) * Math.min(share, 1), height: 6, color: grey });
        y -= 16;
      }

      if (i === count) {
        page.drawLine({ start: { x: 54, y: 156 }, end: { x: 300, y: 156 }, thickness: 1, color: deep });
        page.drawText('Jordan Sample, Borrower', { x: 54, y: 142, size: 9, font: regular, color: deep });
        page.drawLine({ start: { x: 340, y: 156 }, end: { x: 460, y: 156 }, thickness: 1, color: deep });
        page.drawText('Date', { x: 340, y: 142, size: 9, font: regular, color: deep });
      }

      const badge = legal ? 'LEGAL  8.5 x 14 in' : 'LETTER  8.5 x 11 in';
      page.drawRectangle({ x: w - 254, y: 54, width: 200, height: 44, color: legal ? mint : white, borderColor: legal ? forest : deep, borderWidth: 2 });
      page.drawText(badge, { x: w - 154 - bold.widthOfTextAtSize(badge, 13) / 2, y: 71, size: 13, font: bold, color: deep });

      page.drawText(`Package page ${packagePage} of ${total}`, { x: 54, y: 80, size: 10, font: bold, color: deep });
      page.drawText('Made-up sample from Notary Page Sorter. Not a real document.', { x: 54, y: 62, size: 8, font: regular, color: deep });
    }
  }
  return pdf.save();
};
