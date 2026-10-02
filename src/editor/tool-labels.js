// Human labels for the deck tools, shown in the Copilot drawer.

export const TOOL_LABELS = {
  get_deck: "Read the deck",
  list_templates: "Listed templates",
  list_themes: "Listed themes",
  list_assets: "Listed images",
  update_slide: "Updated slide",
  add_slide: "Added slide",
  remove_slide: "Removed slide",
  move_slide: "Moved slide",
  set_hidden: "Changed visibility",
  set_template: "Changed template",
  set_theme: "Changed theme",
  update_meta: "Updated deck info",
  set_image: "Placed image",
  add_overlay: "Added overlay",
  update_overlay: "Updated overlay",
  remove_overlay: "Removed overlay",
};

export const toolLabel = (name) => TOOL_LABELS[name] || name;
