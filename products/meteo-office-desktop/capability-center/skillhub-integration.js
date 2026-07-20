(function skillHubIntegration(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const skillHub = api.skillHub;
  const hub = skillHub.state;
  const {
    connect,
    loadRemoteSkills,
    loadCollections,
    loadManagedSkills,
    settingsDialog,
    openSkill,
    openCollection,
    publishDraftDialog,
    manageSkillDialog,
  } = skillHub;

  const originalBindEvents = bindEvents;
  bindEvents = function bindSkillHubEvents() {
    originalBindEvents();
    document.querySelectorAll('[data-skillhub-view]').forEach((button) =>
      button.addEventListener('click', async () => {
        hub.view = button.dataset.skillhubView;
        hub.activeCollection = null;
        hub.category = '全部';
        if (hub.view === 'installed') return render();
        if (hub.status === 'idle') await connect({ rerender: false });
        if (hub.view === 'skillhub') await loadRemoteSkills();
        else if (hub.view === 'recommendations') await loadRemoteSkills({ recommendations: true });
        else if (hub.view === 'managed') await loadManagedSkills();
        else await loadCollections();
      })
    );
    document.querySelectorAll('[data-skillhub-category]').forEach((button) =>
      button.addEventListener('click', () => {
        hub.category = button.dataset.skillhubCategory;
        render();
      })
    );
    document.getElementById('skillhub-settings')?.addEventListener('click', settingsDialog);
    document.getElementById('skillhub-publish-draft')?.addEventListener('click', () => void publishDraftDialog());
    document.querySelectorAll('[data-skillhub-skill]').forEach((button) =>
      button.addEventListener('click', () => void openSkill(button.dataset.skillhubSkill))
    );
    document.querySelectorAll('[data-skillhub-manage]').forEach((button) =>
      button.addEventListener('click', () => void manageSkillDialog(button.dataset.skillhubManage))
    );
    document.querySelectorAll('[data-skillhub-collection]').forEach((button) =>
      button.addEventListener('click', () => void openCollection(button.dataset.skillhubCollection))
    );
    document.querySelector('[data-skillhub-collection-back]')?.addEventListener('click', () => {
      hub.activeCollection = null;
      hub.collectionSkills = [];
      render();
    });
    const search = document.getElementById('catalog-search');
    if (search && ['skillhub', 'recommendations', 'managed'].includes(hub.view)) {
      search.addEventListener('input', (event) => {
        hub.query = event.target.value;
        window.clearTimeout(search._skillHubTimer);
        search._skillHubTimer = window.setTimeout(
          () => void (hub.view === 'managed'
            ? loadManagedSkills()
            : loadRemoteSkills({ recommendations: hub.view === 'recommendations' })),
          300
        );
      });
    }
  };

  void root.MeteoMateAccountReady.then((session) => {
    if (session.status !== 'authenticated' || session.user?.mustChangePassword) return null;
    return skillHub
      .loadSettings()
      .then(() => connect({ rerender: false }))
      .then(async (connected) => {
        if (!connected) return render();
        await loadRemoteSkills({ recommendations: true, rerender: false });
        if (skillHub.canPublish()) await loadManagedSkills({ rerender: false });
        render();
      });
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
