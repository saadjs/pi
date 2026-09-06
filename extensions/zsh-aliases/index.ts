import { createLocalBashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findZsh, resolveZshrc, wrapCommand } from "./core";

/**
 * Run user `!` / `!!` commands through zsh with ~/.zshrc loaded so shell
 * aliases and functions (oh-my-zsh `gst`, `gco`, ...) work inside pi.
 *
 * Pi runs `!` commands via `/bin/bash -c` by default, which never loads zsh
 * config. This only affects user-typed commands, not the agent's bash tool.
 */
export default function (pi: ExtensionAPI) {
  const zsh = findZsh();
  if (!zsh) return;

  const zshrc = resolveZshrc();
  const local = createLocalBashOperations({ shellPath: zsh });

  pi.on("user_bash", () => ({
    operations: {
      exec(command, cwd, options) {
        return local.exec(wrapCommand(command, zshrc), cwd, options);
      },
    },
  }));
}
