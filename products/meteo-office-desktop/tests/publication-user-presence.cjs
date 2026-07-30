'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const QcPolicy = require('../harness/qc-policy');
const { createPublicationService } = require('../capabilities/publication-service.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-publication-presence-'));

function artifactHash(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

async function main() {
  const handlers = new Map();
  const dialogCalls = [];
  let dialogResponse = 0;
  const service = createPublicationService({
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
    dialog: {
      async showMessageBox(options) {
        dialogCalls.push(options);
        return { response: dialogResponse };
      },
    },
    profileContext: {
      currentPaths: () => ({ root }),
      isAuthenticated: () => false,
      publicState: () => ({ cachedUser: null }),
    },
    securityMode: 'internal',
    now: () => Date.parse('2026-07-31T06:00:00.000Z'),
  });
  service.registerIpc();

  const taskId = 'task-user-presence';
  const artifactPath = path.join(root, 'forecast.txt');
  fs.writeFileSync(artifactPath, 'trusted forecast artifact');
  const evidence = service.publicationAttestor.attestRecord('Evidence', {
    id: 'e-user-presence',
    source: 'trusted-weather-provider',
    sourceVersion: '2026.07',
    evidenceType: 'meteorological-fact',
    validTime: '2026-07-31T05:00:00.000Z',
    expiresAt: '2026-08-02T06:00:00.000Z',
    variable: 'rain24h',
    unit: 'mm',
    value: 80,
    qcStatus: 'checked',
    qcVersion: QcPolicy.POLICY_VERSION,
    metadata: {
      classification: 'production',
      synthetic: false,
      official: true,
      sourceId: 'trusted-weather-provider',
      datasetHash: 'a'.repeat(64),
    },
  }, {
    taskId,
    runId: 'run-user-presence',
    toolCallId: 'weather-evidence',
    extensionName: 'weather-data',
    toolName: 'weather_build_evidence',
  });
  const artifact = service.publicationAttestor.attestRecord('Artifact', {
    id: 'a-user-presence',
    name: 'forecast.txt',
    path: artifactPath,
    status: 'ready',
    evidenceIds: [evidence.id],
    contentHash: artifactHash(artifactPath),
    metadata: {
      classification: 'production',
      synthetic: false,
      official: true,
    },
  }, {
    taskId,
    runId: 'run-user-presence',
    toolCallId: 'weather-map',
    extensionName: 'gis-map',
    toolName: 'weather_render_dataset_map',
  });
  const request = {
    taskId,
    workspace: root,
    analysis: {
      conclusions: [{ text: '存在强降水风险', evidenceIds: [evidence.id] }],
    },
    evidence: [evidence],
    artifacts: [artifact],
  };

  await assert.rejects(
    handlers.get('publication:sign')(null, request),
    /用户已取消/,
  );
  assert.equal(service.check(request).signoff, null);

  dialogResponse = 1;
  const signed = await handlers.get('publication:sign')(null, request);
  assert.equal(signed.gate.ready, true);
  assert.equal(signed.signoff.confirmation.method, 'electron-main-dialog');
  assert.equal(signed.signoff.confirmation.action, 'sign');
  assert.match(signed.signoff.confirmation.challengeId, /^[a-f0-9-]{36}$/);
  assert.equal(dialogCalls.at(-1).defaultId, 0);
  assert.equal(dialogCalls.at(-1).cancelId, 0);

  await assert.rejects(
    handlers.get('publication:revoke')(null, { taskId, reason: '太短' }),
    /8-1000/,
  );
  const revoked = await handlers.get('publication:revoke')(null, {
    taskId,
    reason: '最新业务会商结论变化，需要撤销当前签发',
  });
  assert.equal(revoked.revoked, true);
  const registry = JSON.parse(
    fs.readFileSync(path.join(root, 'publication-signoffs.json'), 'utf8'),
  );
  const revocation = registry.signoffHistory[taskId].at(-1);
  assert.equal(revocation.revocationConfirmation.method, 'electron-main-dialog');
  assert.equal(revocation.revocationConfirmation.action, 'revoke');
  assert.equal(revocation.revocationReason, '最新业务会商结论变化，需要撤销当前签发');
}

main()
  .then(() => {
    fs.rmSync(root, { recursive: true, force: true });
    console.log('publication trusted user-presence tests passed');
  })
  .catch((error) => {
    fs.rmSync(root, { recursive: true, force: true });
    console.error(error);
    process.exitCode = 1;
  });
