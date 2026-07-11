# Contributing

## Planning

Use the
[`ts-route-openapi Plan`](https://github.com/users/mstephenn/projects/2)
GitHub Project for implementation plans, task breakdowns, and status tracking.
Do not add new long-lived plan documents under `docs/plans/`.

Design notes and durable technical decisions can remain in `docs/specs/` when
they are useful as project reference material.

## Branches and Pull Requests

- Branch from `main` for each focused change.
- Open a pull request back to `main`.
- Keep PRs scoped to one behavior change or documentation update.
- Run `npm test` and `npm run build` before requesting review when code changes.
- Resolve review threads before merging.

## Protected Main

The `main` branch is protected by the repository ruleset `Protect main`.

The ruleset blocks branch deletion and force pushes, requires pull requests,
requires one approving review, dismisses stale reviews after new pushes, and
requires review threads to be resolved.

No users or teams are configured as bypass actors.
