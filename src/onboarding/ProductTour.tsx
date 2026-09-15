import { Button, Flex, Heading, Text } from '@radix-ui/themes';

export type ProductTourStep = {
  title: string;
  body: string;
  versus?: string;
};

export const PRODUCT_TOUR_STEPS: ProductTourStep[] = [
  {
    title: 'Your notes, your disk',
    body:
      'Concrete stores plain Markdown files in a folder you choose. No account, no export ritual, no proprietary database.',
    versus: 'Notion keeps your thinking in their cloud. Concrete keeps it on your machine.',
  },
  {
    title: 'Works with the rest of your stack',
    body:
      'Open the same vault in git, ripgrep, Cursor, or any editor. Folders are folders. Links are [[wikilinks]]. Files stay portable.',
    versus: 'Obsidian is powerful, but heavy plugin setups get fragile. Concrete stays a fast, opinionated shell around real files.',
  },
  {
    title: 'Write without the dashboard noise',
    body:
      'A quiet editor, tabs, and a file tree — built for focus. Themes (Concrete, Martian, Daytona) change the feel without turning the app into a config hobby.',
    versus: 'Notion pages become nested workspaces. Concrete stays a notes app.',
  },
  {
    title: 'Learn from what you already wrote',
    body:
      'Generate quizzes grounded in your notes, then take them in-app. Tutor mode explains concepts from the open note instead of generic chat.',
    versus: 'Neither Notion nor Obsidian ships a tight quiz loop tied to local Markdown by default.',
  },
  {
    title: 'An agent that can actually help',
    body:
      'Bring your own Codex agent to edit vault notes, switch themes, generate quizzes, and export PDFs — with live progress in the AI orb.',
    versus: 'Cloud assistants can summarize. Concrete’s agent can change the files in front of you.',
  },
  {
    title: 'Ready when you are',
    body:
      'Pick a vault folder (or keep using Documents/Concrete), write locally, and build knowledge you can take anywhere.',
    versus: 'Less lock-in than Notion. Less ceremony than a maximal Obsidian vault.',
  },
];

type Props = {
  stepIndex: number;
  onStepIndexChange: (index: number) => void;
  onClose: () => void;
  onFinished: () => void;
};

/**
 * Lightweight product tour — Concrete advantages vs Notion / Obsidian.
 */
export function ProductTour({
  stepIndex,
  onStepIndexChange,
  onClose,
  onFinished,
}: Props) {
  const clamped = Math.max(0, Math.min(stepIndex, PRODUCT_TOUR_STEPS.length - 1));
  const step = PRODUCT_TOUR_STEPS[clamped];
  const isFirst = clamped === 0;
  const isLast = clamped === PRODUCT_TOUR_STEPS.length - 1;

  return (
    <div className="mv-product-tour" role="document">
      <Flex align="center" justify="between" mb="3">
        <Text size="1" color="gray" weight="medium">
          Why Concrete · {clamped + 1}/{PRODUCT_TOUR_STEPS.length}
        </Text>
        <Button type="button" variant="ghost" color="gray" size="1" onClick={onClose}>
          Skip
        </Button>
      </Flex>

      <Heading size="5" mb="2">
        {step.title}
      </Heading>
      <Text as="p" size="2" mb="3">
        {step.body}
      </Text>
      {step.versus ? (
        <div className="mv-product-tour-versus">
          <Text size="1" weight="medium">
            vs Notion & Obsidian
          </Text>
          <Text as="p" size="2" color="gray" mt="1">
            {step.versus}
          </Text>
        </div>
      ) : null}

      <div className="mv-product-tour-dots" aria-hidden>
        {PRODUCT_TOUR_STEPS.map((_, index) => (
          <span
            key={index}
            className={index === clamped ? 'active' : index < clamped ? 'done' : ''}
          />
        ))}
      </div>

      <Flex gap="2" mt="4" justify="end">
        <Button
          type="button"
          variant="soft"
          color="gray"
          disabled={isFirst}
          onClick={() => onStepIndexChange(clamped - 1)}
        >
          Back
        </Button>
        {isLast ? (
          <Button type="button" onClick={onFinished}>
            Start writing
          </Button>
        ) : (
          <Button type="button" onClick={() => onStepIndexChange(clamped + 1)}>
            Next
          </Button>
        )}
      </Flex>
    </div>
  );
}
