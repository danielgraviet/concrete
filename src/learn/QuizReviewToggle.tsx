import { Button } from '@radix-ui/themes';
import { CheckIcon, LayersIcon } from '@radix-ui/react-icons';
import type { ReviewSystem } from './useReviewSystem';

/** Tab-bar switch that puts every question of a quiz into spaced review. */
export function QuizReviewToggle({ system, path }: { system: ReviewSystem; path: string }) {
  const enabled = system.store.isQuizEnabled(path);
  const count = system.index.note(path)?.cards.length ?? 0;
  return (
    <Button
      size="1"
      variant={enabled ? 'soft' : 'ghost'}
      color="gray"
      highContrast
      disabled={count === 0}
      title={
        enabled
          ? 'All questions in this quiz are in spaced review. Click to review only the ones you miss.'
          : 'Missed questions already go into review. Click to review every question.'
      }
      onClick={() => system.store.setQuizEnabled(path, !enabled)}
    >
      {enabled ? <CheckIcon /> : <LayersIcon />}
      {enabled ? 'In review' : 'Add to review'}
    </Button>
  );
}
