// Run: node src/simulate.test.js
// Asserts the orchestration, not just that it runs.
process.env.DRY_RUN = 'true';
process.env.USE_MOCK = 'true';
process.env.USE_MOCK_STT = 'true';
process.env.NO_LISTEN = 'true';

const { handleMessage } = await import('./server.js');
const { getOutbox, clearOutbox } = await import('./whatsapp.js');
const { alreadyProcessed } = await import('./session.js');

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};

let seq = 0;
const FROM = () => `9199${String(seq).padStart(8, '0')}`;
const mk = (from, type, extra) => ({ from, id: `wamid.t${++seq}`, type, ...extra });

const bodies = () => getOutbox().filter((m) => m.type === 'text').map((m) => m.text.body);
const hasDoc = () => getOutbox().some((m) => m.type === 'document');

/** Language pick + the three document photos. Stops where the bot asks for the purpose. */
async function runFlow(from, { land = 'land', lang = 'mr' } = {}) {
  process.env.MOCK_LAND = land;
  clearOutbox();
  await handleMessage(mk(from, 'text', { text: { body: 'hi' } }));
  await handleMessage(mk(from, 'interactive', { interactive: { button_reply: { id: `lang_${lang}` } } }));
  for (let i = 0; i < 3; i++) {
    await handleMessage(mk(from, 'image', { image: { id: `m${seq}` } }));
  }
}

console.log('\nHappy path');
seq = 100;
let who = FROM();
await runFlow(who);
// Purpose is on no document, so it is collected before validation completes.
check('asks for the purpose after three documents', bodies().some((b) => b.includes('कारणासाठी')));
check('no PDF before confirmation', !hasDoc());

clearOutbox();
await handleMessage(mk(who, 'text', { text: { body: 'School admission' } }));
check('reaches the review stage once purpose is given', bodies().some((b) => b.includes('तपशील')));
check('still no PDF at review time', !hasDoc());

clearOutbox();
await handleMessage(mk(who, 'text', { text: { body: 'ok' } }));
check('PDF delivered after confirmation', hasDoc());

console.log('\nPlanted mismatch');
seq = 200;
who = FROM();
await runFlow(who, { land: 'land_mismatch' });
check('mismatch reported', bodies().some((b) => b.includes('जुळत नाही')));
check('NO PDF generated', !hasDoc());

console.log('\nCorrection before generation');
seq = 300;
who = FROM();
await runFlow(who);
await handleMessage(mk(who, 'text', { text: { body: 'School admission' } }));
clearOutbox();
await handleMessage(mk(who, 'text', { text: { body: '1 Corrected Name' } }));
check('correction echoed', bodies().some((b) => b.includes('Corrected Name')));
check('still no PDF after a correction', !hasDoc());

console.log('\nDeduplication');
// Tested at its own layer: alreadyProcessed() is called by the webhook route in
// server.js, NOT by handleMessage, so driving handleMessage directly bypasses it.
check('a fresh message id is accepted', alreadyProcessed('wamid.dedup1') === false);
check('the same message id is rejected', alreadyProcessed('wamid.dedup1') === true);
check('a different id is still accepted', alreadyProcessed('wamid.dedup2') === false);

console.log('\nLanguage selection');
seq = 500;
who = FROM();
await runFlow(who, { lang: 'hi' });
await handleMessage(mk(who, 'text', { text: { body: 'School admission' } }));
check('replies in Hindi', bodies().some((b) => b.includes('विवरण')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
