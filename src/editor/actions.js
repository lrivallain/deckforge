import { api } from "./api.js";
import { toast } from "./dom.js";
import { state } from "./state.js";

export async function op(name, args, opts = {}) {
  try {
    return await api.op(name, args, opts);
  } catch (err) {
    toast(err.message, { kind: "error" });
    throw err;
  }
}

/** Fire-and-forget variant (errors are already surfaced as toasts). */
export function opQuiet(name, args, opts) {
  return op(name, args, opts).catch(() => null);
}

export async function undo() {
  if (!state.canUndo) return;
  try {
    await api.undo();
  } catch (err) {
    toast(err.message, { kind: "error" });
  }
}

export async function redo() {
  if (!state.canRedo) return;
  try {
    await api.redo();
  } catch (err) {
    toast(err.message, { kind: "error" });
  }
}

export async function removeSlide(id) {
  const index = state.deck.slides.findIndex((s) => s.id === id);
  await op("remove_slide", { id }, { label: "Delete slide" });
  toast("Slide deleted", { action: "Undo", onAction: undo });
  return index;
}
