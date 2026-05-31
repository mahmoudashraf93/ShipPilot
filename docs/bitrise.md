# Bitrise

Add ShipPilot as a Script Step after dependency setup.

```bash
#!/usr/bin/env bash
set -euo pipefail

npm install -g shippilot
shippilot doctor
shippilot run --case qa/login.md
```

Requirements:

- macOS stack with Xcode.
- ShipPilot installs its bundled XcodeBuildMCP dependency; no separate XcodeBuildMCP step is needed.
- App project dependencies installed before the step runs.
- `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN` as Bitrise Secrets.
- App test credentials such as `TEST_EMAIL` and `TEST_PASSWORD`.

Upload `.shippilot/` as Bitrise artifacts so failed QA runs still leave evidence.
