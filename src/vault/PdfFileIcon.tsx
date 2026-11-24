import { FileTextIcon } from '@radix-ui/react-icons';

/** Regular document icon with a small theme-colored marker: P for PDFs, S for slide decks. */
export function PdfFileIcon({
  size = 15,
  className,
  kind = 'pdf',
}: {
  size?: number;
  className?: string;
  kind?: 'pdf' | 'slides';
}) {
  return (
    <span
      className={`pdf-file-icon${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-label={kind === 'slides' ? 'Slide deck' : 'PDF file'}
      role="img"
    >
      <FileTextIcon width={size} height={size} aria-hidden="true" />
      <span className="pdf-file-indicator" aria-hidden="true">{kind === 'slides' ? 'S' : 'P'}</span>
    </span>
  );
}
