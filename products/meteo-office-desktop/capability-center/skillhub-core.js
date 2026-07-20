(function skillHubCore(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const hub = {
    view: 'recommendations',
    status: 'idle',
    settings: null,
    identity: null,
    skills: [],
    recommendations: [],
    collections: [],
    managedSkills: [],
    managedTotal: 0,
    collectionSkills: [],
    activeCollection: null,
    error: '',
    query: '',
    category: '全部',
  };

  const list = (value) => (Array.isArray(value) ? value : []);
  const installedVersion = (skillId) =>
    api.installedSkills().find((item) => item.skillId === skillId && item.enabled)?.version || null;
  const canPublish = () => ['publisher', 'admin'].includes(hub.identity?.role);

  async function loadSettings() {
    hub.settings = await root.meteoDesktop.getSkillHubSettings();
    return hub.settings;
  }

  async function connect({ rerender = true } = {}) {
    hub.status = 'loading';
    hub.error = '';
    if (rerender) render();
    try {
      const result = await root.meteoDesktop.testSkillHub();
      hub.settings = result.settings;
      hub.identity = result.identity;
      hub.status = result.ok ? 'ready' : 'error';
      if (!result.ok) hub.error = 'SkillHub 健康检查未通过';
    } catch (error) {
      hub.status = 'error';
      hub.error = error?.message || String(error);
    }
    if (rerender) render();
    return hub.status === 'ready';
  }

  async function loadRemoteSkills({ recommendations = false, rerender = true } = {}) {
    hub.status = 'loading';
    hub.error = '';
    if (rerender) render();
    try {
      if (recommendations) {
        const project = typeof getActiveProject === 'function' ? getActiveProject() : null;
        const response = await root.meteoDesktop.getSkillHubRecommendations({
          q: hub.query || state.search,
          categories: project?.spec?.meteorologicalContext?.region ? ['气象业务'] : [],
          installedSkillIds: api.installedSkills().map((item) => item.skillId),
          connectorIds: api.configuredConnectors().filter((item) => item.enabled && !item.policyBlocked).map((item) => item.id),
          limit: 24,
        });
        hub.recommendations = list(response?.items);
      } else {
        const response = await root.meteoDesktop.listSkillHubSkills({ q: hub.query || state.search, limit: 100 });
        hub.skills = list(response?.items);
      }
      hub.status = 'ready';
    } catch (error) {
      hub.status = 'error';
      hub.error = error?.message || String(error);
    }
    if (rerender) render();
  }

  async function loadCollections({ rerender = true } = {}) {
    hub.status = 'loading';
    hub.error = '';
    if (rerender) render();
    try {
      const response = await root.meteoDesktop.listSkillHubCollections();
      hub.collections = list(response?.items);
      hub.status = 'ready';
    } catch (error) {
      hub.status = 'error';
      hub.error = error?.message || String(error);
    }
    if (rerender) render();
  }

  async function loadManagedSkills({ rerender = true } = {}) {
    hub.status = 'loading';
    hub.error = '';
    if (rerender) render();
    try {
      const response = await root.meteoDesktop.listManagedSkillHubSkills({
        q: hub.query || state.search,
        limit: 200,
      });
      hub.managedSkills = list(response?.items);
      hub.managedTotal = Number(response?.total || hub.managedSkills.length);
      hub.status = 'ready';
    } catch (error) {
      hub.status = 'error';
      hub.error = error?.message || String(error);
    }
    if (rerender) render();
  }

  api.skillHub = {
    state: hub,
    list,
    installedVersion,
    canPublish,
    loadSettings,
    connect,
    loadRemoteSkills,
    loadCollections,
    loadManagedSkills,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
