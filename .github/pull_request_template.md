## Summary

<!-- What does this PR change and why? -->

## Type

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Docs
- [ ] Security

## Verification

- [ ] `npm run build` green
- [ ] `npm run check:ids` green
- [ ] `./scripts/install-hooks.sh` run (if hooks changed)
- [ ] Tested end-to-end on devnet (if touching the demo-critical path)

## Checklist

- [ ] No secrets in staged files (pre-commit hook checks this)
- [ ] No duplicate code (rule 6 — DRY)
- [ ] Module boundaries respected (programs → sdk → web, txline → agent)
- [ ] Dead code removed in the same commit (rule 6)
