// Wax logo — a stylized "W" formed by sound waves, inspired by a vinyl groove.
// Monochrome, uses currentColor so it adapts to theme.
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="Wax logo"
      role="img"
    >
      {/* vinyl grooves */}
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      {/* W formed by sound-wave strokes */}
      <path
        d="M6 11 L9 22 L13 13 L16 22 L19 13 L23 22 L26 11"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}
