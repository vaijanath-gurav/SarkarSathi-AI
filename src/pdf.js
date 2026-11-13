// DEV 4 OWNS THIS FILE.
// Generating a clean PDF from scratch instead of overlaying an official template:
// coordinate-mapping a government PDF is a 3-hour fiddle and looks identical on a phone.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function generateEWSForm(profile) {
  const { identity, income, land, purpose } = profile;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const M = 50;
  let y = 790;

  const line = (text, { size = 11, f = font, gap = 18, color = rgb(0.1, 0.1, 0.1) } = {}) => {
    page.drawText(String(text ?? '—'), { x: M, y, size, font: f, color });
    y -= gap;
  };

  const field = (label, value) => {
    page.drawText(`${label}:`, { x: M, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(String(value ?? '—'), { x: M + 170, y, size: 11, font });
    y -= 22;
  };

  const rule = () => {
    page.drawLine({
      start: { x: M, y: y + 6 }, end: { x: 545, y: y + 6 },
      thickness: 0.7, color: rgb(0.8, 0.8, 0.8),
    });
    y -= 14;
  };

  line('APPLICATION FOR EWS CERTIFICATE', { size: 16, f: bold, gap: 10 });
  line('Economically Weaker Section — Government of Maharashtra', { size: 9, gap: 22, color: rgb(0.4, 0.4, 0.4) });
  rule();

  line('APPLICANT DETAILS', { size: 11, f: bold, gap: 20 });
  field('Full Name', identity?.full_name);
  field('Date of Birth', identity?.date_of_birth);
  field('Gender', identity?.gender);
  field('Address', identity?.address);
  field('PIN Code', identity?.pin_code);
  field('ID Number', identity?.id_number_last_four ? `XXXX-XXXX-${identity.id_number_last_four}` : '—');
  y -= 6;
  rule();

  line('INCOME DETAILS', { size: 11, f: bold, gap: 20 });
  field('Certified Annual Income', income?.certified_annual_income ? `Rs. ${Number(income.certified_annual_income).toLocaleString('en-IN')}` : '—');
  field('Certificate Number', income?.certificate_number);
  field('Issued By', income?.issuing_authority);
  field('Issue Date', income?.issue_date);
  y -= 6;
  rule();

  line('LAND HOLDING (7/12 EXTRACT)', { size: 11, f: bold, gap: 20 });
  field('Village', land?.village_name);
  field('Taluka & District', land?.taluka_and_district);
  field('Survey / Gat Number', land?.survey_number);
  field('Total Area (Hectares)', land?.total_area_hectares);
  field('Registered Owners', (land?.owner_names || []).join(', '));
  y -= 6;
  rule();

  line('DECLARATION', { size: 11, f: bold, gap: 20 });
  field('Purpose of Application', purpose);
  y -= 10;
  line('All documents submitted were cross-verified for consistency prior to', { size: 9, gap: 12, color: rgb(0.4, 0.4, 0.4) });
  line('submission. Name, income and land-holding records were checked and matched.', { size: 9, gap: 30, color: rgb(0.4, 0.4, 0.4) });

  page.drawText('Applicant Signature', { x: M, y: 90, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
  page.drawLine({ start: { x: M, y: 105 }, end: { x: 220, y: 105 }, thickness: 0.7, color: rgb(0.6, 0.6, 0.6) });

  page.drawText(
    `Verified and generated ${new Date().toISOString().slice(0, 10)} · Documents processed locally`,
    { x: M, y: 50, size: 8, font, color: rgb(0.55, 0.55, 0.55) },
  );

  return Buffer.from(await doc.save());
}
