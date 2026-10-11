import type { OpenAnswerGradingStyle } from '../settings/types';

const SHARED_GUIDANCE = [
  'Grade against what the question explicitly asks, the reference answer, and its key points.',
  'Credit equivalent ideas and clear paraphrases. Do not require the reference wording or a technical label when the concept is clearly explained.',
  'Base deductions on requested concepts that are missing or incorrect. Distinguish a substantive omission from a minor precision improvement.',
  'Do not require optional elaborations or details the question did not ask for. When a prompt asks for a number of examples or conclusions, accept any valid ones that satisfy it.',
  'Award partial credit in proportion to the requested ideas answered correctly. Give concise feedback that names what is right and the most important gap.',
  'Give no credit for an empty answer.',
];

const STYLE_GUIDANCE: Record<OpenAnswerGradingStyle, string> = {
  supportive: 'Grade generously: mostly correct understanding should earn strong partial credit, with small deductions for minor omissions or imprecise wording.',
  balanced: 'Use balanced grading: give full credit when the core requests are answered correctly. Minor omissions or wording imprecision merit small deductions; a substantial unanswered part merits a proportional deduction.',
  rigorous: 'Grade rigorously for completeness and precision. Missing a requested core concept or mechanism should materially reduce the score, while equivalent correct explanations still receive credit.',
};

/** Build the default rubric saved into newly generated quizzes. */
export function buildOpenAnswerRubric(
  style: OpenAnswerGradingStyle,
  customGuidance = '',
): string {
  const rubric = [...SHARED_GUIDANCE, STYLE_GUIDANCE[style]];
  const custom = customGuidance.trim();
  if (custom) rubric.push(`User preferences: ${custom}`);
  return rubric.join(' ');
}
