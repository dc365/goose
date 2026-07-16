'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EMPTY_REGISTRY = Object.freeze({
  apiVersion: 'meteomate.ai/v1',
  kind: 'CapabilityRegistry',
  version: 1,
  skills: [],
  connectors: [],
  updatedAt: null,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class JsonRegistry {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
  }

  load() {
    if (this.state) return this.state;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.state = {
        ...clone(EMPTY_REGISTRY),
        ...parsed,
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        connectors: Array.isArray(parsed.connectors) ? parsed.connectors : [],
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const recovery = `${this.filePath}.corrupt-${Date.now()}`;
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        try {
          fs.copyFileSync(this.filePath, recovery);
        } catch {
          // Keep a clean registry even if the corrupt file cannot be backed up.
        }
      }
      this.state = clone(EMPTY_REGISTRY);
    }
    return this.state;
  }

  snapshot() {
    return clone(this.load());
  }

  save() {
    const state = this.load();
    state.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
    return this.snapshot();
  }

  upsertSkill(record) {
    const state = this.load();
    const index = state.skills.findIndex((item) => item.id === record.id);
    if (index >= 0) state.skills[index] = { ...state.skills[index], ...clone(record) };
    else state.skills.unshift(clone(record));
    this.save();
    return clone(index >= 0 ? state.skills[index] : state.skills[0]);
  }

  removeSkill(id) {
    const state = this.load();
    const before = state.skills.length;
    state.skills = state.skills.filter((item) => item.id !== id);
    if (state.skills.length !== before) this.save();
    return state.skills.length !== before;
  }

  getSkill(id) {
    const item = this.load().skills.find((candidate) => candidate.id === id);
    return item ? clone(item) : null;
  }

  upsertConnector(record) {
    const state = this.load();
    const index = state.connectors.findIndex((item) => item.id === record.id);
    if (index >= 0) state.connectors[index] = { ...state.connectors[index], ...clone(record) };
    else state.connectors.unshift(clone(record));
    this.save();
    return clone(index >= 0 ? state.connectors[index] : state.connectors[0]);
  }

  removeConnector(id) {
    const state = this.load();
    const before = state.connectors.length;
    state.connectors = state.connectors.filter((item) => item.id !== id);
    if (state.connectors.length !== before) this.save();
    return state.connectors.length !== before;
  }

  getConnector(id) {
    const item = this.load().connectors.find((candidate) => candidate.id === id);
    return item ? clone(item) : null;
  }
}

module.exports = { JsonRegistry, EMPTY_REGISTRY };
