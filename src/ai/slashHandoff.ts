/** Bridge from slash menu (Lexical) to App AI chat without rewriting MDXEditor props. */

export type SlashAiHandler = (query: string) => void;

let handler: SlashAiHandler | null = null;

export function setSlashAiHandler(next: SlashAiHandler | null): void {
  handler = next;
}

/** Strip leading slash and hand the freeform query to the open chat. */
export function handoffSlashToAi(rawQuery: string): boolean {
  const query = rawQuery.replace(/^\//, '').trim();
  if (!query || !handler) return false;
  handler(query);
  return true;
}
