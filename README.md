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
