'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const electron = require('electron');
const { registerRuntimeServices } = require('./runtime-services.cjs');
const { createProfileContext } = require('./profile-context.cjs');
const { createCapabilityService } = require('./service.cjs');
const { createSkillCreatorService } = require('./skill-creator-service.cjs');
const { createSkillHubClient } = require('./skillhub-client.cjs');
const { createKnowledgeService } = require('./knowledge-service.cjs');
const { createSecretStore } = require('./secret-store.cjs');
const { createAuthCredentialStore } = require('./auth-credential-store.cjs');
const { createSharedProjectService } = require('./shared-project-service.cjs');
const { createMemoryService } = require('./memory-service.cjs');
const SecurityMode = require('./security-mode.cjs');

const ownsSingleInstanceLock = typeof electron.app.requestSingleInstanceLock === 'function'
  ? electron.app.requestSingleInstanceLock()
  : true;
if (!ownsSingleInstanceLock) {
  electron.app.quit();
} else {
const productRoot = path.resolve(__dirname, '..');
const productEntryUrl = pathToFileURL(path.join(productRoot, 'index.html')).href;

function isTrustedMemoryEvent(event) {
  const sender = event?.sender;
  if (!sender || sender.isDestroyed?.()) return false;
  if (event.senderFrame && sender.mainFrame && event.senderFrame !== sender.mainFrame) return false;
  const senderUrl = String(sender.getURL?.() || event.senderFrame?.url || '');
  return senderUrl === productEntryUrl || senderUrl.startsWith(`${productEntryUrl}?`) || senderUrl.startsWith(`${productEntryUrl}#`);
}

async function confirmMemoryMutation({ action, memory }) {
  const enabling = action === 'enable';
  const deleting = action === 'delete';
  const updating = action === 'update';
  const scope = memory?.scope?.type === 'project' ? '项目记忆' : '个人记忆';
  const title = String(memory?.title || '未命名记忆').trim().slice(0, 240);
  const summary = String(memory?.summary || '').trim().slice(0, 8000);
  const tags = (Array.isArray(memory?.tags) ? memory.tags : [])
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 32)
    .join('、');
  const sources = (Array.isArray(memory?.sourceRefs) ? memory.sourceRefs : [])
    .slice(0, 4)
    .map((source) => `${String(source?.kind || 'manual')}:${String(source?.id || '').trim()}`)
    .filter((source) => !source.endsWith(':'))
    .join('、');
  const options = {
    type: deleting ? 'warning' : 'question',
    title: enabling ? '确认启用记忆' : deleting ? '确认删除记忆' : updating ? '确认更新记忆' : '确认保存记忆',
    message: enabling
      ? '允许 MeteoMate 在后续对话中使用你保存的记忆？'
      : deleting ? `永久删除“${title}”？` : `${updating ? '更新' : '保存'}“${title}”为${scope}？`,
    detail: enabling
      ? '记忆默认关闭。启用后只会使用你明确保存的内容，可随时在“个性化”中关闭；关闭不会删除已有记忆。'
      : deleting
      ? '删除后无法从记忆中心恢复。'
      : `${summary || '无内容摘要'}${tags ? `\n\n标签：${tags}` : ''}${sources ? `\n\n来源：${sources}` : ''}\n\n只有确认后的内容才会作为长期记忆用于后续对话。`,
    buttons: [enabling ? '启用' : deleting ? '删除' : updating ? '更新' : '保存', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const owner = electron.BrowserWindow.getFocusedWindow();
  const result = owner
    ? await electron.dialog.showMessageBox(owner, options)
    : await electron.dialog.showMessageBox(options);
  return result.response === 0;
}

const securityMode = SecurityMode.normalizeSecurityMode(process.env.METEOMATE_SECURITY_MODE);
const authCredentialStore = createAuthCredentialStore({
  app: electron.app,
  safeStorage: electron.safeStorage,
});
const profileContext = createProfileContext({
  app: electron.app,
  ipcMain: electron.ipcMain,
  credentialStore: authCredentialStore,
  notifyRenderer(snapshot) {
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('auth:changed', snapshot);
    }
  },
});
const secretStore = createSecretStore({
  safeStorage: electron.safeStorage,
  profileContext,
  app: electron.app,
  securityMode,
});
const service = createCapabilityService({
  app: electron.app,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  shell: electron.shell,
  productRoot,
  profileContext,
  secretStore,
});
const skillCreatorService = createSkillCreatorService({
  app: electron.app,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  shell: electron.shell,
  capabilityService: service,
});
const skillHubClient = createSkillHubClient({
  app: electron.app,
  ipcMain: electron.ipcMain,
  capabilityService: service,
  skillCreatorService,
  profileContext,
});
const knowledgeService = createKnowledgeService({
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  profileContext,
  secretStore,
});
const sharedProjectService = createSharedProjectService({
  ipcMain: electron.ipcMain,
  profileContext,
});
const memoryService = createMemoryService({
  ipcMain: electron.ipcMain,
  profileContext,
  isTrustedEvent: isTrustedMemoryEvent,
  confirmMemoryMutation,
});
registerRuntimeServices({
  profileContext,
  capabilityService: service,
  skillCreatorService,
  skillHubClient,
  knowledgeService,
  secretStore,
  sharedProjectService,
  memoryService,
  securityMode: SecurityMode.securityModeState(securityMode),
});
profileContext.registerIpc();
profileContext.beginRestore();
service.registerIpc();
skillCreatorService.registerIpc();
skillHubClient.registerIpc();
knowledgeService.registerIpc();
sharedProjectService.registerIpc();
memoryService.registerIpc();
electron.app.on('before-quit', () => {
  void service.shutdown();
  memoryService.shutdown();
});

require('../main.cjs');
}
