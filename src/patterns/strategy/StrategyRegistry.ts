import { DefaultGfmdStrategy } from './DefaultGfmdStrategy';
import { ReactMarkdownRenderStrategy } from './ReactMarkdownRenderStrategy';
import type { MarkdownSerializeStrategy, RenderStrategy } from './types';

/**
 * Pluggable registry for active serialize + render strategies.
 * Defaults: DefaultGfmdStrategy + ReactMarkdownRenderStrategy.
 */
export class StrategyRegistry {
  private serializeStrategy: MarkdownSerializeStrategy;
  private renderStrategy: RenderStrategy;
  private readonly renderById = new Map<string, RenderStrategy>();
  private readonly serializeById = new Map<string, MarkdownSerializeStrategy>();

  constructor(
    serialize: MarkdownSerializeStrategy = new DefaultGfmdStrategy(),
    render: RenderStrategy = new ReactMarkdownRenderStrategy(),
  ) {
    this.serializeStrategy = serialize;
    this.renderStrategy = render;
    this.registerSerialize('default-gfm', serialize);
    this.registerRender(render);
  }

  getSerializeStrategy(): MarkdownSerializeStrategy {
    return this.serializeStrategy;
  }

  setSerializeStrategy(strategy: MarkdownSerializeStrategy, id = 'active'): void {
    this.serializeStrategy = strategy;
    this.registerSerialize(id, strategy);
  }

  getRenderStrategy(): RenderStrategy {
    return this.renderStrategy;
  }

  setRenderStrategy(strategy: RenderStrategy): void {
    this.renderStrategy = strategy;
    this.registerRender(strategy);
  }

  registerSerialize(id: string, strategy: MarkdownSerializeStrategy): void {
    this.serializeById.set(id, strategy);
  }

  registerRender(strategy: RenderStrategy): void {
    this.renderById.set(strategy.id, strategy);
  }

  useSerialize(id: string): boolean {
    const s = this.serializeById.get(id);
    if (!s) return false;
    this.serializeStrategy = s;
    return true;
  }

  useRender(id: string): boolean {
    const s = this.renderById.get(id);
    if (!s) return false;
    this.renderStrategy = s;
    return true;
  }
}

/** App-wide singleton; replace via setters as needed. */
export const strategyRegistry = new StrategyRegistry();

export function getSerializeStrategy(): MarkdownSerializeStrategy {
  return strategyRegistry.getSerializeStrategy();
}

export function setSerializeStrategy(strategy: MarkdownSerializeStrategy): void {
  strategyRegistry.setSerializeStrategy(strategy);
}

export function getRenderStrategy(): RenderStrategy {
  return strategyRegistry.getRenderStrategy();
}

export function setRenderStrategy(strategy: RenderStrategy): void {
  strategyRegistry.setRenderStrategy(strategy);
}
