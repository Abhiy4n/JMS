# Project Rules

## Action feedback

- Every user-initiated create, update, delete, status change, or similar mutation must report its outcome through the shared dedicated toast notification system.
- Use the existing toast provider and the appropriate success, error, warning, or info variant. Do not add one-off inline success/error banners for action outcomes.
- Keep inline messages for persistent page state, field-level validation, and information the user must be able to revisit. A toast may accompany validation or an action error, but it must not replace useful field-level guidance.
- Cover both successful and failed outcomes. When navigation follows an action, make sure the toast survives or is emitted on the destination page.
