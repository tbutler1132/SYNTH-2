import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import matter from 'gray-matter';

export interface FieldSpec {
  type?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  items?: FieldSpec;
  ref?: string;
}

export interface TypeSpec {
  description?: string;
  fields: Record<string, FieldSpec>;
  identifiers?: string[];
  extends?: string;
  examples?: unknown;
}

export interface Ontology {
  meta?: unknown;
  types: Record<string, TypeSpec>;
}

export interface Instance {
  slug: string;
  data: Record<string, unknown>;
  file: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const ONTOLOGY_PATH = path.join(ROOT, 'ontology.yaml');

export function toFolderName(typeName: string): string {
  const snake = typeName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (/(s|x|sh|ch)$/.test(snake)) return snake + 'es';
  if (/[bcdfghjklmnpqrstvwxz]y$/.test(snake)) return snake.slice(0, -1) + 'ies';
  return snake + 's';
}

export function loadOntology(): Ontology {
  return yaml.load(fs.readFileSync(ONTOLOGY_PATH, 'utf8')) as Ontology;
}

export function loadInstances(typeName: string): Instance[] {
  const folder = path.join(DATA_DIR, toFolderName(typeName));
  let filenames: string[];
  try {
    filenames = fs.readdirSync(folder);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: Instance[] = [];
  for (const filename of filenames) {
    if (!filename.endsWith('.md')) continue;
    const slug = filename.slice(0, -3);
    const file = path.join(folder, filename);
    const { data } = matter(fs.readFileSync(file, 'utf8'));
    out.push({ slug, data: data as Record<string, unknown>, file });
  }
  return out;
}
