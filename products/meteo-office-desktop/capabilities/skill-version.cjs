'use strict';

function parseVersion(value) {
  const [core, prerelease = ''] = String(value || '0.0.0').trim().replace(/^v/i, '').split('-', 2);
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return { numbers, prerelease };
}

function compareSkillVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.numbers.length, b.numbers.length, 3);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] || 0) - (b.numbers[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

module.exports = { compareSkillVersions };
