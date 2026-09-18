import { useEffect, useState } from 'react';
import { highlightCode, type HighlightSpan } from './highlight';

/** Read-only, syntax-highlighted code block used across quiz screens. */
export function CodeSnippet({ language, code }: { language: string; code: string }) {
  const [spans, setSpans] = useState<HighlightSpan[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSpans(null);
    highlightCode(code, language)
      .then((result) => {
        if (!cancelled) setSpans(result);
      })
      .catch(() => {
        if (!cancelled) setSpans(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <figure className="quiz-code">
      <figcaption>{language}</figcaption>
      <pre>
        <code>
          {spans
            ? spans.map((span, index) =>
                span.className ? (
                  <span key={index} className={span.className}>
                    {span.text}
                  </span>
                ) : (
                  span.text
                ),
              )
            : code}
        </code>
      </pre>
    </figure>
  );
}
