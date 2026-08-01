# Extension versioning

Each completed extension modification is saved as one focused Git commit and
tagged as `v<major>.<minor>.<patch>`.

- Increment the patch version for fixes and small UI or automation changes.
- Increment the minor version for a new workflow or substantial capability.
- Increment the major version only for a breaking redesign or incompatible
  configuration/storage change.

Before each checkpoint, validate JavaScript syntax, `manifest.json`, and the
relevant safe automation path. Never include `.DS_Store` or credentials in a
commit.

Useful recovery commands:

```sh
git tag --sort=-version:refname
git switch --detach v0.1.0
git switch feature/data-model
git revert <commit>
```

Use `git revert` for a shared/pushed branch so history remains intact. Use a
new branch for experiments or large work that should not affect the stable
extension immediately.
