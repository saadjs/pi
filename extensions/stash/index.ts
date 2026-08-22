import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { isShellAction, isTemporaryAction, PromptStash } from "./core";

const STATUS_ID = "prompt-stash";

export default function (pi: ExtensionAPI) {
  const stash = new PromptStash();
  let activeContext: ExtensionContext | undefined;

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(
      STATUS_ID,
      stash.hasPrompt ? ctx.ui.theme.fg("accent", "prompt stashed") : undefined,
    );
  }

  function restore(ctx: ExtensionContext, automatic = false): boolean {
    const prompt = stash.value;
    if (prompt === undefined) return false;

    if (automatic && ctx.ui.getEditorText().length > 0) return false;

    stash.take();
    ctx.ui.setEditorText(prompt);
    updateStatus(ctx);
    ctx.ui.notify("Restored stashed prompt", "info");
    return true;
  }

  function toggleStash(ctx: ExtensionContext): void {
    const current = ctx.ui.getEditorText();

    if (!stash.hasPrompt) {
      if (current.length === 0) {
        ctx.ui.notify("Nothing to stash", "warning");
        return;
      }

      stash.stash(current);
      ctx.ui.setEditorText("");
      updateStatus(ctx);
      ctx.ui.notify("Prompt stashed", "info");
      return;
    }

    if (current.length === 0) {
      restore(ctx);
      return;
    }

    const previous = stash.take()!;
    stash.stash(current);
    ctx.ui.setEditorText(previous);
    updateStatus(ctx);
    ctx.ui.notify("Swapped current and stashed prompts", "info");
  }

  function restoreAfterAction(ctx: ExtensionContext): void {
    setTimeout(() => restore(ctx, true), 0);
  }

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;

    const previousEditor = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor =
        previousEditor?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      const handleInput = editor.handleInput.bind(editor);

      editor.handleInput = (data: string): void => {
        if (matchesKey(data, "ctrl+s")) {
          toggleStash(ctx);
          return;
        }

        const isSubmit = keybindings.matches(data, "tui.input.submit");
        const submittedText = editor.getText();

        handleInput(data);

        if (isSubmit && stash.hasPrompt && isTemporaryAction(submittedText)) {
          // If Enter only accepted an autocomplete item, the editor remains non-empty
          // and automatic restoration safely does nothing.
          restoreAfterAction(ctx);
        }
      };

      // Pi awaits shell commands inside its submit callback. Wrap that callback after
      // setEditorComponent() wires it up so restoration happens when execution ends.
      queueMicrotask(() => {
        const submit = editor.onSubmit;
        if (!submit) return;

        editor.onSubmit = async (text: string): Promise<void> => {
          let submitError: unknown;
          try {
            await submit(text);
          } catch (error) {
            submitError = error;
          }

          if (stash.hasPrompt && isShellAction(text)) {
            const current = ctx.ui.getEditorText();
            if (current.length === 0 || current.trim() === text.trim()) {
              // Pi leaves the completed ! command in the editor. Remove only that exact
              // command; never overwrite text the user entered while it was running.
              if (current.length > 0) ctx.ui.setEditorText("");
              restore(ctx, true);
            }
          }

          if (submitError !== undefined) throw submitError;
        };
      });

      return editor;
    });

    updateStatus(ctx);
  });

  pi.on("session_shutdown", () => {
    activeContext = undefined;
  });

  pi.on("model_select", () => {
    if (activeContext) restore(activeContext, true);
  });

  pi.on("thinking_level_select", () => {
    if (activeContext) restore(activeContext, true);
  });
}
