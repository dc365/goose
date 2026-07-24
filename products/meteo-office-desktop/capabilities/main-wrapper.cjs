'use strict';

const path = require('node:path');
const electron = require('electron');
const { registerRuntimeServices } = require('./runtime-services.cjs');
const { createProfileContext } = require('./profile-context.cjs');
const { createCapabilityService } = require('./service.cjs');
const { createSkillCreatorService } = require('./skill-creator-service.cjs');
const { createSkillHubClient } = require('./skillhub-client.cjs');
const { createKnowledgeService } = require('./knowledge-service.cjs');

const productRoot = path.resolve(__dirname, '..');
const profileContext = createProfileContext({
  app: electron.app,
  ipcMain: electron.ipcMain,
});
const service = createCapabilityService({
  app: electron.app,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  shell: electron.shell,
  productRoot,
  profileContext,
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
});

registerRuntimeServices({
  profileContext,
  capabilityService: service,
  skillCreatorService,
  skillHubClient,
  knowledgeService,
});
profileContext.registerIpc();
service.registerIpc();
skillCreatorService.registerIpc();
skillHubClient.registerIpc();
knowledgeService.registerIpc();

electron.app.on('before-quit', () => {
  void service.shutdown();
});

require('../main.cjs');
