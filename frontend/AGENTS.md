<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ponytail and clean-code rules

## Ponytail rules
- Prefer simple, readable solutions over clever or overly abstract ones.
- Keep changes scoped to the task; do not broaden the feature while fixing a bug.
- Match the existing style and architecture before introducing new patterns.
- Favor maintainable edits that a teammate can understand in one pass.

## Clean code rules
- Use clear, intent-revealing names for variables, functions, components, and files.
- Keep functions and components focused on a single responsibility.
- Remove dead code, unused imports, duplicate logic, and noisy comments.
- Prefer explicit control flow and early returns over deeply nested conditionals.
- Keep files organized and consistent with the surrounding codebase.
- Add or update tests when changing behavior, especially for bug fixes and edge cases.
- Write code that is easy to read, easy to debug, and easy to extend.

## Working expectations
- Do not add unnecessary dependencies or framework churn.
- If a fix can be made smaller and clearer, choose the smaller path.
- If you need to explain complexity, the code should still be approachable.
- Always leave the codebase in a cleaner state than you found it.
