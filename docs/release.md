# Release Process

This document describes how to release ShipPilot to npm.

## Versioning

ShipPilot uses npm semantic versions and git tags prefixed with `v`.

For a release, keep these values in sync:

- `package.json`
- `package-lock.json`
- `src/cli.ts`

For example, `0.0.1` is released from git tag `v0.0.1`.

## First npm Publish

The first release of an unscoped package must create the package on npm before trusted publishing can be configured.

For `v0.0.1`, publish once manually from a clean checkout with an npm account that has 2FA enabled:

```bash
npm login
npm whoami
npm ci
npm run typecheck
npm test
npm pack --dry-run
npm publish --access public
```

If `npm whoami` fails with `ENEEDAUTH`, complete `npm login` first and rerun `npm whoami` before publishing.

If `npm publish` fails with `E403` saying two-factor authentication or a granular access token with bypass 2FA is required, enable 2FA on the npm account and rerun `npm publish --access public`. Alternatively, create a granular npm access token with publish access to `shippilot` and bypass 2FA enabled, then publish with `NODE_AUTH_TOKEN` set for that command.

After npm publishes `shippilot@0.0.1`, confirm:

```bash
npm view shippilot version
npx shippilot --version
```

Both commands should report `0.0.1`.

After the manual npm publish succeeds, create the `v0.0.1` GitHub tag and release. The release workflow checks whether the package version already exists on npm, so the `v0.0.1` GitHub Release can run without trying to publish `0.0.1` a second time.

## Configure Trusted Publishing

After the first package exists on npm, configure trusted publishing for future releases.

On npmjs.com, configure:

- Package: `shippilot`
- Publisher: GitHub Actions
- Organization or user: `mahmoudashraf93`
- Repository: `ShipPilot`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

The release workflow uses GitHub OIDC with `id-token: write`, so no long-lived `NPM_TOKEN` is required for future publishes.

## Future Releases

For each future release:

1. Update the package version, lockfile version, CLI version, and changelog.
2. Run local checks:

   ```bash
   npm run typecheck
   npm test
   npm pack --dry-run --json
   npm run build
   node dist/cli.js --version
   ```

3. Commit the release prep.
4. Push `main`.
5. Create and publish a GitHub Release with a tag matching the package version, for example `v0.0.2`.
6. Confirm the `Release` workflow completed and published the npm package.
7. Verify:

   ```bash
   npm view shippilot version
   npx shippilot --version
   ```

The GitHub Release must be published, not saved as a draft, because `.github/workflows/release.yml` runs on `release.published`.
