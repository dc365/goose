'use strict';

const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');

const CONTRACT_KINDS = Object.freeze({
  QUERY: 'query',
  SOURCE_REGISTRY: 'sourceRegistry',
  RAW_DATASET: 'rawDataset',
  DATASET: 'dataset',
  PROVIDER_RESULT: 'providerResult',
  DIAGNOSIS_RESULT: 'diagnosisResult',
  GOLDEN_REPLAY: 'goldenReplay',
});

const ERROR_CODES = Object.freeze({
  INVALID: 'WEATHER_CONTRACT_INVALID',
  UNKNOWN_KIND: 'WEATHER_CONTRACT_UNKNOWN_KIND',
});

const SCHEMA_FILES = Object.freeze([
  'weather-query.schema.json',
  'weather-dataset.schema.json',
  'weather-source-registry.schema.json',
  'weather-provider-result.schema.json',
  'weather-diagnosis-result.schema.json',
  'weather-golden-replay.schema.json',
]);

class WeatherContractError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WeatherContractError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, WeatherContractError);
  }
}

function isRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  if (Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return false;
  if (zone !== 'Z') {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function loadSchemas() {
  const schemaDirectory = path.resolve(__dirname, '..', '..', 'schemas');
  return Object.fromEntries(SCHEMA_FILES.map((file) => {
    const schema = require(path.join(schemaDirectory, file));
    return [file, schema];
  }));
}

function createValidators() {
  const schemas = loadSchemas();
  const ajv = new Ajv2020({
    allErrors: false,
    allowUnionTypes: true,
    strict: true,
  });
  ajv.addFormat('date-time', {
    type: 'string',
    validate: isRfc3339,
  });
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);

  const datasetId = schemas['weather-dataset.schema.json'].$id;
  const bySchemaId = (file) => {
    const validator = ajv.getSchema(schemas[file].$id);
    if (!validator) throw new Error(`Weather schema did not compile: ${file}`);
    return validator;
  };
  return Object.freeze({
    [CONTRACT_KINDS.QUERY]: bySchemaId('weather-query.schema.json'),
    [CONTRACT_KINDS.SOURCE_REGISTRY]: bySchemaId('weather-source-registry.schema.json'),
    [CONTRACT_KINDS.RAW_DATASET]: ajv.compile({ $ref: `${datasetId}#/$defs/rawDataset` }),
    [CONTRACT_KINDS.DATASET]: ajv.compile({ $ref: `${datasetId}#/$defs/normalizedDataset` }),
    [CONTRACT_KINDS.PROVIDER_RESULT]: bySchemaId('weather-provider-result.schema.json'),
    [CONTRACT_KINDS.DIAGNOSIS_RESULT]: bySchemaId('weather-diagnosis-result.schema.json'),
    [CONTRACT_KINDS.GOLDEN_REPLAY]: bySchemaId('weather-golden-replay.schema.json'),
  });
}

const validators = createValidators();
const knownKinds = Object.freeze(Object.values(CONTRACT_KINDS));

function normalizedErrors(errors = []) {
  return errors.slice(0, 32).map((error) => ({
    instancePath: error.instancePath || '',
    schemaPath: error.schemaPath || '',
    keyword: error.keyword || 'validation',
    message: error.message || 'is invalid',
    params: JSON.parse(JSON.stringify(error.params || {})),
  }));
}

function validate(kind, value) {
  const validator = Object.hasOwn(validators, kind) ? validators[kind] : null;
  if (!validator) {
    const requestedKind = String(kind);
    return {
      valid: false,
      code: ERROR_CODES.UNKNOWN_KIND,
      errors: [{
        instancePath: '',
        schemaPath: '',
        keyword: 'kind',
        message: `must be one of: ${knownKinds.join(', ')}`,
        params: { kind: requestedKind, allowedKinds: [...knownKinds] },
      }],
    };
  }
  const valid = validator(value);
  return {
    valid: valid === true,
    code: valid === true ? null : ERROR_CODES.INVALID,
    errors: valid === true ? [] : normalizedErrors(validator.errors),
  };
}

function validationMessage(kind, result) {
  if (result.code === ERROR_CODES.UNKNOWN_KIND) {
    return `Unsupported weather contract kind: ${String(kind)}`;
  }
  const first = result.errors[0];
  const location = first?.instancePath || '$';
  return `Weather contract "${kind}" is invalid at ${location}: ${first?.message || 'validation failed'}`;
}

function validateOrThrow(kind, value) {
  const result = validate(kind, value);
  if (!result.valid) {
    throw new WeatherContractError(
      result.code,
      validationMessage(kind, result),
      { kind, errors: result.errors },
    );
  }
  return value;
}

module.exports = {
  CONTRACT_KINDS,
  ERROR_CODES,
  WeatherContractError,
  validate,
  validateOrThrow,
};
