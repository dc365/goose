const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meteoDesktop', {
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:status'),
  getModelSettings: () => ipcRenderer.invoke('runtime:model-settings'),
  saveModelSettings: (request) => ipcRenderer.invoke('runtime:model-settings-save', request),
  getDefaultAssistantWorkspace: () => ipcRenderer.invoke('workspace:assistant-default'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: (targetPath) => ipcRenderer.invoke('workspace:open', targetPath),
  openExternalUrl: (targetUrl) => ipcRenderer.invoke('external:open', targetUrl),
  sendRuntimeMessage: (request) => ipcRenderer.invoke('runtime:send', request),
  cancelRuntimeTask: (request) => ipcRenderer.invoke('runtime:cancel', request),
  resolvePermission: (request) => ipcRenderer.invoke('runtime:permission', request),

  listCapabilities: () => ipcRenderer.invoke('capability:list'),
  chooseSkillFile: () => ipcRenderer.invoke('capability:choose-skill-file'),
  chooseSkillDirectory: () => ipcRenderer.invoke('capability:choose-skill-directory'),
  inspectSkill: (sourcePath) => ipcRenderer.invoke('capability:inspect-skill', sourcePath),
  inspectBundledSkill: (skillId) => ipcRenderer.invoke('capability:inspect-bundled-skill', skillId),
  installSkill: (request) => ipcRenderer.invoke('capability:install-skill', request),
  setSkillEnabled: (request) => ipcRenderer.invoke('capability:set-skill-enabled', request),
  uninstallSkill: (id) => ipcRenderer.invoke('capability:uninstall-skill', id),
  updateSkillProjects: (request) => ipcRenderer.invoke('capability:update-skill-projects', request),
  saveConnector: (request) => ipcRenderer.invoke('capability:save-connector', request),
  testConnector: (request) => ipcRenderer.invoke('capability:test-connector', request),
  setConnectorEnabled: (request) => ipcRenderer.invoke('capability:set-connector-enabled', request),
  deleteConnector: (id) => ipcRenderer.invoke('capability:delete-connector', id),
  updateConnectorProjects: (request) => ipcRenderer.invoke('capability:update-connector-projects', request),
  openCapabilityPath: (targetPath) => ipcRenderer.invoke('capability:open-path', targetPath),

  listSkillDrafts: () => ipcRenderer.invoke('skill-creator:list-drafts'),
  createSkillDraft: (request) => ipcRenderer.invoke('skill-creator:create-draft', request),
  getSkillDraft: (id) => ipcRenderer.invoke('skill-creator:get-draft', id),
  readSkillDraftFile: (request) => ipcRenderer.invoke('skill-creator:read-file', request),
  writeSkillDraftFile: (request) => ipcRenderer.invoke('skill-creator:write-file', request),
  validateSkillDraft: (id) => ipcRenderer.invoke('skill-creator:validate-draft', id),
  exportSkillDraft: (request) => ipcRenderer.invoke('skill-creator:export-draft', request),
  installSkillDraft: (request) => ipcRenderer.invoke('skill-creator:install-draft', request),
  deleteSkillDraft: (id) => ipcRenderer.invoke('skill-creator:delete-draft', id),
  openSkillDraft: (id) => ipcRenderer.invoke('skill-creator:open-draft', id),

  onRuntimeEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('runtime:event', listener);
    return () => ipcRenderer.removeListener('runtime:event', listener);
  },
});
