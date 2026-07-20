(function bootstrapMeteoMateState(root) {
  'use strict';
  const keys = {
    current: 'meteomate-desktop-state-v2',
    legacy: 'meteo-office-desktop-state-v1',
    backup: 'meteomate-desktop-state-bootstrap-backup-v1',
  };
  root.__METEOMATE_STATE_BOOTSTRAP__ = { keys };
})(typeof globalThis !== 'undefined' ? globalThis : window);
