import fs from 'node:fs';
import path from 'node:path';
import {
  type FieldSpec,
  ROOT,
  loadOntology,
  loadInstances,
} from '../scripts/lib/ontology';

const EXHIBITS_SRC_DIR = path.join(ROOT, 'exhibits');
const WEB_DIR = path.join(ROOT, 'web');
const VISOR_DIR = path.join(WEB_DIR, 'visor');
const APPS_DIR = path.join(VISOR_DIR, 'apps');
const OUT_DIR = path.join(WEB_DIR, 'dist');

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

interface ExhibitMeta {
  slug: string;
  title: string;
  location: string;
  source: string;
}

function loadExhibits(): ExhibitMeta[] {
  return loadInstances('Exhibit').map(i => {
    const { title, location, source } = i.data as { title?: string; location?: string; source?: string };
    if (!location) throw new Error(`${i.slug}: missing 'location'`);
    if (!source) throw new Error(`${i.slug}: missing 'source'`);
    return { slug: i.slug, title: title ?? '', location, source };
  });
}

interface OntologyTypeData {
  description?: string;
  fields: Record<string, FieldSpec>;
  identifiers?: string[];
  instances: { id: string; data: Record<string, unknown> }[];
}

// NOTE: not filtering by `visibility` yet — most instances are missing the field
// (defaults to private), and filtering now would leave the viewer empty. Wire up
// the filter once visibility is validated and set across the data.
function buildOntologyData(): { types: Record<string, OntologyTypeData> } {
  const { types } = loadOntology();
  const out: Record<string, OntologyTypeData> = {};
  for (const [name, spec] of Object.entries(types)) {
    out[name] = {
      description: spec.description,
      fields: spec.fields,
      identifiers: spec.identifiers,
      instances: loadInstances(name).map(({ slug, data }) => ({ id: slug, data })),
    };
  }
  return { types: out };
}

function outPathFor(location: string): string {
  if (!location.startsWith('/')) throw new Error(`location must start with '/': ${location}`);
  const segments = location.split('/').filter(Boolean);
  if (segments.some(s => s === '..' || s === '.')) throw new Error(`invalid location: ${location}`);
  return path.join(OUT_DIR, ...segments, 'index.html');
}

function resolveSource(source: string, slug: string): string {
  const resolved = path.resolve(EXHIBITS_SRC_DIR, source);
  const rel = path.relative(EXHIBITS_SRC_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${slug}: source '${source}' escapes exhibits/ root`);
  }
  return resolved;
}

function readSource(sourcePath: string, slug: string): string {
  try {
    return fs.readFileSync(sourcePath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${slug}: source not found at ${path.relative(ROOT, sourcePath)}`);
    }
    throw e;
  }
}

function renderNav(exhibits: ExhibitMeta[]): string {
  return exhibits
    .slice()
    .sort((a, b) => a.location.localeCompare(b.location))
    .map(e => `<li><a href="${escapeHtml(e.location)}">${escapeHtml(e.title || e.slug)}</a></li>`)
    .join('');
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`template var '{{${key}}}' missing`);
    return vars[key];
  });
}

function readApps(): string {
  let filenames: string[];
  try {
    filenames = fs.readdirSync(APPS_DIR);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw e;
  }
  return filenames
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => `// ---- apps/${f} ----\n${fs.readFileSync(path.join(APPS_DIR, f), 'utf8')}`)
    .join('\n');
}

// JSON inside <script>: prevent `</script>` in any string from breaking the page.
const safeJson = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, '\\u003c');

function build(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const exhibits = loadExhibits();
  if (exhibits.length === 0) {
    console.log(`no exhibits found in data/exhibits/`);
    return;
  }

  const shellTpl = fs.readFileSync(path.join(WEB_DIR, 'shell.html'), 'utf8');
  const visorTpl = fs.readFileSync(path.join(VISOR_DIR, 'visor.html'), 'utf8');
  const visorCss = fs.readFileSync(path.join(VISOR_DIR, 'visor.css'), 'utf8');
  const visorJs = fs.readFileSync(path.join(VISOR_DIR, 'visor.js'), 'utf8');
  const appsJs = readApps();
  const ontology = buildOntologyData();

  const fullScript = [
    visorJs,
    `synth.ontology = ${safeJson(ontology)};`,
    appsJs,
    `synth.start();`,
  ].join('\n');

  const visorHtml = fill(visorTpl, { nav: renderNav(exhibits) });

  const seen = new Map<string, string>();

  for (const ex of exhibits) {
    const collision = seen.get(ex.location);
    if (collision) throw new Error(`location collision at ${ex.location}: ${collision} and ${ex.slug}`);
    seen.set(ex.location, ex.slug);

    const sourcePath = resolveSource(ex.source, ex.slug);
    const exhibitHtml = readSource(sourcePath, ex.slug);

    const page = fill(shellTpl, {
      title: escapeHtml(ex.title),
      exhibit: exhibitHtml,
      visor: visorHtml,
      visor_css: visorCss,
      visor_js: fullScript,
    });

    const out = outPathFor(ex.location);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, page);
    console.log(`  ${ex.location.padEnd(20)} ← ${path.relative(ROOT, sourcePath)}`);
  }

  const instanceCount = Object.values(ontology.types).reduce((n, t) => n + t.instances.length, 0);
  console.log(`built ${exhibits.length} exhibit(s) → ${path.relative(process.cwd(), OUT_DIR)}/`);
  console.log(`ontology: ${Object.keys(ontology.types).length} types, ${instanceCount} instances`);
}

build();
