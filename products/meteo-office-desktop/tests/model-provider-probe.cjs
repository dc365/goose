'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
const helperStart = mainSource.indexOf('function sessionProviderId');
const helperEnd = mainSource.indexOf('class GooseAcpRuntime', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'provider helpers should be present');

function loadProbe(fetchImpl) {
  const context = {
    URL,
    fetch: fetchImpl,
    AbortSignal: { timeout: () => undefined },
  };
  vm.runInNewContext(
    `${mainSource.slice(helperStart, helperEnd)}\nthis.testModelProviderConnection = testModelProviderConnection;`,
    context
  );
  return context.testModelProviderConnection;
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

(async () => {
  const arkRequests = [];
  const testArk = loadProbe(async (url, request) => {
    const body = JSON.parse(request.body);
    arkRequests.push({ url, request, body });
    if (body.tools) {
      return jsonResponse({
        output: [{
          type: 'function_call',
          name: 'meteomate_connection_check',
          arguments: '{"value":"ok"}',
        }],
      });
    }
    return jsonResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
  });
  const arkResult = await testArk({
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'test-key',
    modelId: 'doubao-seed-2-0-lite-260215',
    toolCall: true,
  });
  assert.equal(arkResult.status, 'verified');
  assert.equal(arkResult.protocol, 'responses');
  assert.equal(arkRequests.length, 2);
  assert.equal(arkRequests[0].url, 'https://ark.cn-beijing.volces.com/api/v3/responses');
  assert.equal(arkRequests[0].request.headers.authorization, 'Bearer test-key');
  assert.equal(arkRequests[1].body.tools[0].name, 'meteomate_connection_check');
  assert.equal(arkResult.tests.find((test) => test.id === 'streaming').status, 'skipped');

  const chatRequests = [];
  const testChat = loadProbe(async (url, request) => {
    chatRequests.push({ url, body: JSON.parse(request.body) });
    return {
      ok: true,
      status: 200,
      text: async () => 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
    };
  });
  const chatResult = await testChat({
    apiUrl: 'http://127.0.0.1:11434/v1',
    requiresAuth: false,
    modelId: 'local-model',
  });
  assert.equal(chatResult.status, 'verified');
  assert.equal(chatResult.protocol, 'chat_completions');
  assert.equal(chatRequests[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(chatRequests[0].body.stream, true);
  assert.equal(chatResult.tests.find((test) => test.id === 'streaming').status, 'passed');

  const testFailure = loadProbe(async () => jsonResponse({ error: { message: 'invalid api key' } }, 401));
  const failedResult = await testFailure({
    apiUrl: 'https://gateway.example/v1',
    apiKey: 'bad-key',
    modelId: 'model-1',
  });
  assert.equal(failedResult.status, 'failed');
  assert.match(failedResult.message, /HTTP 401/);

  console.log('MeteoMate model provider probe checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
