# Sign In Behavior Audit — LayahTools Alpha (Task A-1.5)

> **Audited by:** Alpha Lane  
> **Date:** November 2026  
> **Component Audited:** `src/components/shell/EntryState.tsx` (Line 66)

---

## 1. Findings

1. **Authentication Codebase Search:**
   - A search for authentication providers (`next-auth`, `@clerk/nextjs`, `supabase`, `firebase`, `lucia`, `iron-session`, JWT, OAuth) returned **0 implementations**.
   - `package.json` contains no authentication dependencies.
   - There are no `/api/auth/` routes, server actions, or authentication cookies.
   - The word `session` in the codebase refers strictly to `EditorSession` (the in-memory PDF editing transaction session), not user authentication.

2. **UI Inspection:**
   - The landing page navbar (`EntryState.tsx`) contains:
     ```tsx
     <a href="#" className="opacity-90 hover:opacity-100 transition-opacity">Sign In</a>
     ```
   - Clicking "Sign In" jumps to the top of the page (`#`) with no handler, dialog, or redirect.
   - The internal Workspace view (`WorkspaceHeader.tsx`) does not render a "Sign In" or profile button.

3. **Status:**
   - **No authentication system is implemented.** The link is a static UI placeholder from early wireframes.

---

## 2. Risk & UX Assessment

- **Risk:** Showing an active-looking "Sign In" button that leads to `#` gives users the impression of a broken or incomplete application.
- **Privacy Principle:** LayahTools is currently a 100% browser-first workspace ("Everything stays in your browser session"). No user accounts or database dependencies currently exist.

---

## 3. Recommendation for Founder

1. **Short-Term (Phase 1):**
   - Provide an accessible tooltip: `title="Authentication coming in a future update"` or hide the button if preferred.
   - Do NOT build an ad-hoc authentication system (Rule: Alpha does not invent unapproved architecture).

2. **Long-Term (Phase 3+):**
   - When cloud document features (PDF to Word/Excel conversion, team workspaces) are introduced, evaluate lightweight providers (NextAuth / Supabase / Clerk) with explicit architectural approval.
