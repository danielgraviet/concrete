import type { Observer, Subject } from './types';

/** Generic subject: attach / detach / notify. */
export class BaseSubject<TEvent> implements Subject<TEvent> {
  private readonly observers = new Set<Observer<TEvent>>();

  attach(observer: Observer<TEvent>): void {
    this.observers.add(observer);
  }

  detach(observer: Observer<TEvent>): void {
    this.observers.delete(observer);
  }

  notify(event: TEvent): void {
    for (const observer of this.observers) {
      observer.update(event);
    }
  }

  get observerCount(): number {
    return this.observers.size;
  }
}
