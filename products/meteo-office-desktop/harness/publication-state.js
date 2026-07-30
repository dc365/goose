(function (root, factory) {
  const Shared = typeof module === 'object' && module.exports
    ? require('./shared')
    : root.MeteoMateHarness.Shared;
  const ValidationEngine = typeof module === 'object' && module.exports
    ? require('./validation-engine')
    : root.MeteoMateHarness.ValidationEngine;
  const api = factory(Shared, ValidationEngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MeteoMateHarness = root.MeteoMateHarness || {};
  root.MeteoMateHarness.PublicationState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Shared, ValidationEngine) {
  'use strict';

  const SIGNOFF_BLOCKER = '缺少预报员或业务人员签发';

  function normalizeValidPeriod(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (!value || typeof value !== 'object') return null;
    const start = value.start || value.from || value.begin || null;
    const end = value.end || value.to || value.until || null;
    return [start, end].filter(Boolean).join('/') || null;
  }

  function normalizeAnalysis(input = {}, fallback = {}) {
    const conclusions = input.conclusions || input.forecastConclusions || input.forecast_conclusions || [];
    return {
      region: String(input.region || fallback.region || '').trim() || null,
      issueTime: input.issueTime || input.issue_time || fallback.issueTime || null,
      validPeriod: normalizeValidPeriod(
        input.validPeriod || input.valid_period || fallback.validPeriod || null
      ),
      conclusions: (Array.isArray(conclusions) ? conclusions : []).map((conclusion) => ({
        text: String(conclusion?.text || conclusion?.title || '').trim(),
        evidenceIds: Shared.uniqueStrings(conclusion?.evidenceIds || conclusion?.evidence_ids),
      })),
    };
  }

  function analysisForTask(task = {}) {
    const meteorology = task.contextSnapshot?.meteorologicalContext || {};
    const fallback = {
      region: meteorology.region || null,
      issueTime: null,
      validPeriod: meteorology.validPeriod || null,
    };
    if (task.publicationAnalysis && typeof task.publicationAnalysis === 'object') {
      return normalizeAnalysis(task.publicationAnalysis, fallback);
    }
    return normalizeAnalysis({}, fallback);
  }

  function updateAnalysis(task, analysis) {
    if (!task?.id) throw new Error('Publication analysis requires a task');
    task.publicationAnalysis = normalizeAnalysis(analysis, analysisForTask(task));
    task.publication = {
      ...(task.publication || {}),
      dirty: true,
      error: null,
    };
    return task.publicationAnalysis;
  }

  function referencedEvidenceIds(analysis = {}) {
    return new Set(
      (analysis.conclusions || [])
        .flatMap((conclusion) => conclusion?.evidenceIds || [])
        .map(String)
    );
  }

  function artifactEvidenceIds(artifacts = []) {
    return new Set(
      (Array.isArray(artifacts) ? artifacts : [])
        .flatMap((artifact) => artifact?.lineage?.evidenceIds || [])
        .map(String)
        .filter(Boolean)
    );
  }

  function currentArtifacts(artifacts = []) {
    const records = Array.isArray(artifacts) ? artifacts : [];
    const identityFor = (artifact) => {
      const artifactPath = String(artifact?.path || '').trim().replaceAll('\\', '/');
      if (artifactPath) return `path:${artifactPath}`;
      const artifactURI = String(artifact?.uri || '').trim();
      return artifactURI ? `uri:${artifactURI}` : null;
    };
    const latestByIdentity = new Map();
    records.forEach((artifact, index) => {
      const identity = identityFor(artifact);
      if (identity) latestByIdentity.set(identity, index);
    });
    return records.filter((artifact, index) => {
      const identity = identityFor(artifact);
      return !identity || latestByIdentity.get(identity) === index;
    });
  }

  function requestForTask(task = {}, overrides = {}) {
    if (!task.id) throw new Error('Publication request requires a task');
    const analysis = analysisForTask(task);
    const referencedIds = referencedEvidenceIds(analysis);
    const artifacts = currentArtifacts(task.artifacts);
    const authorityIds = new Set([
      ...referencedIds,
      ...artifactEvidenceIds(artifacts),
    ]);
    return {
      ...Shared.cleanObject(overrides),
      taskId: task.id,
      workspace: task.workspace || null,
      analysis,
      artifacts: Shared.deepClone(artifacts),
      evidence: Shared.deepClone(
        (Array.isArray(task.evidence) ? task.evidence : [])
          .filter((record) => authorityIds.has(String(record?.id || '')))
      ),
    };
  }

  function requestFingerprint(request = {}) {
    return Shared.contentHash({
      taskId: String(request.taskId || ''),
      workspace: String(request.workspace || ''),
      analysis: normalizeAnalysis(request.analysis || {}),
      artifacts: Array.isArray(request.artifacts) ? request.artifacts : [],
      evidence: Array.isArray(request.evidence) ? request.evidence : [],
    });
  }

  function requestMatchesTask(task, request) {
    return requestFingerprint(requestForTask(task)) === requestFingerprint(request);
  }

  function cachedRequestMatchesTask(task) {
    const cachedFingerprint = task?.publication?.requestFingerprint;
    if (typeof cachedFingerprint !== 'string' || !cachedFingerprint) return false;
    try {
      return cachedFingerprint === requestFingerprint(requestForTask(task));
    } catch {
      return false;
    }
  }

  function analysisMatchesTask(task, analysis) {
    return Shared.stableStringify(analysisForTask(task))
      === Shared.stableStringify(normalizeAnalysis(analysis, analysisForTask(task)));
  }

  function evaluate(task = {}, signoff = task.publication?.signoff || null, at = Date.now()) {
    const request = requestForTask(task);
    return ValidationEngine.runPublicationGate({
      taskId: request.taskId,
      analysis: request.analysis,
      artifacts: request.artifacts,
      evidence: request.evidence,
      qcWaivers: task.publication?.qcWaivers || [],
      humanSignoff: signoff,
      at,
    });
  }

  function signable(gate = {}) {
    const blockers = Array.isArray(gate.blockers) ? gate.blockers : [];
    return blockers.length === 1 && blockers[0] === SIGNOFF_BLOCKER;
  }

  function applyServiceResult(task, request = {}, result) {
    const hasRequest = result !== undefined;
    const serviceResult = hasRequest ? result : request;
    task.publication = {
      signoff: serviceResult.signoff || null,
      gate: serviceResult.gate || null,
      qcWaivers: Array.isArray(serviceResult.qcWaivers)
        ? Shared.deepClone(serviceResult.qcWaivers)
        : Shared.deepClone(task.publication?.qcWaivers || []),
      checkedAt: serviceResult.gate?.checkedAt || Date.now(),
      error: null,
      dirty: false,
      requestFingerprint: hasRequest ? requestFingerprint(request) : null,
    };
    return task.publication;
  }

  function applyError(task, error) {
    task.publication = {
      ...(task.publication || {}),
      gate: null,
      error: error?.message || String(error || '发布检查失败'),
      checkedAt: Date.now(),
      dirty: true,
      requestFingerprint: null,
    };
    return task.publication;
  }

  return {
    SIGNOFF_BLOCKER,
    normalizeValidPeriod,
    normalizeAnalysis,
    analysisForTask,
    updateAnalysis,
    referencedEvidenceIds,
    artifactEvidenceIds,
    currentArtifacts,
    requestForTask,
    requestFingerprint,
    requestMatchesTask,
    cachedRequestMatchesTask,
    analysisMatchesTask,
    evaluate,
    signable,
    applyServiceResult,
    applyError,
  };
});
