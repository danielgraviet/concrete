import { QuizCardBlock } from '../composite/blocks';
import { createId, type QuizCardSelection } from '../types';

/** Factory for flashcards created from an editor selection. */
export class QuizCardFactory {
  static createFromSelection(selection: QuizCardSelection): QuizCardBlock {
    const front = selection.front.trim();
    const back = selection.back.trim();
    if (!front || !back) {
      throw new Error('Quiz cards require both front and back text');
    }
    if (!selection.notePath) {
      throw new Error('Quiz cards require a notePath');
    }

    const tags = (selection.tags ?? [])
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);

    return new QuizCardBlock(
      createId('qc'),
      selection.notePath,
      front,
      back,
      tags,
      Date.now(),
    );
  }
}
