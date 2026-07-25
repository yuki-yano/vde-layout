# Releasing vde-layout

This document is for repository maintainers. User installation and usage belong
in `README.md` and `README.ja.md`.

## One-time repository setup

Create a GitHub Actions environment named `release` and restrict deployments to
tags matching `v*`. The release workflow uses this environment for crates.io
publishing.

The first version of a new crate cannot use Trusted Publishing. Bootstrap the
crate once with a crates.io API token that has permission to publish a new
crate:

```bash
cargo publish --locked
```

After the first version is available, open the `vde-layout` crate settings on
crates.io and add a GitHub Trusted Publisher with these exact values:

- repository owner: `yuki-yano`
- repository name: `vde-layout`
- workflow filename: `release.yml`
- environment: `release`

Enable **Require trusted publishing for all new versions** after adding the
publisher. The workflow requests a short-lived token through GitHub OIDC. Do
not add a `CARGO_REGISTRY_TOKEN` GitHub secret. If the API token was created
solely for the bootstrap publish, revoke it after Trusted Publishing is
configured.

## Release procedure

1. Update `version` in `Cargo.toml`.
2. Run the local and CI release checks.
3. Merge the release commit into `main`.
4. Create and push the matching `v<version>` tag.
5. Confirm the crate and GitHub Release are available.

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

- [ ] the `release` environment accepts only tags matching `v*`.
- [ ] the crates.io Trusted Publisher matches `yuki-yano/vde-layout`,
      `release.yml`, and the `release` environment.
- [ ] crates.io requires Trusted Publishing for all new versions.
- [ ] no long-lived crates.io token is stored in GitHub Actions.
- [ ] the release workflow finishes successfully, including after any required
      rerun.
- [ ] installation from crates.io and one GitHub Release archive is verified.
