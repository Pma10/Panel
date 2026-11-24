# Monaco Editor 0.58.0 (vendored)

Copied from the npm package `monaco-editor@0.58.0`, folder `min/vs`, so the editor ships
inside the Go binary and works offline. Trimmed:

- `assets/ts.worker`, `assets/css.worker`, `assets/html.worker` removed (about 8MB).
  Their loader stubs (`ts.worker-*.js`, `css.worker-*.js`, `html.worker-*.js`) now point
  at the generic `editor.worker`, so JS/CSS/HTML get syntax highlighting but no
  IntelliSense. JSON keeps its validating worker.
- `*.d.ts` files removed.

To upgrade: replace `vs/` with the new `min/vs`, repeat the trimming, and update the
worker file names if their hashes changed.
