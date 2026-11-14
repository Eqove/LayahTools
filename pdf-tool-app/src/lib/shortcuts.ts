export interface ShortcutItem {
  keys: string[];
  description: string;
  context?: string;
}

export interface ShortcutGroup {
  name: string;
  description: string;
  shortcuts: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: "General",
    description: "Global navigation and overlay controls",
    shortcuts: [
      {
        keys: ["?"],
        description: "Open keyboard shortcuts cheat-sheet",
      },
      {
        keys: ["Esc"],
        description: "Close dialog, cancel tool placement, or clear selection",
      },
    ],
  },
  {
    name: "PDF Editor V2",
    description: "Interactive visual editing and layout operations",
    shortcuts: [
      {
        keys: ["Ctrl", "Z"],
        description: "Undo last edit transaction",
        context: "Cmd+Z on macOS",
      },
      {
        keys: ["Ctrl", "Y"],
        description: "Redo edit transaction",
        context: "Ctrl+Shift+Z or Cmd+Shift+Z",
      },
      {
        keys: ["Ctrl", "A"],
        description: "Select all text runs and images on the active page",
        context: "Cmd+A on macOS",
      },
      {
        keys: ["Arrow keys"],
        description: "Nudge selected object by 1 point",
      },
      {
        keys: ["Shift", "Arrow keys"],
        description: "Nudge selected object by 10 points",
      },
      {
        keys: ["Delete"],
        description: "Delete selected object(s)",
        context: "Backspace also supported",
      },
    ],
  },
  {
    name: "Files & Collection",
    description: "Organizing documents in the FILES panel",
    shortcuts: [
      {
        keys: ["▲"],
        description: "Move selected file up in the collection sequence",
      },
      {
        keys: ["▼"],
        description: "Move selected file down in the collection sequence",
      },
    ],
  },
];

