#!/usr/bin/env bash
set -euo pipefail

npm install -g codexpilot-ios
codexpilot-ios doctor
codexpilot-ios run --case qa/login.md
