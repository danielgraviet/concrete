import { FileTextIcon } from '@radix-ui/react-icons';

/** Regular document icon with a small theme-colored PDF marker. */
export function PdfFileIcon({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <span
      className={`pdf-file-icon${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-label="PDF file"
      role="img"
    >
      <FileTextIcon width={size} height={size} aria-hidden="true" />
      <span className="pdf-file-indicator" aria-hidden="true">P</span>
    </span>
  );
}
