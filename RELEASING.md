# Releasing vde-layout

This document is for repository maintainers. User installation and usage belong
in `README.md` and `README.ja.md`.

## One-time repository setup

Create a GitHub Actions environment named `release`. Add the repository
environment secret `CARGO_REGISTRY_TOKEN` to that environment.

Create the crates.io token for the `vde-layout` crate with the smallest
available scope:

- the first release requires permission to publish a new crate
- later releases require permission to update `vde-layout`
- do not grant ownership-management permission

The release workflow reads the token only in the `cargo publish` step. Protect
the `release` environment with the reviewers required by the repository's
release policy.

## Release procedure

1. Update `version` in `Cargo.toml`.
2. Run the local and CI release checks.
3. Merge the release commit into `main`.
4. Create and push the matching `v<version>` tag.
5. Approve the `release` environment deployment.
6. Confirm the crate and GitHub Release are available.

The workflow checks whether the exact crate version already exists before
publishing. Rerunning a partially completed workflow therefore skips an existing
crate version and continues to the GitHub Release job.

## Definition of Done

### Functional completion

- [ ] `Cargo.toml` and the `v<version>` tag contain the same version.
- [ ] crates.io serves the new `vde-layout` version.
- [ ] the GitHub Release contains all four target archives and checksums.

### Test completion

- [ ] CI formatting, clippy, test, package dry-run, install smoke, and release
      build checks pass.
- [ ] each packaged native binary prints the expected version and help.
- [ ] `vde-layout` and `vl` produce identical help and dry-run output.

### Operational completion

- [ ] the `release` environment approval is recorded.
- [ ] the release workflow finishes successfully, including after any required
      rerun.
- [ ] installation from crates.io and one GitHub Release archive is verified.
