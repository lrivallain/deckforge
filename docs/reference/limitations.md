# Limitations

- [PowerPoint export](../guide/presenting#export-to-powerpoint) produces static slides: the staged reveals are not
  turned into PowerPoint animations.
- The exported file names fonts but does not embed them. Fonts that the exporting browser cannot load are replaced
  by the next font of the theme's stack, and the export lists them. Text may wrap differently when PowerPoint
  substitutes a font.
- The export maps text, boxes, borders, images and overlays to native objects. Icons, gradients and clipped shapes
  become vector pictures. `<video>`, `<iframe>` and other embedded content, and clip paths other than polygons, are left out.
- The editor does not preserve YAML comments in `deck.yaml`.
- The "overlay covers template text" check needs a laid-out page, so the editor reports it but
  `deckforge build` does not. The build checks bounds, alt texts and missing files.
- Images are not resized or compressed. Unused files in `assets/` are reported, never deleted.
- Fonts are not bundled. The `build` theme falls back to system fonts when its fonts are not installed.
