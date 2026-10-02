# Limitations

- PowerPoint export is out of scope. Use your existing HTML→PPTX workflow on `deck.html`.
- The editor does not preserve YAML comments in `deck.yaml`.
- The "overlay covers template text" check needs a laid-out page, so the editor reports it but
  `deckforge build` does not. The build checks bounds, alt texts and missing files.
- Images are not resized or compressed. Unused files in `assets/` are reported, never deleted.
- Fonts are not bundled. The `build` theme falls back to system fonts when its fonts are not installed.
