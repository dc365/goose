'use strict';

const MODES = Object.freeze({
  INTERNAL: 'internal',
  STRICT: 'strict',
});

function normalizeSecurityMode(value = process.env.METEOMATE_SECURITY_MODE) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['strict', 'secure', 'hardened', 'zero-trust', 'zero_trust'].includes(normalized)) return MODES.STRICT;
  if (['', 'internal', 'intranet', 'trusted-internal'].includes(normalized)) return MODES.INTERNAL;
  throw new Error(`未知的安全模式：${normalized}`);
}

function isStrictSecurityMode(value) {
  return normalizeSecurityMode(value) === MODES.STRICT;
}

function securityModeState(value = process.env.METEOMATE_SECURITY_MODE) {
  const mode = normalizeSecurityMode(value);
  return {
    mode,
    strict: mode === MODES.STRICT,
    internal: mode === MODES.INTERNAL,
    description: mode === MODES.STRICT
      ? '严格安全模式：启用系统安全存储、工作区边界和网络主机策略。'
      : '内网业务模式：允许 HTTP、本机路径和本地配置凭据，减少审批与系统安全验证。',
  };
}

module.exports = {
  MODES,
  normalizeSecurityMode,
  isStrictSecurityMode,
  securityModeState,
};
