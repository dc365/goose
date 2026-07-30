'use strict';

const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const QcPolicy = require('../harness/qc-policy');

const CONTRACT_KINDS = Object.freeze({
  SIGNOFF: 'PublicationSignoff',
  QC_WAIVER: 'EvidenceQcWaiver',
});

const schemaDirectory = path.resolve(__dirname, '..', 'schemas');
const schemas = Object.freeze({
  [CONTRACT_KINDS.SIGNOFF]: require(path.join(schemaDirectory, 'publication-signoff.schema.json')),
  [CONTRACT_KINDS.QC_WAIVER]: require(path.join(schemaDirectory, 'evidence-qc-waiver.schema.json')),
});

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
});
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => QcPolicy.rfc3339Timestamp(value) != null,
});

const validators = Object.freeze(Object.fromEntries(
  Object.entries(schemas).map(([kind, schema]) => [kind, ajv.compile(schema)])
));

function normalizedErrors(errors = []) {
  return errors.slice(0, 32).map((error) => ({
    instancePath: error.instancePath || '',
    keyword: error.keyword || 'validation',
    message: error.message || 'is invalid',
  }));
}

function validate(kind, value) {
  const validator = validators[kind];
  if (!validator) {
    return {
      valid: false,
      errors: [{ instancePath: '', keyword: 'kind', message: `unsupported contract kind ${kind}` }],
    };
  }
  const schemaValid = validator(value) === true;
  const errors = schemaValid ? [] : normalizedErrors(validator.errors);
  if (schemaValid && kind === CONTRACT_KINDS.QC_WAIVER) {
    errors.push(...QcPolicy.validateWaiver(value).errors.map((message) => ({
      instancePath: '',
      keyword: 'policy',
      message,
    })));
  }
  return { valid: errors.length === 0, errors };
}

function validateOrThrow(kind, value) {
  const result = validate(kind, value);
  if (!result.valid) {
    const first = result.errors[0];
    throw new Error(
      `发布审计契约 ${kind} 无效${first.instancePath ? ` (${first.instancePath})` : ''}：${first.message}`
    );
  }
  return value;
}

module.exports = {
  CONTRACT_KINDS,
  validate,
  validateOrThrow,
};
