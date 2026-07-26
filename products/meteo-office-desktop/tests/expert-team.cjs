const assert = require('node:assert/strict');
const ExpertTeam = require('../harness/expert-team');

const experts = [
  {
    id: 'analyst',
    name: '分析专家',
    avatar: '析',
    mission: '建立事实基线',
    instruction: '只使用可核验的证据。',
  },
  {
    id: 'writer',
    name: '写作专家',
    avatar: '稿',
    mission: '形成交付稿',
    instruction: '忠实呈现已核验结论。',
  },
  {
    id: 'reviewer',
    name: '审核专家',
    avatar: '审',
    mission: '独立复核',
    instruction: '指出矛盾和缺口。',
  },
];

const definition = ExpertTeam.normalizeDefinition({
  id: 'delivery-team',
  kind: 'team',
  name: '交付专家团',
  version: '1.0.0',
  instruction: '保留证据、分歧和不确定性。',
  nodes: [
    { id: 'analysis', expert: 'analyst', dependsOn: [], objective: '建立事实基线。' },
    { id: 'writing', expert: 'writer', dependsOn: ['analysis'], objective: '形成交付稿。' },
    { id: 'review', expert: 'reviewer', dependsOn: ['analysis'], objective: '独立复核。' },
  ],
  execution: { strategy: 'dag', maxParallel: 2, failurePolicy: 'continue' },
}, experts);

assert.equal(definition.nodes.length, 3);
assert.equal(definition.nodes[0].expert.name, '分析专家');
assert.deepEqual(
  ExpertTeam.executionWaves(definition).map((wave) => wave.map((node) => node.id)),
  [['analysis'], ['writing', 'review']]
);
assert.equal(ExpertTeam.isTeamRequest(definition), true);

const run = ExpertTeam.createRunState(definition, { id: 'run-001', startedAt: 100 });
assert.equal(run.id, 'run-001');
assert.equal(run.status, 'running');
assert.deepEqual(run.members.map((member) => member.status), ['pending', 'pending', 'pending']);

const results = new Map([
  ['analysis', {
    id: 'analysis',
    name: '分析专家',
    status: 'completed',
    output: '事实 A 已核验。',
  }],
]);
const memberPrompt = ExpertTeam.memberPrompt({
  team: definition,
  node: definition.nodes[1],
  userPrompt: '完成联合交付。',
  results,
});
assert.match(memberPrompt, /你是“写作专家”/);
assert.match(memberPrompt, /事实 A 已核验/);
assert.match(memberPrompt, /不要代替负责人汇总/);

results.set('writing', {
  id: 'writing',
  name: '写作专家',
  status: 'completed',
  output: '交付稿完成。',
});
results.set('review', {
  id: 'review',
  name: '审核专家',
  status: 'failed',
  error: '缺少一项证据。',
});
const synthesisPrompt = ExpertTeam.synthesisPrompt({
  team: definition,
  userPrompt: '完成联合交付。',
  results,
  firstTurn: true,
});
assert.match(synthesisPrompt, /各成员独立 Agent 的真实执行结果/);
assert.match(synthesisPrompt, /交付稿完成/);
assert.match(synthesisPrompt, /缺少一项证据/);
assert.match(synthesisPrompt, /blocker/);

const embedded = ExpertTeam.normalizeDefinition({
  id: 'embedded-team',
  kind: 'team',
  name: '固化专家团',
  nodes: [
    {
      id: 'embedded',
      expert: { ...experts[0] },
      objective: '使用任务创建时固化的专家快照。',
    },
  ],
});
assert.equal(embedded.nodes[0].expert.id, 'analyst');

assert.throws(
  () => ExpertTeam.normalizeDefinition({
    id: 'cyclic-team',
    kind: 'team',
    name: '循环团队',
    nodes: [
      { id: 'one', expert: 'analyst', dependsOn: ['two'] },
      { id: 'two', expert: 'writer', dependsOn: ['one'] },
    ],
  }, experts),
  /循环依赖/
);
assert.throws(
  () => ExpertTeam.normalizeDefinition({
    id: 'missing-team',
    kind: 'team',
    name: '缺失专家团队',
    nodes: [{ id: 'missing', expert: 'unknown' }],
  }, experts),
  /不存在的专家/
);

console.log('MeteoMate expert-team orchestration tests passed.');
