// Run the REAL vision model against a real photograph.
//
//   node src/extract.cli.js identity path/to/aadhaar.jpg
//   node src/extract.cli.js land     path/to/712.jpg
//   node src/extract.cli.js income   path/to/income.jpg
//
// Requires Ollama running with qwen3-vl:4b-instruct pulled.
// This is the one command that answers G1: can the model read real documents?

process.env.USE_MOCK = 'false';

import fs from 'node:fs/promises';
const { extractDocument } = await import('./extractor.js');

const [docType, imagePath] = process.argv.slice(2);

if (!docType || !imagePath) {
  console.error('Usage: node src/extract.cli.js <identity|income|land> <image-path>');
  process.exit(1);
}

const buffer = await fs.readFile(imagePath);
console.log(`Sending ${buffer.length} bytes to ${process.env.VLM_MODEL || 'qwen3-vl:4b-instruct'}...`);

const t0 = Date.now();
try {
  const result = await extractDocument(buffer, docType);
  console.log(`\nExtracted in ${((Date.now() - t0) / 1000).toFixed(1)}s:\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`\nFAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
  process.exit(1);
}
