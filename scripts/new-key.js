// Usage: npm run key -- "CSC Pune 1042"
import { createKey } from '../src/keys.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Usage: npm run key -- "<CSC name>"');
  process.exit(1);
}
const key = createKey(name);
console.log(`Name: ${name}`);
console.log(`Key:  ${key}`);
