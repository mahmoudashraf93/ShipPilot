# GitHub Actions

Use macOS runners because iOS simulator testing requires Xcode.

Install XcodeBuildMCP before running ShipPilot if your runner image does not already include it:

```bash
npm install -g xcodebuildmcp
```

```yaml
name: ShipPilot QA

on:
  workflow_dispatch:
  release:
    types: [published]

jobs:
  shippilot:
    runs-on: macos-15
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install XcodeBuildMCP
        run: npm install -g xcodebuildmcp

      - name: Run ShipPilot
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          CODEX_ACCESS_TOKEN: ${{ secrets.CODEX_ACCESS_TOKEN }}
          CODEX_HOME_TGZ_BASE64: ${{ secrets.CODEX_HOME_TGZ_BASE64 }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
        run: |
          npx shippilot doctor
          npx shippilot run --case qa/login.md

      - name: Upload ShipPilot report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: shippilot-report
          path: .shippilot/
```

For open-source projects, prefer `workflow_dispatch`, releases, schedules, or maintainer-approved labels. Do not expose secrets to arbitrary fork PRs.
