/** AI provider boundary types. */

export type CompleteRequest = {
  prompt: string;
  context?: string;
};

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  complete(request: CompleteRequest): Promise<string>;
  embed?(text: string): Promise<number[]>;
}
