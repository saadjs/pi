import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";

export const PREVIEW_LENGTH = 160;

export function isGhostty(env: NodeJS.ProcessEnv): boolean {
  return env.TERM_PROGRAM?.toLowerCase() === "ghostty" || env.TERM === "xterm-ghostty";
}

function plainText(text: string): string {
  return (
    stripVTControlCharacters(text)
      // eslint-disable-next-line no-control-regex -- Strip OSC terminators and all other control bytes.
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length > limit
    ? characters
        .slice(0, limit - 1)
        .join("")
        .trimEnd() + "…"
    : text;
}

/** Best-effort Markdown cleanup; never includes thinking or tool output. */
export function formatPreview(text: string): string {
  const markdown = text
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  return truncate(plainText(markdown), PREVIEW_LENGTH);
}

export function notificationTitle(cwd: string, sessionName?: string): string {
  const project = basename(cwd) || cwd;
  const title = sessionName ? `Pi · ${project} · ${sessionName}` : `Pi · ${project}`;
  // A semicolon terminates the title field in OSC 777.
  return truncate(plainText(title).replace(/;/g, ","), 120);
}

export function notificationSequence(title: string, body: string): string {
  // Sanitize again at the protocol boundary, including fallback/error messages.
  const safeTitle = truncate(plainText(title).replace(/;/g, ","), 120);
  const safeBody = truncate(plainText(body), PREVIEW_LENGTH);
  return `\x1b]777;notify;${safeTitle};${safeBody}\x07`;
}
