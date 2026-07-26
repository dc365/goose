# 成果预览工作台 Design QA

## Comparison target

- source visual truth path: `/var/folders/3_/wztmk7md1gb3p4j11dqh75rw0000gp/T/codex-clipboard-5ffc0edb-8f30-4b63-8242-c89385a4b8bc.png`
- implementation Web screenshot path: `/var/folders/3_/wztmk7md1gb3p4j11dqh75rw0000gp/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-26 at 6.19.42 PM.jpeg`
- implementation Markdown screenshot path: `/var/folders/3_/wztmk7md1gb3p4j11dqh75rw0000gp/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-26 at 6.19.51 PM.jpeg`
- full-view comparison evidence: `/tmp/meteomate-preview-qa/reference-vs-implementation-final.png`
- focused preview comparison evidence: `/tmp/meteomate-preview-qa/focused-preview-comparison-final.png`
- viewport: MeteoMate workspace BrowserWindow `1540 × 960` CSS px; Computer Use capture `1232 × 768` px
- state: completed task with HTML and Markdown artifacts; right preview workbench expanded; HTML active in the primary comparison

## Density normalization

- source pixels: `1984 × 1814`
- implementation pixels: `1232 × 768`
- implementation CSS/window size: `1540 × 960`
- source CSS size and device scale factor: unavailable because the source is a supplied WorkBuddy/Codex reference screenshot
- implementation capture scale: `0.8` output px per configured CSS px (`1232 / 1540`, `768 / 960`); the desktop capture service does not expose the underlying display device scale factor
- full comparison normalization: both images scaled proportionally to `768 px` height and placed side by side
- focused comparison normalization: the source and implementation right-preview regions were cropped from their native screenshots, then scaled proportionally to `768 px` height and placed side by side

The supplied visual is an interaction and layout reference rather than a request to clone the surrounding WorkBuddy shell. The comparison therefore evaluates the right-side workbench hierarchy, navigation, live content surface, split-view relationship, and visual finish while preserving MeteoMate's existing navigation and design tokens.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation uses MeteoMate's existing system font stack and compact interface hierarchy. Tab titles, artifact type labels, address text, tooltips, and rendered Markdown headings remain readable without clipping. The previewed Web artifact retains its own typography, as expected for a live document surface.
- Spacing and layout rhythm: the preview panel forms a stable right column with a narrow draggable separator, tab strip, navigation bar, and full-height content surface. The chat composer remains visible, and the split view does not overlap the sidebar or persistent controls. Radii, borders, and vertical rhythm map to the existing MeteoMate shell.
- Colors and visual tokens: the host controls use MeteoMate's neutral surfaces, slate text, blue focus/active state, and subtle borders. The dark typhoon artifact is intentionally isolated from host chrome, preserving both document fidelity and clear containment.
- Image quality and asset fidelity: the reference contains no required standalone illustration or brand asset for the preview chrome. Existing product icons are reused; no emoji, placeholder art, CSS illustration, handcrafted SVG asset, or raster substitution was introduced.
- Copy and content: "预览成果", artifact type labels, tab titles, navigation states, external-open action, and document error/status copy are concise and coherent in the MeteoMate context.
- Icons: back, forward, refresh/stop, external-open, close, and collapse actions use the product's existing icon library with consistent stroke weight and alignment.
- Interaction states: verified opening an HTML artifact, opening a Markdown artifact, switching between both tabs, loading the real HTML page, rendering Markdown as a styled document, and clicking the HTML artifact's "暂停推演" control to change its state. Disabled back/forward states and active-tab semantics are visible in the accessibility tree.
- Accessibility: the preview region is labelled; tabs expose tab/selected semantics; close and collapse controls have accessible names; the separator exposes an adjustable value and keyboard description; focus-visible styling is present; navigation controls expose disabled states; status is not communicated by color alone.
- Viewport resilience: at the configured workspace window size, no preview tab, toolbar control, artifact content, composer control, or sidebar action is clipped. The panel has a minimum readable width, the tab row scrolls when needed, and the separator supports pointer and keyboard resizing.

## Intentional differences

- MeteoMate retains its left navigation and task layout because the reference is used for the preview-workbench interaction, not for a full application-shell clone.
- The implementation gives the central task area more space than the reference at this viewport. The preview remains resizable so users can shift emphasis to the artifact when inspecting a dense document or Web app.
- The reference shows source/editor tabs plus a browser tab. The requested scope is artifact preview, so MeteoMate uses artifact tabs and a browser-style navigation bar without introducing an editor.
- Web content is hosted in a native sandboxed `WebContentsView`, while Markdown/text documents are rendered into a safe read-only document page. This difference is invisible in normal use but avoids iframe limitations and keeps interactive previews functional.

## Primary interactions tested

1. Opened the generated `preview-demo.html` artifact from the completed response card.
2. Confirmed the right preview workbench appears without replacing the chat context.
3. Opened `forecast-notes.md` and confirmed a second tab appears.
4. Switched between the HTML and Markdown tabs.
5. Confirmed the HTML preview executes its primary "暂停推演" interaction.
6. Confirmed the Markdown preview renders headings, lists, and paragraphs rather than raw source text.
7. Increased the right panel from `420 px` to `444 px` with the separator's Left Arrow command and confirmed its exposed value updated.
8. Inspected collapse, close, address, reload, external-open, and disabled back/forward states.

## Runtime and console checks

- `npm run check` passed, including syntax, browser/computer runtime, Office, smoke, UX regression, harness, expert-team, artifact-preview, state, capability, permission, project-workspace, and schema-contract tests.
- The Electron development build remained open after Web and Markdown interaction checks.
- Desktop process output was inspected. Mock mode emitted the expected disconnected-Goose model-settings warning; no renderer crash, unhandled preview exception, unauthorized navigation leak, or broken interaction appeared.

## Comparison history

- Pass 1 used the initial full and focused comparisons. Visual hierarchy and fidelity passed, but interaction inspection found one [P2] issue: the separator's hit target straddled the native preview surface, so accessibility-driven pointer focus could land in the Web preview instead of the resize control.
- Fixes made: moved the complete separator hit target onto the host side of the split boundary, explicitly focused it on pointer/accessible activation, exposed its real maximum value, and clamped persisted width whenever the window changes.
- Pass 2 post-fix evidence: `/tmp/meteomate-preview-qa/reference-vs-implementation-final.png` and `/tmp/meteomate-preview-qa/focused-preview-comparison-final.png`; the separator shows its active boundary state, accepts focus, and its keyboard value changes from `420` to `444`.
- The Markdown state was captured separately because it has no corresponding source state; it verifies the additional requested document-preview capability without being treated as pixel-fidelity evidence against the Web reference.

## Follow-up polish

- P3: a future source-code/editor mode could reuse the same tab model if users need to inspect and edit generated artifacts side by side. It is intentionally outside the current preview-only scope.
- P3: persisted per-artifact zoom can be added if long PDF or slide-review workflows show a repeated need.

## Implementation checklist

- [x] Right-side resizable preview workbench
- [x] Multiple artifact tabs with close and collapse actions
- [x] Interactive local/remote Web preview
- [x] Styled Markdown/text/code document preview
- [x] Existing Office-rendered artifact support
- [x] Back, forward, reload/stop, address, and external-open controls
- [x] Secure local-path authorization and sandboxed preview process
- [x] Accessibility semantics and keyboard resize support
- [x] Automated regression coverage and side-by-side visual QA

final result: passed
