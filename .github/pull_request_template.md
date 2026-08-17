## Summary

<!-- What this PR does, in one or two sentences. -->

Closes #

## Why

<!-- The problem this solves. Link the issue's motivation rather than repeating it. -->

## Changes

<!-- The notable changes, not a file listing. Call out anything a reviewer
     would otherwise have to reverse-engineer from the diff. -->

-

## Testing

<!-- What you ran, and what it proved. Paste relevant output. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`

## Screenshots

<!-- For UI changes. Include the relevant states, not just the happy path. -->

## Risks

<!-- What could break, and what would surface it. Write "none identified" only
     if that is actually true. -->

## Checklist

- [ ] Scope matches the linked issue
- [ ] Tests cover the new behavior, including null and partial-data paths
- [ ] Any scoring rule change bumps `SCORING_VERSION` and updates `docs/SCORING.md`
- [ ] No secrets, tokens, or personal data added to the repository or logs
- [ ] Documentation updated where behavior changed
