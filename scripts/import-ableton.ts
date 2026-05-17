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
const SONGS_DIR = path.join(ROOT, 'data', 'songs');

// Fields on AbletonProject that this script owns and will overwrite on every run.
// Any other frontmatter keys (e.g. notes, songs, key, version_label) are preserved across runs.
const AUTO_FIELDS = [
  'name', 'file_path', 'parent', 'branch', 'bpm', 'time_signature',
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

function findPrimaryAls(projectDir: string): string | null {
  const entries = fs.readdirSync(projectDir, { withFileTypes: true });
  const candidates = entries
    .filter(e => e.isFile() && e.name.endsWith('.als') && !e.name.startsWith('.'))
    .map(e => path.join(projectDir, e.name));
  if (candidates.length === 0) return null;
  // Prefer the largest (live set is bigger than empty stubs)
  candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return candidates[0];
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

// Split a project slug into its base (canonical song slug) and branch label.
// `anyone-album-1` → { base: "anyone", branch: "album-1" }
// `anyone`         → { base: "anyone", branch: "main" }
function parseBranch(slug: string): { base: string; branch: string } {
  const m = slug.match(/^(.*)-album-(\d+)$/);
  if (m) return { base: m[1], branch: `album-${m[2]}` };
  return { base: slug, branch: 'main' };
}

function songTitleFrom(projectName: string): string {
  // Strip a trailing "-Album-N" if present, then turn dashes into spaces.
  const stripped = projectName.replace(/-Album-\d+$/i, '');
  return stripped.replace(/-/g, ' ').trim();
}

function writeYamlFrontmatter(data: Record<string, unknown>, body = ''): string {
  // Preserve key order; strip undefined/null/empty arrays.
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
  songSlug: string,
  branch: string,
  parent: string | null,
): { created: boolean } {
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

  const merged: Record<string, unknown> = {
    name: extracted.name,
    file_path: extracted.file_path,
    ...(parent && { parent }),
    branch,
    ...(extracted.bpm !== undefined && { bpm: extracted.bpm }),
    ...(extracted.time_signature && { time_signature: extracted.time_signature }),
    ...(extracted.ableton_version && { ableton_version: extracted.ableton_version }),
    modified_at: extracted.modified_at,
    ...(extracted.plugins.length > 0 && { plugins: extracted.plugins }),
    ...existing,
  };

  const existingSongs = Array.isArray(existing.songs) ? (existing.songs as string[]) : [];
  if (!existingSongs.includes(songSlug)) {
    merged.songs = [...existingSongs, songSlug];
  }

  fs.writeFileSync(filepath, writeYamlFrontmatter(merged, body));
  return { created };
}

function ensureSongStub(slug: string, title: string): { created: boolean } {
  const filepath = path.join(SONGS_DIR, `${slug}.md`);
  if (fs.existsSync(filepath)) return { created: false };
  fs.writeFileSync(filepath, writeYamlFrontmatter({ title }));
  return { created: true };
}

function main(): void {
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`Assets dir not found: ${ASSETS_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(SONGS_DIR, { recursive: true });

  const projectDirs = fs.readdirSync(ASSETS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(ASSETS_DIR, e.name));

  let projectsCreated = 0, projectsUpdated = 0, songsCreated = 0, songsSkipped = 0;

  for (const dir of projectDirs) {
    const alsPath = findPrimaryAls(dir);
    if (!alsPath) {
      console.warn(`  skip ${path.basename(dir)} — no .als file`);
      continue;
    }
    const compressed = fs.readFileSync(alsPath);
    const xml = zlib.gunzipSync(compressed).toString('utf8');
    const stat = fs.statSync(alsPath);
    const extracted = extract(xml, alsPath, stat.mtime);

    const projectSlug = slugify(extracted.name);
    const { base, branch } = parseBranch(projectSlug);
    const songSlug = base;
    const parent = branch === 'main' ? null : base;
    const songTitle = songTitleFrom(extracted.name);

    const songRes = ensureSongStub(songSlug, songTitle);
    if (songRes.created) songsCreated++; else songsSkipped++;

    const projRes = upsertAbletonProject(projectSlug, extracted, songSlug, branch, parent);
    if (projRes.created) projectsCreated++; else projectsUpdated++;

    const plugSummary = extracted.plugins.length > 0
      ? ` plugins=${extracted.plugins.length}`
      : '';
    const branchTag = branch === 'main' ? '' : ` [${branch}]`;
    console.log(
      `  ${projRes.created ? '+' : '~'} ${projectSlug}${branchTag}` +
      ` (bpm=${extracted.bpm ?? '?'} ts=${extracted.time_signature ?? '?'}${plugSummary})`
    );
  }

  console.log(
    `\nAbletonProject: ${projectsCreated} created, ${projectsUpdated} updated` +
    `\nSong stubs: ${songsCreated} created, ${songsSkipped} already existed` +
    `\n\nAlbum stubs were NOT auto-created — album-to-song mapping is a creative call.` +
    ` Add Albums and AlbumTracks by hand in data/albums/ and data/album_tracks/.`
  );
}

main();
