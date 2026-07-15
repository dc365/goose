(function bootstrapMeteoMateState(root) {
  'use strict';
  const keys = {
    current: 'meteomate-desktop-state-v2',
    legacy: 'meteo-office-desktop-state-v1',
    backup: 'meteomate-desktop-state-bootstrap-backup-v1',
  };

  function readRaw(key) {
    const value = localStorage.getItem(key);
    return value && value !== 'null' ? value : null;
  }

  const priorBackup = readRaw(keys.backup);
  const current = readRaw(keys.current);
  const legacy = readRaw(keys.legacy);
  const payload = priorBackup || JSON.stringify({ current, legacy, capturedAt: Date.now() });
  localStorage.setItem(keys.backup, payload);
  localStorage.setItem(keys.current, 'null');
  localStorage.setItem(keys.legacy, 'null');

  root.__METEOMATE_STATE_BOOTSTRAP__ = { keys, payload };
})(typeof globalThis !== 'undefined' ? globalThis : window);
