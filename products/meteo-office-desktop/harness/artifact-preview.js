(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.ArtifactPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);

  function pathExtension(value) {
    const clean = String(value || '').split(/[?#]/)[0];
    const name = clean.split(/[\\/]/).pop() || '';
    const index = name.lastIndexOf('.');
    return index > 0 ? name.slice(index + 1).toLowerCase() : '';
  }

  function artifactTarget(artifact = {}) {
    return String(artifact.uri || artifact.path || '').trim();
  }

  function artifactSurfaceTarget(artifact = {}) {
    const render = artifact.metadata?.render || {};
    return String(
      render.previewUri
      || artifact.metadata?.previewUri
      || artifactTarget(artifact)
    ).trim();
  }

  function artifactKind(artifact = {}) {
    const target = artifactSurfaceTarget(artifact);
    if (/^https?:\/\//i.test(target)) return 'web';
    const extension = pathExtension(target) || pathExtension(artifact.name);
    if (['html', 'htm'].includes(extension)) return 'web';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(extension)) return 'image';
    if (extension === 'pdf' || ['md', 'markdown'].includes(extension)) return 'document';
    if (OFFICE_EXTENSIONS.has(extension)) return 'office';
    return 'code';
  }

  function createPreviewTab(artifact = {}, context = {}) {
    const target = artifactTarget(artifact);
    const surfaceTarget = artifactSurfaceTarget(artifact);
    if (!target && !surfaceTarget) throw new Error('Artifact preview requires a target');
    const title = String(artifact.name || target.split(/[\\/]/).pop() || '预览');
    const extension = pathExtension(title) || pathExtension(surfaceTarget);
    const identity = String(artifact.id || target || surfaceTarget);
    return {
      id: `preview-${identity.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(-80)}`,
      artifactId: artifact.id || null,
      title,
      extension: extension.toUpperCase() || (artifactKind(artifact) === 'web' ? 'WEB' : 'FILE'),
      kind: artifactKind(artifact),
      target,
      surfaceTarget,
      workspace: context.workspace || '',
      taskId: context.taskId || null,
    };
  }

  function normalizePanelWidth(value, availableWidth = 1200) {
    const available = Number.isFinite(Number(availableWidth)) ? Number(availableWidth) : 1200;
    const maximum = Math.max(420, Math.floor(Math.min(available * 0.68, available - 440)));
    const numeric = Number(value);
    return Math.min(maximum, Math.max(420, Number.isFinite(numeric) ? Math.round(numeric) : 560));
  }

  return {
    artifactKind,
    artifactSurfaceTarget,
    artifactTarget,
    createPreviewTab,
    normalizePanelWidth,
    pathExtension,
  };
});
