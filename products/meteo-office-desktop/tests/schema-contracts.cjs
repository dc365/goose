const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'schemas');
const files = fs.readdirSync(root).filter((name) => name.endsWith('.schema.json')).sort();
assert.ok(files.length >= 9, 'expected Harness V1 schema files');

const ids = new Set();
for (const file of files) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', `${file}: wrong schema draft`);
  assert.ok(schema.$id, `${file}: missing $id`);
  assert.ok(!ids.has(schema.$id), `${file}: duplicate $id`);
  ids.add(schema.$id);
  assert.equal(schema.type, 'object', `${file}: top-level type must be object`);
  assert.ok(Array.isArray(schema.required), `${file}: required must be declared`);
}

console.log(`MeteoMate schema contracts passed (${files.length} schemas).`);
