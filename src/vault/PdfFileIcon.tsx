/** Page with a "PDF" label — distinct from the Markdown FileTextIcon at a glance. */
export function PdfFileIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden="true"
      className={`pdf-file-icon${className ? ` ${className}` : ''}`}
    >
      <path
        d="M3.5 1.5h5.3L11.5 4.2V13.5h-8z M8.5 1.5v3h3"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <rect x="1" y="7.5" width="10" height="4.6" rx="1" fill="currentColor" />
      <text
        x="6"
        y="11"
        textAnchor="middle"
        fontSize="3.6"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#fff"
      >
        PDF
      </text>
    </svg>
  );
}
