// Run: npm run test:pdf  ->  writes out/EWS_Application.pdf
import fs from 'node:fs';
import { generateEWSForm } from './pdf.js';

const load = (f) => JSON.parse(fs.readFileSync(`fixtures/${f}.json`, 'utf8'));

const pdf = await generateEWSForm({
  identity: load('identity'),
  income: load('income'),
  land: load('land'),
  purpose: 'School admission for daughter',
});

fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/EWS_Application.pdf', pdf);
console.log(`Wrote out/EWS_Application.pdf (${pdf.length} bytes)`);
