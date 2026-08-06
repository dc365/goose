const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'renderer-core.js'), 'utf8');
const actionsSource = fs.readFileSync(path.join(root, 'renderer-actions.js'), 'utf8');
const baseStyles = fs.readFileSync(path.join(root, 'styles-base.css'), 'utf8');
const appStyles = fs.readFileSync(path.join(root, 'styles-app.css'), 'utf8');
const accountStyles = fs.readFileSync(path.join(root, 'styles-account.css'), 'utf8');
const polishStyles = fs.readFileSync(path.join(root, 'styles-polish.css'), 'utf8');
const projectStyles = fs.readFileSync(path.join(root, 'styles-projects.css'), 'utf8');

function extractNamedFunction(name, input) {
  const start = input.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function: ${name}`);
  const bodyStart = input.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < input.length; index += 1) {
    if (input[index] === '{') depth += 1;
    if (input[index] === '}') depth -= 1;
    if (depth === 0) return input.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

assert.ok(rendererSource.includes('collapsedSidebarSections: []'));
assert.ok(rendererSource.includes('data-sidebar-toggle'));
assert.equal((rendererSource.match(/data-sidebar-toggle/g) || []).length, 1);
assert.ok(rendererSource.includes('class="titlebar-button titlebar-toggle"'));
assert.ok(!rendererSource.includes('sidebar-brand-toggle'));
assert.ok(!appStyles.includes('.window-titlebar:not(.sidebar-collapsed) .titlebar-toggle'));
assert.ok(rendererSource.includes('data-sidebar-section-toggle="tasks"'));
assert.ok(rendererSource.includes('data-sidebar-section-toggle="workspaces"'));
assert.ok(rendererSource.includes('class="sidebar-task-main"'));
assert.ok(rendererSource.includes('data-sidebar-task-menu='));
assert.ok(rendererSource.includes('class="sidebar-task-menu'));
assert.ok(rendererSource.includes('tasks.length >= 5'));
assert.ok(actionsSource.includes('event.stopPropagation();\n      toggleSidebarTaskMenu'));
assert.ok(rendererSource.includes('data-sidebar-task-rename='));
assert.ok(rendererSource.includes('data-sidebar-task-delete='));
assert.ok(rendererSource.includes('function renderProjectTaskRow('));
assert.ok(rendererSource.includes('class="project-task-more'));
assert.ok(rendererSource.includes('renderProjectTaskRow(task, index, tasks)'));
assert.ok(rendererSource.includes('data-task-menu-surface="project"'));
assert.ok(rendererSource.includes("sidebarTaskUI.menuSurface === 'project'"));
assert.ok(baseStyles.includes('--sidebar-width: 280px'));
assert.ok(baseStyles.includes('--sidebar-collapsed-width: 60px'));
assert.match(appStyles, /\.sidebar-sections\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1;[^}]*overflow-y:\s*auto;/s);
assert.match(accountStyles, /\.sidebar-account\{[^}]*flex:0 0 auto;/);
assert.ok(appStyles.includes('--sidebar-nav-height: 36px'));
assert.ok(appStyles.includes('--sidebar-account-height: 44px'));
assert.match(appStyles, /\.sidebar-sections\s*\{[^}]*margin-top:\s*12px;/s);
assert.match(accountStyles, /\.sidebar-account\{[^}]*margin-top:6px;[^}]*padding:6px 0 0[;}]/);
assert.match(appStyles, /\.sidebar-task-section \.sidebar-list\s*\{[^}]*gap:\s*0;/s);
assert.match(appStyles, /\.sidebar-task-main\s*\{[^}]*min-height:\s*28px;[^}]*grid-template-columns:\s*7px minmax\(0, 1fr\) auto;/s);
assert.match(appStyles, /\.sidebar-task-main strong\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*400;/s);
assert.match(appStyles, /\.sidebar-task-menu\s*\{[^}]*width:\s*112px;/s);
assert.match(projectStyles, /\.project-task-more\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/s);
assert.match(projectStyles, /\.project-task-row:hover \.project-task-more\s*\{[^}]*opacity:\s*1;/s);
assert.match(polishStyles, /\.nav-item\s*\{[^}]*font-weight:\s*400;/s);
assert.ok(rendererSource.includes('class="titlebar-button titlebar-preview-toggle'));
assert.ok(rendererSource.includes('data-preview-panel-toggle'));
assert.ok(!rendererSource.includes('data-preview-panel-close'));
assert.ok(actionsSource.includes("document.querySelector('[data-preview-panel-toggle]')"));
assert.ok(!actionsSource.includes("document.querySelector('[data-preview-panel-close]')"));

const context = vm.createContext({
  state: { sidebarCollapsed: false, collapsedSidebarSections: [] },
  calls: [],
  saveState() { context.calls.push('save'); },
  render() { context.calls.push('render'); },
  requestAnimationFrame(callback) { callback(); },
  document: {
    getElementById() { return { focus() {} }; },
    querySelector() { return { focus() {} }; },
  },
});

vm.runInContext(
  [extractNamedFunction('toggleSidebar', actionsSource), extractNamedFunction('toggleSidebarSection', actionsSource)].join('\n'),
  context
);
vm.runInContext('toggleSidebar()', context);
assert.equal(context.state.sidebarCollapsed, true);
vm.runInContext("toggleSidebarSection('tasks')", context);
assert.deepEqual([...context.state.collapsedSidebarSections], ['tasks']);
vm.runInContext("toggleSidebarSection('tasks')", context);
assert.deepEqual([...context.state.collapsedSidebarSections], []);
vm.runInContext("toggleSidebarSection('invalid')", context);
assert.deepEqual([...context.state.collapsedSidebarSections], []);
assert.equal(context.calls.filter((call) => call === 'save').length, 3);
assert.equal(context.calls.filter((call) => call === 'render').length, 3);

const taskContext = vm.createContext({
  state: {
    view: 'task',
    activeTaskId: 'task-1',
    activeProjectId: null,
    projects: [{ id: 'project-1', updatedAt: 1 }],
    tasks: [
      { id: 'task-1', title: '旧名称', status: 'completed' },
      { id: 'task-running', title: '运行任务', status: 'running' },
      { id: 'project-task', projectId: 'project-1', title: '项目任务', status: 'completed' },
    ],
  },
  sidebarTaskUI: {
    editingTaskId: 'task-1',
    editingSurface: 'sidebar',
    menuTaskId: 'task-1',
    menuSurface: 'sidebar',
  },
  previewUI: {
    open: true,
    taskId: 'task-1',
    activeId: 'tab-1',
    tabs: [{ id: 'tab-1', taskId: 'task-1' }],
    surfaceStates: { 'tab-1': { scrollTop: 12 } },
  },
  runtimeStreamCommitTimers: new Map([['task-1', 11]]),
  runtimeProgressCommitTimers: new Map([['task-1', 12]]),
  pendingStreamCommitTaskIds: new Set(['task-1']),
  pendingQueuedPromptTaskIds: new Set(['task-1']),
  calls: [],
  alerts: [],
  saveState() { taskContext.calls.push('save'); },
  render() { taskContext.calls.push('render'); },
  confirm() { return true; },
  alert(message) { taskContext.alerts.push(message); },
  window: { clearTimeout(timer) { taskContext.calls.push(`clear:${timer}`); } },
});

vm.runInContext(
  [
    extractNamedFunction('commitSidebarTaskRename', actionsSource),
    extractNamedFunction('deleteSidebarTask', actionsSource),
  ].join('\n'),
  taskContext
);
assert.equal(vm.runInContext("commitSidebarTaskRename('task-1', '   ')", taskContext), false);
assert.equal(vm.runInContext("commitSidebarTaskRename('task-1', ' 新名称 ')", taskContext), true);
assert.equal(taskContext.state.tasks[0].title, '新名称');
assert.equal(taskContext.sidebarTaskUI.editingTaskId, null);
assert.equal(taskContext.sidebarTaskUI.editingSurface, null);
assert.equal(taskContext.sidebarTaskUI.menuTaskId, null);
assert.equal(taskContext.sidebarTaskUI.menuSurface, null);
assert.equal(vm.runInContext("deleteSidebarTask('task-running')", taskContext), false);
assert.equal(taskContext.alerts.length, 1);
assert.equal(vm.runInContext("deleteSidebarTask('task-1')", taskContext), true);
assert.deepEqual(taskContext.state.tasks.map((task) => task.id), ['task-running', 'project-task']);
assert.equal(taskContext.state.activeTaskId, null);
assert.equal(taskContext.state.view, 'catalog');
assert.equal(taskContext.previewUI.open, false);
assert.equal(taskContext.previewUI.tabs.length, 0);
assert.equal(taskContext.runtimeStreamCommitTimers.size, 0);
assert.equal(taskContext.runtimeProgressCommitTimers.size, 0);
taskContext.state.view = 'project-detail';
taskContext.state.activeProjectId = 'project-1';
taskContext.state.activeTaskId = 'project-task';
assert.equal(vm.runInContext("deleteSidebarTask('project-task')", taskContext), true);
assert.equal(taskContext.state.activeTaskId, null);
assert.equal(taskContext.state.view, 'project-detail');
assert.ok(taskContext.state.projects[0].updatedAt > 1);

console.log('sidebar layout tests passed');
