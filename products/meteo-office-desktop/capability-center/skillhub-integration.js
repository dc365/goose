(function skillHubIntegration(root) {
  'use strict';

  const api = root.MeteoMateCapabilityCenter;
  const skillHub = api.skillHub;
  const hub = skillHub.state;
  const { connect, loadRemoteSkills, loadCollections, settingsDialog, openSkill, openCollection, publishDraftDialog } = skillHub;

  const originalBindEvents = bindEvents;
  bindEvents = function bindSkillHubEvents() {
    originalBindEvents();
    document.querySelectorAll('[data-skillhub-view]').forEach((button) =>
      button.addEventListener('click', async () => {
        hub.view = button.dataset.skillhubView;
        hub.activeCollection = null;
        if (hub.view === 'installed') return render();
        if (hub.status === 'idle') await connect({ rerender: false });
        if (hub.view === 'skillhub') await loadRemoteSkills();
        else if (hub.view === 'recommendations') await loadRemoteSkills({ recommendations: true });
        else await loadCollections();
      })
    );
    document.getElementById('skillhub-settings')?.addEventListener('click', settingsDialog);
    document.getElementById('skillhub-publish-draft')?.addEventListener('click', () => void publishDraftDialog());
    document.querySelectorAll('[data-skillhub-skill]').forEach((button) =>
      button.addEventListener('click', () => void openSkill(button.dataset.skillhubSkill))
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
    if (search && ['skillhub', 'recommendations'].includes(hub.view)) {
      search.addEventListener('input', (event) => {
        hub.query = event.target.value;
        window.clearTimeout(search._skillHubTimer);
        search._skillHubTimer = window.setTimeout(
          () => void loadRemoteSkills({ recommendations: hub.view === 'recommendations' }),
          300
        );
      });
    }
  };

  void skillHub
    .loadSettings()
    .then(() => connect({ rerender: false }))
    .then((connected) => (connected ? loadRemoteSkills({ recommendations: true }) : render()));
})(typeof globalThis !== 'undefined' ? globalThis : window);
