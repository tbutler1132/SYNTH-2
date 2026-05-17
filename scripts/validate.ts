import {
  type FieldSpec,
  type TypeSpec,
  type Instance,
  loadOntology,
  loadInstances,
  toFolderName,
} from './lib/ontology';

const PRIMITIVE_TYPES = new Set([
  'string', 'integer', 'float', 'boolean', 'date', 'datetime', 'duration', 'url',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

function loadAllInstances(types: Record<string, TypeSpec>): Record<string, Map<string, Instance>> {
  const out: Record<string, Map<string, Instance>> = {};
  for (const typeName of Object.keys(types)) {
    out[typeName] = new Map(loadInstances(typeName).map(i => [i.slug, i]));
  }
  return out;
}

function validateValue(
  value: unknown,
  spec: FieldSpec,
  types: Record<string, TypeSpec>,
  instances: Record<string, Map<string, Instance>>,
  errors: string[],
  ctx: string,
): void {
  if (spec.ref) {
    if (!types[spec.ref]) {
      errors.push(`${ctx}: ref target type '${spec.ref}' is not defined in ontology`);
      return;
    }
    if (typeof value !== 'string') {
      errors.push(`${ctx}: expected slug (string) referencing ${spec.ref}, got ${typeof value}`);
      return;
    }
    if (!instances[spec.ref].has(value)) {
      errors.push(`${ctx}: ref ${spec.ref}:${value} not found in data/${toFolderName(spec.ref)}/`);
    }
    return;
  }

  switch (spec.type) {
    case 'string':
    case 'url':
      if (typeof value !== 'string') errors.push(`${ctx}: expected ${spec.type}, got ${typeof value}`);
      break;
    case 'date':
      if (value instanceof Date) break;
      if (typeof value !== 'string' || !ISO_DATE.test(value)) {
        errors.push(`${ctx}: expected ISO date (YYYY-MM-DD), got ${JSON.stringify(value)}`);
      }
      break;
    case 'datetime':
      if (value instanceof Date) break;
      if (typeof value !== 'string' || !ISO_DATETIME.test(value)) {
        errors.push(`${ctx}: expected ISO datetime, got ${JSON.stringify(value)}`);
      }
      break;
    case 'duration':
      if (typeof value !== 'string' || !ISO_DURATION.test(value)) {
        errors.push(`${ctx}: expected ISO 8601 duration (e.g. PT3M42S), got ${JSON.stringify(value)}`);
      }
      break;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${ctx}: expected integer, got ${JSON.stringify(value)}`);
      break;
    case 'float':
      if (typeof value !== 'number') errors.push(`${ctx}: expected float, got ${JSON.stringify(value)}`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${ctx}: expected boolean, got ${JSON.stringify(value)}`);
      break;
    case 'list':
      if (!Array.isArray(value)) {
        errors.push(`${ctx}: expected list, got ${typeof value}`);
        return;
      }
      if (spec.items) {
        value.forEach((v, i) => validateValue(v, spec.items!, types, instances, errors, `${ctx}[${i}]`));
      }
      break;
    case 'map':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${ctx}: expected map, got ${Array.isArray(value) ? 'list' : typeof value}`);
      }
      break;
    case undefined:
      break;
    default:
      if (!PRIMITIVE_TYPES.has(spec.type)) {
        errors.push(`${ctx}: unknown type '${spec.type}' in ontology`);
      }
  }

  if (spec.enum && !spec.enum.includes(value)) {
    errors.push(`${ctx}: ${JSON.stringify(value)} not in enum ${JSON.stringify(spec.enum)}`);
  }
}

function validate(): void {
  const ontology = loadOntology();
  const types = ontology.types;
  const instances = loadAllInstances(types);
  const errors: string[] = [];
  let instanceCount = 0;

  for (const [typeName, spec] of Object.entries(types)) {
    const typeInstances = instances[typeName];
    instanceCount += typeInstances.size;

    if (spec.identifiers?.length) {
      const seen = new Map<string, string>();
      for (const [slug, inst] of typeInstances) {
        const present = spec.identifiers.every(f => inst.data[f] !== undefined && inst.data[f] !== null);
        if (!present) continue;
        const key = spec.identifiers.map(f => JSON.stringify(inst.data[f])).join('|');
        const existing = seen.get(key);
        if (existing) {
          errors.push(`${typeName}/${slug}: duplicate identifier (${spec.identifiers.join(',')}) — also in ${typeName}/${existing}`);
        } else {
          seen.set(key, slug);
        }
      }
    }

    for (const [slug, inst] of typeInstances) {
      const ctxBase = `${typeName}/${slug}`;

      for (const [fieldName, fieldSpec] of Object.entries(spec.fields)) {
        if (fieldSpec.required && (inst.data[fieldName] === undefined || inst.data[fieldName] === null)) {
          errors.push(`${ctxBase}.${fieldName}: required field missing`);
        }
      }

      for (const [fieldName, value] of Object.entries(inst.data)) {
        if (fieldName === 'id') continue;
        if (value === undefined || value === null) continue;
        const fieldSpec = spec.fields[fieldName];
        if (!fieldSpec) {
          errors.push(`${ctxBase}.${fieldName}: unknown field (not declared in ontology for ${typeName})`);
          continue;
        }
        validateValue(value, fieldSpec, types, instances, errors, `${ctxBase}.${fieldName}`);
      }
    }
  }

  const typeCount = Object.keys(types).length;
  if (errors.length === 0) {
    console.log(`OK — validated ${instanceCount} instance(s) across ${typeCount} type(s)`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
}

validate();
