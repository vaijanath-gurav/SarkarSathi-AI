// Drives the whole conversation with synthetic WhatsApp webhook payloads.
// No Meta account, no ngrok, no network, no AI.
//
//   node src/simulate.js          happy path
//   node src/simulate.js mismatch planted name mismatch (the demo case)
//   node src/simulate.js hi       happy path in Hindi
//
// Env is set before any import because extractor.js and stt.js read their mock flags
// at module load time.

process.env.DRY_RUN = 'true';
process.env.USE_MOCK = 'true';
process.env.USE_MOCK_STT = 'true';
process.env.NO_LISTEN = 'true';

const mode = process.argv[2] || 'happy';
if (mode === 'mismatch') process.env.MOCK_LAND = 'land_mismatch';
const language = mode === 'hi' ? 'hi' : 'mr';

const { handleMessage } = await import('./server.js');
const { getOutbox, clearOutbox } = await import('./whatsapp.js');

const FROM = '919999999999';
let seq = 0;
const id = () => `wamid.sim${++seq}`;

const text = (body) => ({ from: FROM, id: id(), type: 'text', text: { body } });
const button = (buttonId) => ({
  from: FROM, id: id(), type: 'interactive',
  interactive: { button_reply: { id: buttonId } },
});
const image = () => ({ from: FROM, id: id(), type: 'image', image: { id: `media${seq}` } });
const audio = () => ({ from: FROM, id: id(), type: 'audio', audio: { id: `media${seq}` } });

function render(label) {
  const messages = getOutbox();
  if (label) console.log(`\n\x1b[36m>>> USER: ${label}\x1b[0m`);
  for (const m of messages) {
    if (m.type === 'text') console.log(`    BOT: ${m.text.body}`);
    else if (m.type === 'document') console.log(`    BOT: [PDF ${m.document.filename}, ${m.document.bytes} bytes]`);
    else if (m.type === 'interactive') {
      const titles = m.interactive.action.buttons.map((b) => b.reply.title).join(' | ');
      console.log(`    BOT: ${m.interactive.body.text}  [${titles}]`);
    }
  }
  clearOutbox();
}

async function step(label, message) {
  await handleMessage(message);
  render(label);
}

console.log(`\n=== SIMULATION: ${mode} ===`);

await step('hi', text('hi'));
await step(`(taps ${language})`, button(`lang_${language}`));
await step('[photo of Aadhaar]', image());
await step('[photo of Income Certificate]', image());
await step('[photo of 7/12 extract]', image());

if (mode === 'mismatch') {
  console.log('\n\x1b[33m--- validation stopped the flow above. Nothing was generated. ---\x1b[0m');
  console.log('=== END ===\n');
  process.exit(0);
}

await step('School admission', text('School admission'));
await step('1 Ramesh Shankar Patil', text('1 Ramesh Shankar Patil'));
await step('[voice note]', audio());

console.log('=== END ===\n');
process.exit(0);
