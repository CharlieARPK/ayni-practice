// Canonical Ayni 1.0 format. Import validation and the downloadable JSON
// Schema are both derived from this object.
export const ROLE_VALUES = ['front', 'back', 'both', 'unknown'];
export const NAVIGATION_TYPES = ['segno', 'coda', 'toCoda', 'dalSegno', 'daCapo', 'fine', 'repeat', 'ending'];
const timeSignature = {
  type: 'object', additionalProperties: false, required: ['numerator', 'denominator'],
  properties: {
    numerator: { type: 'integer', minimum: 1, maximum: 32 },
    denominator: { type: 'integer', enum: [1, 2, 4, 8, 16, 32] }
  }
};
const baseEvent = {
  duration: { type: 'number', exclusiveMinimum: 0 },
  needsReview: { type: 'boolean' }
};
export const SONG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:ayni:song:1.0',
  title: 'Ayni SongData 1.0', type: 'object', additionalProperties: true,
  required: ['formatVersion', 'title', 'bpm', 'part', 'key', 'defaultTimeSignature', 'markers', 'navigation', 'measures'],
  properties: {
    formatVersion: { const: '1.0' },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    bpm: { type: 'number', minimum: 30, maximum: 240 },
    part: {
      type: 'object', additionalProperties: true, required: ['id', 'name', 'instrument'],
      properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, instrument: { type: 'string', minLength: 1 } }
    },
    key: { type: 'string' }, defaultTimeSignature: timeSignature,
    markers: { type: 'array', items: { type: 'object', required: ['measure', 'label'], properties: { measure: { type: 'integer', minimum: 1 }, label: { type: 'string' } } } },
    navigation: {
      type: 'array', items: {
        type: 'object', additionalProperties: true, required: ['type'],
        allOf: [{ oneOf: NAVIGATION_TYPES.map(type => ({ type: 'object', required: type === 'repeat' ? ['type','startMeasure','endMeasure'] : type === 'ending' ? ['type','startMeasure','endMeasure','number'] : ['type','measure'], properties: { type: { const: type } } })) }],
        properties: {
          type: { enum: NAVIGATION_TYPES }, measure: { type: 'integer', minimum: 1 },
          startMeasure: { type: 'integer', minimum: 1 }, endMeasure: { type: 'integer', minimum: 1 },
          number: { type: 'integer', minimum: 1, maximum: 16 }, times: { type: 'integer', minimum: 2, maximum: 16 },
          id: { type: 'string' }, target: { type: 'string' }, mode: { enum: ['alCoda', 'alFine', 'end'] }, needsReview: { type: 'boolean' }
        }
      }
    },
    measures: {
      type: 'array', minItems: 1, maxItems: 5000, items: {
        type: 'object', additionalProperties: true, required: ['number', 'timeSignature', 'events', 'needsReview'],
        properties: {
          number: { type: 'integer', minimum: 1 }, timeSignature: { anyOf: [{ type: 'null' }, timeSignature] },
          beats: { type: 'number', exclusiveMinimum: 0 }, section: { anyOf: [{ type: 'null' }, { type: 'string' }] },
          needsReview: { type: 'boolean' },
          events: { type: 'array', maxItems: 10000, items: {
            oneOf: [
              { type: 'object', additionalProperties: true, required: ['type', 'pitch', 'duration', 'role', 'needsReview'], properties: { type: { const: 'note' }, pitch: { type: 'string', pattern: '^[A-G][#b]?(-1|[0-9])$' }, role: { enum: ROLE_VALUES }, ...baseEvent } },
              { type: 'object', additionalProperties: true, required: ['type', 'duration', 'needsReview'], properties: { type: { const: 'rest' }, ...baseEvent } }
            ]
          } }
        }
      }
    }
  }
};

function isType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

// Small JSON Schema 2020-12 evaluator for the keywords used above. Keeping it
// here guarantees browser validation and the published schema cannot drift.
export function validateAgainstSchema(value, schema = SONG_SCHEMA, path = '$') {
  if (schema.anyOf) {
    if (!schema.anyOf.some(candidate => validateAgainstSchema(value, candidate, path).length === 0)) return [`${path}: 許可された形式ではありません。`];
    return [];
  }
  if (schema.oneOf) {
    if (schema.oneOf.filter(candidate => validateAgainstSchema(value, candidate, path).length === 0).length !== 1) {
      const match = schema.oneOf.find(candidate => candidate.properties?.type?.const === value?.type);
      return match ? validateAgainstSchema(value, match, path) : [`${path}: typeまたは必須項目が正しくありません。`];
    }
    return [];
  }
  const errors = [];
  for (const candidate of schema.allOf ?? []) errors.push(...validateAgainstSchema(value, candidate, path));
  if (schema.type && !isType(value, schema.type)) return [`${path}: ${schema.type}で指定してください。`];
  if ('const' in schema && value !== schema.const) errors.push(`${path}: ${JSON.stringify(schema.const)}を指定してください。`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${schema.enum.join('/')}のいずれかを指定してください。`);
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${path}: 空にできません。`);
    if (schema.maxLength && value.length > schema.maxLength) errors.push(`${path}: ${schema.maxLength}文字以下にしてください。`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) errors.push(`${path}: 形式が正しくありません。`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${schema.minimum}以上にしてください。`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${schema.maximum}以下にしてください。`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: ${schema.exclusiveMinimum}より大きくしてください。`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${path}: 1件以上必要です。`);
    if (schema.maxItems && value.length > schema.maxItems) errors.push(`${path}: ${schema.maxItems}件以下にしてください。`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) errors.push(`${path}.${key}: 許可されていない項目です。`);
    for (const required of schema.required ?? []) if (!(required in value)) errors.push(`${path}.${required}: 必須項目です。`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) errors.push(...validateAgainstSchema(value[key], child, `${path}.${key}`));
  }
  return errors;
}
