class AgentRuntime {
  constructor(id) {
    this.id = id;
  }

  async send(_request) {
    throw new Error('AgentRuntime.send must be implemented');
  }

  async cancel(_taskId, _sessionId) {
    throw new Error('AgentRuntime.cancel must be implemented');
  }

  async resolvePermission(_request) {
    throw new Error('AgentRuntime.resolvePermission must be implemented');
  }

  subscribe(listener) {
    return window.meteoDesktop.onRuntimeEvent(listener);
  }
}

class GooseAcpRuntime extends AgentRuntime {
  constructor() {
    super('acp');
  }

  send(request) {
    return window.meteoDesktop.sendRuntimeMessage({
      ...request,
      preferredRuntime: 'acp',
    });
  }

  cancel(taskId, sessionId) {
    return window.meteoDesktop.cancelRuntimeTask({ taskId, sessionId });
  }

  resolvePermission(request) {
    return window.meteoDesktop.resolvePermission(request);
  }
}

class GooseHeadlessRuntime extends AgentRuntime {
  constructor() {
    super('headless');
  }

  send(request) {
    return window.meteoDesktop.sendRuntimeMessage({
      ...request,
      preferredRuntime: 'headless',
    });
  }

  cancel(taskId, sessionId) {
    return window.meteoDesktop.cancelRuntimeTask({ taskId, sessionId });
  }

  resolvePermission(request) {
    return window.meteoDesktop.resolvePermission(request);
  }
}

class RuntimeRouter {
  constructor() {
    this.status = {
      state: 'starting',
      preferred: 'acp',
      active: 'unknown',
      binaryAvailable: false,
      acpAvailable: false,
      headlessAvailable: false,
      error: null,
    };
    this.acp = new GooseAcpRuntime();
    this.headless = new GooseHeadlessRuntime();
  }

  updateStatus(status) {
    this.status = { ...this.status, ...status };
  }

  runtimeFor(task) {
    if (task?.runtimePreference === 'headless') return this.headless;
    if (this.status.acpAvailable) return this.acp;
    return this.headless;
  }

  send(task, request) {
    return this.runtimeFor(task).send(request);
  }

  cancel(task) {
    return this.runtimeFor(task).cancel(task.id, task.sessionId || null);
  }

  resolvePermission(task, permissionId, action) {
    return this.runtimeFor(task).resolvePermission({
      taskId: task.id,
      sessionId: task.sessionId || null,
      permissionId,
      action,
    });
  }

  subscribe(listener) {
    return window.meteoDesktop.onRuntimeEvent(listener);
  }
}

window.MeteoMateRuntime = Object.freeze({
  AgentRuntime,
  GooseAcpRuntime,
  GooseHeadlessRuntime,
  RuntimeRouter,
});
