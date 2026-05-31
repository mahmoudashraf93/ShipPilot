# Bitrise

Add CodexPilot iOS as a Script Step after dependency setup.

```bash
#!/usr/bin/env bash
set -euo pipefail

npm install -g codexpilot-ios
codexpilot-ios doctor
codexpilot-ios run --case qa/login.md
```

Requirements:

- macOS stack with Xcode.
- XcodeBuildMCP installed, for example `npm install -g xcodebuildmcp`.
- App project dependencies installed before the step runs.
- `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN` as Bitrise Secrets.
- App test credentials such as `TEST_EMAIL` and `TEST_PASSWORD`.

Upload `.codexpilot-ios/` as Bitrise artifacts so failed QA runs still leave evidence.
