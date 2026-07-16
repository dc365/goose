'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const { createCapabilityService } = require('./service.cjs');
const { createSkillCreatorService } = require('./skill-creator-service.cjs');
const { createSkillHubClient } = require('./skillhub-client.cjs');
const { createEnterpriseClient } = require('./enterprise-client.cjs');

const productRoot = path.resolve(__dirname, '..');
const service = createCapabilityService({
  app: electron.app,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  safeStorage: electron.safeStorage,
  shell: electron.shell,
  productRoot,
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
  safeStorage: electron.safeStorage,
  capabilityService: service,
  skillCreatorService,
});
const enterpriseClient = createEnterpriseClient({
  app: electron.app,
  ipcMain: electron.ipcMain,
  safeStorage: electron.safeStorage,
  skillHubClient,
});

global.__METEOMATE_CAPABILITY_SERVICE__ = service;
global.__METEOMATE_SKILL_CREATOR_SERVICE__ = skillCreatorService;
global.__METEOMATE_SKILLHUB_CLIENT__ = skillHubClient;
global.__METEOMATE_ENTERPRISE_CLIENT__ = enterpriseClient;
service.registerIpc();
skillCreatorService.registerIpc();
skillHubClient.registerIpc();
enterpriseClient.registerIpc();

const mainPath = path.join(productRoot, 'main.cjs');
let source = fs.readFileSync(mainPath, 'utf8');
const originalBlock = `    const enabledExtensions = request.allowFileTools
      ? [
          {
            type: 'builtin',
            name: 'developer',
            display_name: 'Developer',
            timeout: 300,
            bundled: true,
          },
        ]
      : [];`;
const replacementBlock = `    const enabledExtensions = [
      ...(request.allowFileTools
        ? [
            {
              type: 'builtin',
              name: 'developer',
              description: 'Workspace file and command tools',
              display_name: 'Developer',
              timeout: 300,
              bundled: true,
            },
          ]
        : []),
      ...global.__METEOMATE_CAPABILITY_SERVICE__.extensionsForRequest(request),
      ...(await global.__METEOMATE_ENTERPRISE_CLIENT__.extensionsForRequest(request)),
    ];`;
if (!source.includes(originalBlock)) {
  throw new Error('MeteoMate capability wrapper could not locate the extension assembly point in main.cjs');
}
source = source.replace(originalBlock, replacementBlock);

const wrappedMain = new Module(mainPath, module);
wrappedMain.filename = mainPath;
wrappedMain.paths = Module._nodeModulePaths(productRoot);
wrappedMain._compile(source, mainPath);
