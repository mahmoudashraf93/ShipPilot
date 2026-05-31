#!/usr/bin/env bash
set -euo pipefail

npm install -g shippilot
shippilot doctor
shippilot run --case qa/login.md
