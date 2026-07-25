const assert = require('node:assert/strict');
const {
  disabledPlatformExtensionNames,
  platformExtensionName,
  pruneSession,
} = require('../capabilities/session-platform-extensions.cjs');

assert.deepEqual(
  disabledPlatformExtensionNames({ allowFileTools: false }),
  ['apps', 'extensionmanager', 'summon', 'todo', 'analyze', 'developer']
);
assert.deepEqual(
  disabledPlatformExtensionNames({ allowFileTools: true }),
  ['apps', 'extensionmanager', 'summon', 'todo']
);
assert.equal(platformExtensionName({ type: 'platform', name: 'todo' }), 'todo');
assert.equal(platformExtensionName({ type: 'mcp', name: 'todo' }), null);

async function verifyPruning() {
  const removals = [];
  const client = {
    goose: {
      async sessionExtensionsList_unstable() {
        return {
          extensions: [
            { type: 'platform', name: 'todo' },
            { type: 'platform', name: 'apps' },
            { type: 'platform', name: 'extensionmanager' },
            { type: 'platform', name: 'summon' },
            { type: 'platform', name: 'developer' },
            { type: 'platform', name: 'analyze' },
            { type: 'platform', name: 'skills' },
            { type: 'mcp', server: { name: 'todo' } },
          ],
        };
      },
      async sessionExtensionsRemove_unstable(request) {
        removals.push(request);
      },
    },
  };

  const removed = await pruneSession({
    client,
    sessionId: 'session-1',
    request: { allowFileTools: false },
  });
  assert.deepEqual(
    removed,
    ['apps', 'extensionmanager', 'summon', 'todo', 'analyze', 'developer']
  );
  assert.deepEqual(
    removals,
    removed.map((name) => ({ sessionId: 'session-1', name }))
  );

  removals.length = 0;
  const fileToolRemoved = await pruneSession({
    client,
    sessionId: 'session-2',
    request: { allowFileTools: true },
  });
  assert.deepEqual(fileToolRemoved, ['apps', 'extensionmanager', 'summon', 'todo']);
  assert.deepEqual(
    removals,
    fileToolRemoved.map((name) => ({ sessionId: 'session-2', name }))
  );
}

verifyPruning().then(() => {
  console.log('session platform extension tests passed');
});
