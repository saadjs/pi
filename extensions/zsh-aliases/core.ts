import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ZSH_CANDIDATES = [
  "/bin/zsh",
  "/opt/homebrew/bin/zsh",
  "/usr/local/bin/zsh",
  "/usr/bin/zsh",
];

export function findZsh(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const shell = env.SHELL;
  if (shell?.endsWith("/zsh") && exists(shell)) return shell;
  return ZSH_CANDIDATES.find((path) => exists(path));
}

export function resolveZshrc(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return join(env.ZDOTDIR ?? home, ".zshrc");
}

/** Single-quote a string for POSIX/zsh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Wrap a user command so zsh loads ~/.zshrc before parsing it.
 *
 * zsh only expands aliases that already exist when a line is parsed, so the
 * user command must be `eval`ed after the rc file has been sourced.
 */
export function wrapCommand(command: string, zshrc: string): string {
  const rc = shellQuote(zshrc);
  return [
    "export DISABLE_AUTO_UPDATE=true",
    `[ -f ${rc} ] && source ${rc} >/dev/null 2>&1`,
    `eval ${shellQuote(command)}`,
  ].join("\n");
}
