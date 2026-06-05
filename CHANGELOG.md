# Changelog

All notable changes to Mermaid Toolkit for Google Docs™ are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.2.0] — 2026-06-04

**Large diagrams that survive export, sharper images, and steadier dialogs.**

### Changed

- **HTML labels in diagrams are enabled** in the Mermaid render configuration (flowcharts and related diagram types), so labels can use rich formatting where Mermaid supports it.
- **Server-side add-on code is split into focused modules** (`Code.ts` menu and public entrypoints, diagram operations, doc scanning, dialog helpers) for easier maintenance; behavior for menus and dialogs is unchanged.

### Fixed

- **Large diagram source no longer truncates on export or edit.** Google Docs caps image alt-text at about 5,000 encoded characters, so a long Mermaid definition no longer fits there. When that happens, the add-on stores the full source in this document's hidden properties and keeps a short pointer on the image. **Export as Markdown** and **Edit Diagram** recover the complete source, so import → export → re-import round trips stay lossless. This uses the existing `documents.currentonly` scope — no new permissions.
- **Large diagrams insert within Google Docs' image size limit.** Google Docs limits the longest side of an inserted image to about 5,000 pixels, so a full-resolution Mermaid PNG can exceed what Docs accepts. The add-on renders and downscales to that cap so the diagram still inserts, with wider/shorter flowchart layout and a higher-resolution raster pass so detail holds up better under the cap; the full Mermaid definition stays on the image or in this document's hidden properties when alt-text is too short, so **Edit Diagram** and **Export as Markdown** are unchanged.
- **Mermaid in native Google Docs Code blocks converts correctly.** Google Workspace enterprise / paid **Code block** building blocks (Insert → Building blocks → Code block) were ignored by **Convert All Code to Diagrams** and **Convert Selected Code to Diagram**, which only handled plain fenced text and the add-on's code-styled tables. Those converters now read Mermaid from `CODE_SNIPPET` blocks the same way.
- **Dialogs no longer get stuck on "Loading libraries…".** A script that the Apps Script HTML iframe refused to parse could leave a dialog hanging. Dialog bundles are now downleveled for that iframe, injected source is escaped so it can't break out of its `<script>` tag, and a boot-time handler surfaces the underlying error instead of failing silently.
- **Insert-limit notices read as warnings, not errors.** When a diagram is downscaled for Google Docs' 5,000px image cap (or similar limits), dialogs show amber warning styling instead of the red error bar; footer status text still turns red for real failures.

## [v1.1.1] — 2026-05-04

**Faster dialogs, better editor ergonomics, better-fitting diagram images.**

### Added

- **Line numbers** in Mermaid source editors, markdown import/export, and markdown repair dialogs, including soft-wrap alignment and refreshes after template or paste-driven source changes.
- **Slow-operation toasts** for large import, export, and bulk conversion jobs, with links to the relevant limitation notes.

### Changed

- **Inserted and replaced diagrams are selected automatically** where Google Docs permits it, so follow-up actions like editing the inserted diagram require fewer clicks.
- **Dialogs load Mermaid and Markdown libraries more efficiently.** Shared loaders cache CDN scripts, lazy-load where possible, and render larger batches incrementally.
- **Bulk conversion dialogs scan the document after opening** so the UI can appear earlier instead of waiting on server-side scanning before the dialog is shown.
- **Import from Markdown replacement** is faster for full-document imports.
- **Export as Markdown** performs fewer per-run `DocumentApp` attribute calls.
- **Dialog code now uses published client-side Apps Script typings** via `@types/google.script.client-side`.
- **Demo recording scripts and media** were refreshed for the latest dialog behavior and UI.

### Fixed

- **Diagram images fit the current page content area** using document margins, with height capping for tall diagrams.

## [v1.1.0] — 2026-04-22

**Text-based checkboxes, narrower OAuth scope.**

### Why this release exists

The Google Apps Script `DocumentApp` API — the API available to Google Workspace™ add-ons — has no method for creating native Google Docs™ checkbox glyphs. There is no `createChecklist()`, no `setGlyphType(GlyphType.CHECKBOX)`, nothing. The only supported path is a REST API call (`Docs.Documents.batchUpdate` with a `BULLET_CHECKBOX` preset) through the Docs Advanced Service.

v1.0.0 bridged this gap by enabling the Advanced Service, which in turn required the broader `documents` OAuth scope. That scope gives an application continuous, offline access to every Google Docs™ file the user owns — far more than this add-on ever needed.

Google's OAuth verification team declined to approve the `documents` scope for this add-on. `documents` grants continuous, offline access to every Google Docs™ file the user owns, and this add-on genuinely doesn't need that breadth — it only operates on the document the user has open and only while a dialog is live. We ended up requesting the broad scope as a package deal: the Docs Advanced Service (our only supported path to native checkbox creation and batched document edits) requires it, and _we_ required the Advanced Service. Under Google's minimum-scope policy, "an API I depend on requires this scope" isn't, on its own, sufficient justification — the burden is on the app to find a narrower path, even if that means giving up functionality.

v1.1.0 gives up that functionality. It removes the Advanced Service dependency entirely and replaces native checkboxes (and code blocks) with a plain-text `[ ] ` / `[x] ` representation inside ordinary bullet list items. The scope narrows from `documents` to `documents.currentonly`, which limits the add-on to the currently open document and removes all offline access.

### Changed

- **OAuth scope:** `documents` → `documents.currentonly`. The add-on can no longer reach any file other than the one you have open, and has no continuous or offline access. Although this removes some functionality, it's the only way to get approval.
- **Removed Docs Advanced Service dependency.** Import and export now run entirely through `DocumentApp`. No `Docs.Documents.get`, no `Docs.Documents.batchUpdate`.
- **Checklists use plain-text `[ ] ` / `[x] ` markers.** Markdown checklist items (`- [ ]`, `- [x]`) are imported as ordinary bullet list items whose text begins with a literal `[ ] ` or `[x] ` prefix.
- **Blockquotes render as indented italic paragraphs.** Markdown `> …` lines use `DocumentApp`'s paragraph indent + italic formatting instead of a literal `> ` prefix, matching how Google Docs™ renders blockquotes visually. Export still emits standard `> ` markdown.
- **Spacer paragraphs between heavy blocks.** Consecutive lists, tables, and blockquotes are now separated by a blank paragraph on import, avoiding the "clumped" rendering the previous release produced.
- **Import dialog notices unified.** Checkbox and code-block advisories are now a single notice that shows only the bullets that apply to the current markdown, instead of stacking two separate blocks.

### Added

- **Changelog page.** A new `/changelog/` page on the site renders this file directly at build time, and links from the navigation and footer.
- **About dialog deep-links the version to the changelog.** Clicking the version number in the About dialog opens the current release's entry on the site.

### Fixed

- **Dialogs no longer steal focus from your input.** The opening focus-hammer that beats Google Docs' focus-steal now disables itself as soon as you click or type anywhere, so focus stays in the textarea / field you moved to.

### Removed

- **Docs API Blocks debug tab** in the Dev Tools → Inspect Document inspector. The tab relied on `Docs.Documents.get` and cannot function under the narrower scope. The inspector keeps the `DocumentApp`-based view with `List`, `Nest`, `Indent`, and `Text` columns.
- **Non-primary tab latency warning** in the Import from Markdown dialog. The 5–6 second latency it warned about came from the REST API round-trip and no longer exists.

## [v1.0.0] — 2026-04-21

**Initial public release.**

### Added

- **Insert Mermaid Diagram** — full side-by-side editor with live preview and templates.
- **Edit All / Edit Selected Mermaid Diagram** — in-place editing with live preview.
- **Convert All / Selected Code to Diagrams** — render Mermaid code blocks as diagrams in batch.
- **Convert All / Selected Diagrams to Code** — extract the original Mermaid source from diagram alt text.
- **Import from Markdown** — paste markdown with Mermaid blocks; headings, lists, tables, inline code, and checkboxes are created in the doc.
- **Export as Markdown** — convert the entire doc back to markdown with Mermaid source preserved.
- **Fix Native "Copy as Markdown"** — repair mangled Mermaid syntax produced by Google's own Copy as Markdown feature.
- **Public site** at [mermaid.numanaral.dev](https://mermaid.numanaral.dev/?utm_source=github&utm_medium=changelog_md&utm_campaign=mermaid_toolkit) covering features, gallery, limitations, FAQ, privacy, and support.

### OAuth scopes (v1.0.0)

- `https://www.googleapis.com/auth/documents` — used by the Docs Advanced Service to create native Google Docs™ checkbox glyphs during markdown import.
- `https://www.googleapis.com/auth/script.container.ui` — display dialog windows inside Google Docs™.

Superseded by v1.1.0's `documents.currentonly` scope. See the v1.1.0 entry above for the full rationale.

[v1.2.0]: https://github.com/numanaral/mermaid-toolkit-for-google-docs/releases/tag/v1.2.0
[v1.1.1]: https://github.com/numanaral/mermaid-toolkit-for-google-docs/releases/tag/v1.1.1
[v1.1.0]: https://github.com/numanaral/mermaid-toolkit-for-google-docs/releases/tag/v1.1.0
[v1.0.0]: https://github.com/numanaral/mermaid-toolkit-for-google-docs/releases/tag/v1.0.0
