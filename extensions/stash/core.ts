export class PromptStash {
  private prompt: string | undefined;

  get value(): string | undefined {
    return this.prompt;
  }

  get hasPrompt(): boolean {
    return this.prompt !== undefined;
  }

  stash(prompt: string): void {
    this.prompt = prompt;
  }

  take(): string | undefined {
    const prompt = this.prompt;
    this.prompt = undefined;
    return prompt;
  }
}

export function isTemporaryAction(input: string): boolean {
  return input.trimStart().startsWith("/");
}
