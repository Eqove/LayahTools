/** Small inline icons used by the isolated DOCX workspace. Presentation only. */

interface DocxIconProps {
  className?: string;
}

const svgProps = {
  "aria-hidden": true,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function DocxArrowLeftIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

export function DocxUploadIcon({ className = "h-5 w-5" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function DocxDocumentIcon({ className = "h-5 w-5" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
    </svg>
  );
}

export function DocxAlertIcon({ className = "h-5 w-5" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4m0 4h.01" />
    </svg>
  );
}

export function DocxCloseIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

export function DocxArrowUpIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
    </svg>
  );
}

export function DocxArrowDownIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
    </svg>
  );
}

export function DocxTrashIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M19 7l-.87 12.14A2 2 0 0 1 16.14 21H7.86a2 2 0 0 1-1.99-1.86L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
    </svg>
  );
}

export function DocxTextIcon({ className = "h-5 w-5" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M4 6h16M4 11h12M4 16h16M4 21h9" />
    </svg>
  );
}

export function DocxInfoIcon({ className = "h-5 w-5" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </svg>
  );
}

export function DocxShieldIcon({ className = "h-5 w-5" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function DocxMergeIcon({ className = "h-5 w-5" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M7 4v6a4 4 0 0 0 4 4h6" />
      <path d="M17 4v6a4 4 0 0 1-4 4" />
      <path d="M14 11l3 3-3 3M14 7l3-3-3-3" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function DocxCheckIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function DocxDownloadIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export function DocxCopyIcon({ className = "h-4 w-4" }: DocxIconProps) {
  return (
    <svg {...svgProps} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}
