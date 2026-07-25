const ALWAYS_DISABLED_PLATFORM_EXTENSIONS = Object.freeze([
  'apps',
  'extensionmanager',
  'summon',
  'todo',
]);

const FILE_TOOL_PLATFORM_EXTENSIONS = Object.freeze([
  'analyze',
  'developer',
]);

function disabledPlatformExtensionNames(request = {}) {
  return request.allowFileTools
    ? [...ALWAYS_DISABLED_PLATFORM_EXTENSIONS]
    : [...ALWAYS_DISABLED_PLATFORM_EXTENSIONS, ...FILE_TOOL_PLATFORM_EXTENSIONS];
}

function platformExtensionName(extension) {
  if (extension?.type !== 'platform') return null;
  const name = String(extension.name || '').trim();
  return name || null;
}

async function pruneSession({ client, sessionId, request = {} }) {
  if (!client?.goose || !sessionId) throw new Error('缺少 Goose 会话或扩展客户端');

  const response = await client.goose.sessionExtensionsList_unstable({ sessionId });
  const loadedPlatformNames = new Set(
    (response.extensions || []).map(platformExtensionName).filter(Boolean)
  );
  const removed = disabledPlatformExtensionNames(request)
    .filter((name) => loadedPlatformNames.has(name));

  for (const name of removed) {
    await client.goose.sessionExtensionsRemove_unstable({ sessionId, name });
  }

  return removed;
}

module.exports = {
  disabledPlatformExtensionNames,
  platformExtensionName,
  pruneSession,
};
