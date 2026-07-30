'use strict';

const path = require('node:path');
const electron = require('electron');
const { registerRuntimeServices } = require('./runtime-services.cjs');
const { createProfileContext } = require('./profile-context.cjs');
const { createCapabilityService } = require('./service.cjs');
const { createSkillCreatorService } = require('./skill-creator-service.cjs');
const { createSkillHubClient } = require('./skillhub-client.cjs');
const { createKnowledgeService } = require('./knowledge-service.cjs');
const { createSecretStore } = require('./secret-store.cjs');
const { createSharedProjectService } = require('./shared-project-service.cjs');
const { createPublicationService } = require('./publication-service.cjs');
const SecurityMode = require('./security-mode.cjs');

const productRoot = path.resolve(__dirname, '..');
const securityMode = SecurityMode.normalizeSecurityMode(process.env.METEOMATE_SECURITY_MODE);
const profileContext = createProfileContext({
  app: electron.app,
  ipcMain: electron.ipcMain,
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
const publicationService = createPublicationService({
  ipcMain: electron.ipcMain,
  profileContext,
  securityMode,
});

registerRuntimeServices({
  profileContext,
  capabilityService: service,
  skillCreatorService,
  skillHubClient,
  knowledgeService,
  secretStore,
  sharedProjectService,
  publicationService,
  securityMode: SecurityMode.securityModeState(securityMode),
});
profileContext.registerIpc();
service.registerIpc();
skillCreatorService.registerIpc();
skillHubClient.registerIpc();
knowledgeService.registerIpc();
sharedProjectService.registerIpc();
publicationService.registerIpc();

electron.app.on('before-quit', () => {
  void service.shutdown();
});

require('../main.cjs');
