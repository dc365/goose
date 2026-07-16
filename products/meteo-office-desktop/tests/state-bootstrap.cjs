const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    dump: () => Object.fromEntries(values),
  };
}

const current = JSON.stringify({ tasks: [{ id: 't1' }] });
const localStorage = createStorage({ 'meteomate-desktop-state-v2': current });
const context = vm.createContext({ localStorage, Date, globalThis: null });
context.globalThis = context;
const source = fs.readFileSync(path.resolve(__dirname, '..', 'harness', 'state-bootstrap.js'), 'utf8');
vm.runInContext(source, context, { filename: 'state-bootstrap.js' });

assert.equal(localStorage.getItem('meteomate-desktop-state-v2'), 'null');
const backup = JSON.parse(localStorage.getItem('meteomate-desktop-state-bootstrap-backup-v1'));
assert.equal(backup.current, current);
assert.equal(context.__METEOMATE_STATE_BOOTSTRAP__.payload, localStorage.getItem('meteomate-desktop-state-bootstrap-backup-v1'));

const secondContext = vm.createContext({ localStorage, Date, globalThis: null });
secondContext.globalThis = secondContext;
vm.runInContext(source, secondContext, { filename: 'state-bootstrap.js' });
assert.equal(secondContext.__METEOMATE_STATE_BOOTSTRAP__.payload, context.__METEOMATE_STATE_BOOTSTRAP__.payload);

console.log('MeteoMate state bootstrap tests passed.');
