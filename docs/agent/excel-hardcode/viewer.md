# excel-hardcode / viewer (shared)

- Shared viewer: `private/shared/excel-viewer/{viewer-core.js,excel-viewer.js}`,
  used by hardcode + tail-risk.
- Read-only. Issue overlay (yellow) + selected cell (blue) are separate states.
- Reveal is one-shot (navigation token); scrolling never re-centers.
- Virtual grid; used-range + extra rows/cols to fill the viewport.

Authority: the shared modules + `tests/excel-hardcode-check/viewer-core.test.js`.
