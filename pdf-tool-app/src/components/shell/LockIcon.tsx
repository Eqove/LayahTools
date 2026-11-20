/** Small padlock shown next to tools marked locked (see isLocked in lib/capabilities/groups.ts). Label only. */
export function LockIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <>
      <svg className={`${className} shrink-0 text-slate-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2} d="M8 11V8a4 4 0 118 0v3" />
      </svg>
      <span className="sr-only">(locked)</span>
    </>
  );
}
