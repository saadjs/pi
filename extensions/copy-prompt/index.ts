import { copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+shift+c", {
    description: "Copy the current prompt to the system clipboard",
    handler: async (ctx) => {
      const prompt = ctx.ui.getEditorText();

      if (!prompt) {
        ctx.ui.notify("Prompt is empty", "warning");
        return;
      }

      try {
        await copyToClipboard(prompt);
        ctx.ui.notify("Copied prompt to clipboard", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to copy prompt: ${message}`, "error");
      }
    },
  });
}
