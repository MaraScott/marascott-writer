# OoaM Canon Workbench

Local-first Tamagui app for working with the flat-file OoaM canon.

## Data Model

- The canon folder is the OneDrive/GitHub-friendly flat-file directory.
- The app keeps a local working copy in the OS app-data folder.
- `Sync Down` copies all changed files from the canon folder into the working copy when safe.
- `Sync Up` uploads all changed working-copy files back to the canon folder when safe.
- Per-file selection is intentionally not part of sync.
- Conflicts are preserved as top-level conflict files instead of overwriting canon.

## Canon Folder Configuration

The app loads `.env` from the app root before starting the file service. Use this for the
flat-file canon directory:

```bash
OOAM_CANON_DIR=C:\Users\david\OneDrive\Pro\MaraScott-AI\Projects\O.o.a.M\OoaM_Canon
```

Resolution order:

- saved app config, when it exists and points to a valid folder;
- `OOAM_CANON_DIR` from `.env`;
- automatic discovery from common nearby `OoaM_Canon` locations.

You can change the canon folder in the app. The config panel shows whether the
folder exists, where the active path came from, and lets you open the canon
folder or the local working copy.

Optional:

```bash
OOAM_APP_DATA_DIR=C:\Users\david\AppData\Local
```

When omitted, the app uses the normal OS local app-data directory.

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

The dev server runs at:

```text
http://127.0.0.1:5177
```

## Generated Context

The app generates:

```text
ooam.context.full.md
ooam.context.digest.md
```

These files are generated exports for ChatGPT context. Source files remain the editable canon.

## Markdown Editor

The editor is split by platform:

```text
src/components/MarkdownEditor.web.tsx     CodeMirror editor for web/desktop
src/components/MarkdownEditor.native.tsx  React Native TextInput placeholder
```

The app imports `./components/MarkdownEditor`; Vite resolves that to the web
implementation. A future Expo app can resolve the native implementation using
React Native platform file resolution.

Timeline events include source line numbers. Click an event in the Timeline
panel to open its source Markdown file and jump directly to the event heading
for editing.

## Registry Indexing

The views are rebuilt by a JavaScript indexer. It scans the saved Markdown
files on demand with `Reindex`, and the app also refreshes the index every 30
seconds while it is open.

Add names directly from the Events, Characters, Locations, and Objects tabs.
The app stores those registry entries as headings in:

```text
events.md
characters.md
locations.md
objects.md
```

The index is case-insensitive. If `Daniel Stanford` is registered as a
character, `Daniel Stanford`, `daniel stanford`, and `DANIEL STANFORD` are
counted as occurrences in saved Markdown files.

Registry entries can include metadata directly below the heading:

```text
## Daniel Stanford
Aliases: Dan, Stanford
Description: Main point-of-view character
```

Aliases are indexed as additional occurrence names. Description is shown in the
views and included in the flat-file canon.

Timeline and Events are intentionally separate:

- Timeline is chronology, generated from headings like `## T0048 — Arrival`.
- Events are major plot beats, registered in the Events tab or as headings in
  `events.md`.
- Arcs are managed in `arcs.md`. An arc references timeline entries through an
  `Events:` metadata line:

```text
## Garden Fall
Description: The first collapse of Daniel's faith
Events: T0004, T0007, T0012
```

After saving a file, click `Reindex` or wait for the 30-second refresh. Select
an indexed character, location, object, or plot event to show its occurrence
panel. Click any occurrence to open the source Markdown file at the right line.
If no item is selected, the occurrence panel is hidden.

Registry-backed items can be renamed, removed, or moved to another category
from the selected item panel. Rename by editing the name field and leaving the
field; the item's markdown section body is kept. Move transfers that section to
the target registry file. Remove deletes that registry section from the working
copy.

## Canon Views

The right inspector has six views:

```text
Timeline    numbered events from timeline-style headings
Events      major plot events from the registry or events.md
Characters  saved character headings from characters.md
Locations   saved location headings from locations.md
Objects     saved object headings from objects.md
Arcs        saved arc headings from arcs.md with Events metadata
```

Timeline and Arc rows jump back to the source Markdown line for editing. Entity
rows select the registry item and reveal its occurrence panel. Explicit
`characters.md`, `locations.md`, `objects.md`, `events.md`, or `arcs.md` files
can be managed without changing the flat-file model.
