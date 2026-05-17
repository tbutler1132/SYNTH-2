import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets', 'AbletonProject');
const PROJECTS_DIR = path.join(ROOT, 'data', 'ableton_projects');

// Fields this script owns and overwrites on every run.
// Everything else (parent, songs, notes, key, etc.) is user-owned and preserved.
const AUTO_FIELDS = [
  'name', 'file_path', 'bpm', 'time_signature',
  'ableton_version', 'modified_at', 'plugins',
] as const;

interface ExtractedProject {
  name: string;
  file_path: string;
  bpm?: number;
  time_signature?: string;
  ableton_version?: string;
  modified_at: string;
  plugins: string[];
}

interface AlsFile {
  path: string;
  slug: string;
  folder: string;
  birthtime: Date;
  mtime: Date;
}

// Heuristic: parent = the .als in the same folder with the most recent birthtime
// older than this one. Matches the linear save-as workflow (A → B → C, each from
// the prior). Breaks only if you save-as from a non-latest file in the folder —
// in which case set parent by hand in the .md. Forks to a new folder have no
// candidate and stay empty.
function inferParent(file: AlsFile, all: AlsFile[]): string | null {
  const candidates = all.filter(f =>
    f.folder === file.folder &&
    f.path !== file.path &&
    f.birthtime < file.birthtime
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.birthtime.getTime() - a.birthtime.getTime());
  return candidates[0].slug;
}

function walkAlsFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      // Skip Ableton's auto-backup directories — they contain stale snapshots
      // that shouldn't be ingested as their own projects.
      if (entry.isDirectory() && entry.name === 'Backup') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.als')) out.push(full);
    }
  };
  visit(root);
  return out;
}

function decodeTimeSignature(value: number): string {
  // Ableton encodes time sig as a single int: numerator = (v % 99) + 1,
  // denominator_index = floor(v / 99) where index 0->1, 1->2, 2->4, 3->8, 4->16, 5->32
  const numerator = (value % 99) + 1;
  const denominators = [1, 2, 4, 8, 16, 32];
  const denominator = denominators[Math.floor(value / 99)] ?? 4;
  return `${numerator}/${denominator}`;
}

function extract(xml: string, alsPath: string, mtime: Date): ExtractedProject {
  const name = path.basename(alsPath, '.als');

  // BPM lives in the MasterTrack mixer's <Tempo>. The first <Tempo> tag in the file
  // is the master tempo; per-clip tempos use different tags.
  const tempoMatch = xml.match(/<Tempo>[\s\S]*?<Manual Value="([\d.]+)"\s*\/>/);
  const bpm = tempoMatch ? parseFloat(parseFloat(tempoMatch[1]).toFixed(3)) : undefined;

  // The master <TimeSignature> with a <Manual Value="N"/> child sits right after <Tempo>.
  // Clip-level <TimeSignature> blocks use <TimeSignatures>/<RemoteableTimeSignature> instead,
  // so matching <Manual Value="N"/> as a direct child filters to the project-level one.
  const tsMatch = xml.match(/<TimeSignature>\s*<LomId[^/]*\/>\s*<Manual Value="(\d+)"/);
  const time_signature = tsMatch ? decodeTimeSignature(parseInt(tsMatch[1], 10)) : undefined;

  const creatorMatch = xml.match(/Creator="Ableton Live ([^"]+)"/);
  const ableton_version = creatorMatch ? creatorMatch[1] : undefined;

  const plugins = extractPlugins(xml);

  return {
    name,
    file_path: alsPath,
    bpm,
    time_signature,
    ableton_version,
    modified_at: mtime.toISOString().replace(/\.\d+Z$/, 'Z'),
    plugins,
  };
}

function extractPlugins(xml: string): string[] {
  const seen = new Set<string>();
  const infoRegex = /<(Vst3?PluginInfo|AuPluginInfo)\s+Id="0">([\s\S]*?)<\/\1>/g;
  for (const m of xml.matchAll(infoRegex)) {
    const body = m[2];
    // The plugin display name is a direct child <Name Value="X"/> of the PluginInfo block.
    // Nested <Name> tags (presets, programs) appear deeper — we want the first one that
    // isn't empty and isn't a numeric placeholder.
    const nameMatch = body.match(/<Name Value="([^"]+)"\s*\/>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    if (!name || /^\d+$/.test(name)) continue;
    seen.add(name);
  }
  return [...seen].sort();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function writeYamlFrontmatter(data: Record<string, unknown>, body = ''): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    clean[k] = v;
  }
  const yml = yaml.dump(clean, { lineWidth: 100, noRefs: true, sortKeys: false });
  return `---\n${yml}---\n${body}`;
}

function upsertAbletonProject(
  slug: string,
  extracted: ExtractedProject,
  parentCandidate: string | null,
): { created: boolean; parentSet: boolean } {
  const filepath = path.join(PROJECTS_DIR, `${slug}.md`);
  let existing: Record<string, unknown> = {};
  let body = '';
  let created = true;
  if (fs.existsSync(filepath)) {
    created = false;
    const parsed = matter(fs.readFileSync(filepath, 'utf8'));
    existing = parsed.data;
    body = parsed.content.replace(/^\n+/, '');
  }

  for (const f of AUTO_FIELDS) {
    delete existing[f];
  }

  // Only infer parent on first creation. Once the .md exists, parent is user-owned
  // and we never touch it — manual overrides are safe across reruns.
  const parentSet = created && parentCandidate !== null && existing.parent === undefined;
  if (parentSet) {
    existing = { parent: parentCandidate, ...existing };
  }

  const merged: Record<string, unknown> = {
    name: extracted.name,
    file_path: extracted.file_path,
    ...(extracted.bpm !== undefined && { bpm: extracted.bpm }),
    ...(extracted.time_signature && { time_signature: extracted.time_signature }),
    ...(extracted.ableton_version && { ableton_version: extracted.ableton_version }),
    modified_at: extracted.modified_at,
    ...(extracted.plugins.length > 0 && { plugins: extracted.plugins }),
    ...existing,
  };

  fs.writeFileSync(filepath, writeYamlFrontmatter(merged, body));
  return { created, parentSet };
}

function main(): void {
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`Assets dir not found: ${ASSETS_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });

  const alsPaths = walkAlsFiles(ASSETS_DIR);
  if (alsPaths.length === 0) {
    console.log('No .als files found.');
    return;
  }

  // Build the index up front so parent inference can see all siblings at once.
  const alsFiles: AlsFile[] = alsPaths.map(p => {
    const stat = fs.statSync(p);
    return {
      path: p,
      slug: slugify(path.basename(p, '.als')),
      folder: path.dirname(p),
      birthtime: stat.birthtime,
      mtime: stat.mtime,
    };
  });

  // Two .als files anywhere in the tree with the same basename would map to the
  // same AbletonProject .md. Warn instead of silently overwriting.
  const slugSources = new Map<string, string[]>();
  for (const f of alsFiles) {
    const arr = slugSources.get(f.slug) ?? [];
    arr.push(f.path);
    slugSources.set(f.slug, arr);
  }
  for (const [slug, sources] of slugSources) {
    if (sources.length > 1) {
      console.warn(`  ! slug collision "${slug}":`);
      for (const s of sources) console.warn(`      ${s}`);
    }
  }

  let projectsCreated = 0, projectsUpdated = 0;

  for (const file of alsFiles) {
    const compressed = fs.readFileSync(file.path);
    const xml = zlib.gunzipSync(compressed).toString('utf8');
    const extracted = extract(xml, file.path, file.mtime);

    const parentCandidate = inferParent(file, alsFiles);
    const res = upsertAbletonProject(file.slug, extracted, parentCandidate);
    if (res.created) projectsCreated++; else projectsUpdated++;

    const plugSummary = extracted.plugins.length > 0
      ? ` plugins=${extracted.plugins.length}`
      : '';
    const parentTag = res.parentSet ? ` parent=${parentCandidate}` : '';
    console.log(
      `  ${res.created ? '+' : '~'} ${file.slug}` +
      ` (bpm=${extracted.bpm ?? '?'} ts=${extracted.time_signature ?? '?'}${plugSummary}${parentTag})`
    );
  }

  console.log(
    `\nAbletonProject: ${projectsCreated} created, ${projectsUpdated} updated` +
    `\n\nNote: parent is inferred once on creation from sibling .als birthtimes.` +
    ` After that, parent and other non-extracted fields are preserved — edit by hand if needed.`
  );
}

main();
