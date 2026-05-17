# SYNTH-2

A personal ontology + datastore for music production. Types are defined in `ontology.yaml`; instances live as markdown files with YAML frontmatter in `data/<type_plural>/`.

## AbletonProject versioning

An `AbletonProject` can have a `parent` (another `AbletonProject` it was forked from) and a `branch` label, so different versions of the same underlying song each live as their own record without losing the lineage between them. A third optional field, `version_label`, is a hand-authored short tag (e.g. `"pre-master"`, `"v2"`) for distinguishing versions within a branch.

### Convention

- A project with no suffix (e.g. `anyone`) is the **canonical / main** version. It has `branch: main` and no `parent`.
- A project named `<song>-<branch>` (e.g. `anyone-album-1`) is a **branch** off the canonical version. It has `parent: <song>` and `branch: <branch>`.

The only branch pattern currently recognized by tooling is `-album-<N>`, which produces `branch: album-N`. Other branches can be created by hand-editing the frontmatter — the ontology accepts any string for `branch`.

### Adding a new branch

1. Duplicate the source project folder under `assets/AbletonProject/`, naming the copy `<Song>-<Branch> Project` (e.g. `Anyone-Album-2 Project`).
2. Rename the `.als` inside the new folder to match (e.g. `Anyone-Album-2.als`). Samples, backup, and other subfolders come along for free.
3. Run `npm run import:ableton`. The script extracts metadata from the `.als` and writes a new `data/ableton_projects/<slug>.md` with `parent` and `branch` derived from the folder name.

To create a new canonical/main for a song you only have branches of, drop a folder without any `-Album-N` suffix (e.g. `Anyone Project` with `Anyone.als` inside) and re-run the importer.

### Scripts

- `npm run import:ableton` — scans `assets/AbletonProject/`, extracts tempo / time signature / Ableton version / plugins from each `.als`, and upserts records in `data/ableton_projects/` and `data/songs/`. Auto-managed fields (`name`, `file_path`, `parent`, `branch`, `bpm`, `time_signature`, `ableton_version`, `modified_at`, `plugins`) are overwritten on each run; hand-authored fields (`notes`, `key`, `version_label`, etc.) are preserved.
- `npm run validate` — checks every instance against `ontology.yaml`: required fields, types, ref existence, identifier uniqueness, and no unknown fields.
