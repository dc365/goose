const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const WeatherConnector = require('../capabilities/weather-connector.js');
const ExpertTeam = require('../harness/expert-team');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-fixture-weather-'));

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function: ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

try {
  const betaTools = WeatherConnector.TOOL_DEFINITIONS.filter((tool) => tool.maturity === 'beta');
  const demoTools = WeatherConnector.TOOL_DEFINITIONS.filter((tool) => tool.maturity === 'demo');
  assert.equal(betaTools.length, 6);
  assert.equal(demoTools.length, 10);
  assert.deepEqual(
    betaTools.map((tool) => tool.name),
    [
      'weather_list_sources',
      'weather_query_dataset',
      'weather_validate_dataset',
      'weather_build_evidence',
      'weather_diagnose_dataset',
      'weather_render_dataset_map',
    ],
  );
  assert.ok(demoTools.every((tool) => !betaTools.some((betaTool) => betaTool.name === tool.name)));
  const weatherDataDiscovery = WeatherConnector.discoveryResult('weather-data');
  assert.ok(weatherDataDiscovery.result.tools.every((tool) =>
    tool.maturity === tool.annotations.maturity
  ));
  const weatherQueryTool = weatherDataDiscovery.result.tools
    .find((tool) => tool.name === 'weather_query_dataset');
  assert.equal(weatherQueryTool.annotations.readOnlyHint, false);
  assert.equal(weatherQueryTool.effects.networkMutation, true);

  const fixture = WeatherConnector.createFixtureWeatherRun(workspace);

  assert.equal(fixture.dataset.id, WeatherConnector.CASE_ID);
  assert.equal(fixture.dataset.metadata.classification, 'demo');
  assert.equal(fixture.dataset.metadata.synthetic, true);
  assert.equal(fixture.dataset.source.classification, 'demo');
  assert.equal(fixture.dataset.source.synthetic, true);
  assert.equal(fixture.dataset.source.official, false);

  assert.equal(fixture.algorithm.name, 'meteomate-weather-diagnosis');
  assert.equal(fixture.algorithm.version, 'meteomate-weather-diagnosis/1.1.0');
  assert.equal(fixture.diagnosis.heavyRain.total, 68);
  assert.notEqual(
    fixture.diagnosis.heavyRain.total,
    WeatherConnector.SYNTHETIC_CASE.diagnoses.heavyRain.total
  );
  assert.ok(fixture.evidence.length > 0);
  assert.ok(fixture.evidence.some((record) => record.evidenceType === 'algorithm-diagnosis'));
  assert.ok(fixture.evidence.every((record) => record.metadata.classification === 'demo'));
  assert.ok(fixture.evidence.every((record) => record.metadata.synthetic === true));

  assert.equal(fixture.artifacts.length, 1);
  assert.equal(fixture.artifacts[0].metadata.classification, 'demo');
  assert.equal(fixture.artifacts[0].metadata.synthetic, true);
  assert.deepEqual(fixture.artifacts[0].metadata.algorithm, fixture.algorithm);
  assert.ok(fs.statSync(fixture.artifacts[0].path).isFile());

  const evidenceIds = new Set(fixture.evidence.map((record) => record.id));
  assert.ok(fixture.forecastSummary.conclusions.length >= 3);
  assert.equal(typeof fixture.forecastSummary.validPeriod, 'string');
  assert.match(fixture.forecastSummary.validPeriod, /\//);
  for (const conclusion of fixture.forecastSummary.conclusions) {
    assert.ok(conclusion.text);
    assert.ok(conclusion.evidenceIds.length > 0);
    assert.ok(conclusion.evidenceIds.every((id) => evidenceIds.has(id)));
  }

  const events = WeatherConnector.fixtureRuntimeEvents({
    taskId: 'fixture-task',
    toolCallId: 'fixture-tool',
    fixture,
  });
  assert.deepEqual(
    events.map((event) => event.type),
    [
      ...fixture.evidence.map(() => 'evidence_created'),
      ...fixture.artifacts.map(() => 'artifact_created'),
      'turn_completed',
    ]
  );
  assert.ok(events.every((event) => event.taskId === 'fixture-task'));
  assert.ok(events.slice(0, -1).every((event) => event.toolCallId === 'fixture-tool'));
  for (const event of events.filter((item) => item.type === 'evidence_created')) {
    const diagnosis = event.evidence.evidenceType === 'algorithm-diagnosis';
    assert.equal(event.extensionName, diagnosis ? 'weather-diagnosis' : 'weather-data');
    assert.equal(event.toolName, diagnosis ? 'weather_diagnose_dataset' : 'weather_build_evidence');
  }
  assert.ok(events
    .filter((event) => event.type === 'artifact_created')
    .every((event) =>
      event.extensionName === 'gis-map' && event.toolName === 'weather_render_dataset_map'
    ));

  const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
  const runtimeEvents = [];
  const scheduled = [];
  const runtimeContext = vm.createContext({
    ExpertTeam: { isTeamRequest: () => false },
    WeatherConnector,
    activeHeadlessRuns: new Map(),
    app: { getPath: () => workspace },
    clearTimeout() {},
    path,
    sendRuntimeEvent(event) {
      runtimeEvents.push(event);
    },
    setTimeout(callback) {
      scheduled.push(callback);
      return scheduled.length;
    },
  });
  vm.runInContext(extractNamedFunction(mainSource, 'runMockTask'), runtimeContext);
  const resolvedDemoWorkspace = path.join(workspace, 'demo-workspace');
  fs.mkdirSync(resolvedDemoWorkspace, { recursive: true });
  const accepted = runtimeContext.runMockTask({
    taskId: 'mock-fixture-task',
    prompt: '运行固定天气 Fixture',
    expertName: '测试专家',
    workspace: '',
  });
  scheduled.forEach((callback) => callback());
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.workspace, resolvedDemoWorkspace);
  assert.equal(runtimeEvents[0].type, 'turn_started');
  const records = runtimeEvents.filter((event) =>
    ['evidence_created', 'artifact_created', 'turn_completed'].includes(event.type)
  );
  assert.ok(records.some((event) => event.type === 'evidence_created'));
  assert.deepEqual(
    records.map((event) => event.type),
    [
      ...records.filter((event) => event.type === 'evidence_created').map(() => 'evidence_created'),
      ...records.filter((event) => event.type === 'artifact_created').map(() => 'artifact_created'),
      'turn_completed',
    ]
  );
  assert.equal(records[0].evidence.metadata.classification, 'demo');
  assert.equal(records[0].evidence.metadata.synthetic, true);
  const mockResponse = runtimeEvents
    .filter((event) => event.type === 'assistant_message_delta')
    .map((event) => event.text)
    .join('');
  assert.match(mockResponse, /综合评分：68\/100/);
  assert.doesNotMatch(mockResponse, /综合评分：85\/100/);

  const teamRuntimeEvents = [];
  const teamScheduled = [];
  const teamRuntimeContext = vm.createContext({
    ExpertTeam,
    WeatherConnector,
    activeHeadlessRuns: new Map(),
    app: { getPath: () => workspace },
    clearTimeout() {},
    path,
    sendRuntimeEvent(event) {
      teamRuntimeEvents.push(event);
    },
    setTimeout(callback) {
      teamScheduled.push(callback);
      return teamScheduled.length;
    },
  });
  vm.runInContext(extractNamedFunction(mainSource, 'runMockTeamTask'), teamRuntimeContext);
  const teamAccepted = teamRuntimeContext.runMockTeamTask({
    taskId: 'mock-fixture-team-task',
    prompt: '运行固定天气 Fixture 联合研判',
    workspace: '',
    runAttemptId: 'team-run-attempt',
    team: {
      id: 'fixture-review-team',
      kind: 'team',
      name: 'Fixture 联合研判专家团',
      nodes: [{
        id: 'heavy-rain',
        expert: {
          id: 'heavy-rain-expert',
          name: '强降水专家',
          instruction: '使用 Fixture 的实际算法结果。',
        },
        objective: '复核强降水诊断。',
      }],
    },
  });
  teamScheduled.forEach((callback) => callback());
  assert.equal(teamAccepted.accepted, true);
  assert.equal(teamAccepted.workspace, resolvedDemoWorkspace);
  const teamRecords = teamRuntimeEvents.filter((event) =>
    ['evidence_created', 'artifact_created', 'team_completed', 'turn_completed'].includes(event.type)
  );
  assert.deepEqual(
    teamRecords.map((event) => event.type),
    [
      ...teamRecords.filter((event) => event.type === 'evidence_created').map(() => 'evidence_created'),
      ...teamRecords.filter((event) => event.type === 'artifact_created').map(() => 'artifact_created'),
      'team_completed',
      'turn_completed',
    ],
  );
  assert.ok(teamRecords.some((event) => event.type === 'evidence_created'));
  assert.ok(teamRecords.some((event) => event.type === 'artifact_created'));
  const teamText = teamRuntimeEvents
    .filter((event) => ['assistant_message_delta', 'team_member_completed'].includes(event.type))
    .map((event) => event.text || event.summary || '')
    .join('\n');
  assert.match(teamText, /68\/100/);
  assert.doesNotMatch(teamText, /85\/100/);

  const legacyArtifacts = WeatherConnector.createDemoArtifacts(workspace);
  assert.ok(legacyArtifacts.length > 0);
  assert.match(
    WeatherConnector.buildDemoResponse({
      prompt: '运行演示',
      workspace,
      artifacts: legacyArtifacts,
    }),
    /构造测试数据/
  );
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('fixture weather run tests passed');
