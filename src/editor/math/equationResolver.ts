import { aiClient } from '../../ai';

export const CACHED_EQUATIONS: Record<string, string> = {
  softmax: '\\operatorname{softmax}(z_i)=\\frac{e^{z_i}}{\\sum_j e^{z_j}}',
  'cross entropy': 'L=-\\sum_i y_i\\log(\\hat{y}_i)',
  'gradient descent': '\\theta\\leftarrow\\theta-\\eta\\nabla_{\\theta}J(\\theta)',
  'bayes theorem': 'P(A\\mid B)=\\frac{P(B\\mid A)P(A)}{P(B)}',
  'kl divergence': 'D_{\\mathrm{KL}}(P\\parallel Q)=\\sum_x P(x)\\log\\frac{P(x)}{Q(x)}',
  attention: '\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V',
  'grpo clip': '\\mathcal{L}=\\mathbb{E}[\\min(r_t(\\theta)\\hat{A}_t,\\operatorname{clip}(r_t(\\theta),1-\\epsilon,1+\\epsilon)\\hat{A}_t)]',
  relu: 'f(x)=\\max(0,x)',
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Add readable TeX spacing without changing the equation's meaning. */
export function formatEquationLatex(latex: string): string {
  return latex
    .replace(/\s*=\s*/g, '\\;=\\;')
    .replace(/,\s*/g, ',\\;')
    .replace(/\s*\|\s*/g, '\\;|\\;')
    .replace(/\s*\\mid\s*/g, '\\;\\mid\\;')
    .replace(/\s*\\colon\s*/g, '\\;\\colon\\;')
    // Separate adjacent factors such as `r_t(\theta)\hat{A}_t`.
    .replace(/([)\]}])(?=(?:\\|[A-Za-z]))/g, '$1\\,');
}

export async function resolveEquation(prompt: string): Promise<string> {
  const query = normalize(prompt);
  const cached = CACHED_EQUATIONS[query] ?? Object.entries(CACHED_EQUATIONS).find(([name]) => query.includes(name))?.[1];
  if (cached) return formatEquationLatex(cached);
  const response = await aiClient.complete({
    prompt: `Convert this request to one valid LaTeX equation. Return only LaTeX, without explanation, Markdown fences, or dollar signs: ${prompt}`,
  });
  return formatEquationLatex(response.trim().replace(/^```(?:latex|tex)?\s*/i, '').replace(/\s*```$/, '').replace(/^\$+|\$+$/g, '').trim());
}
