---
id: login-happy-path
title: Login happy path
required_env:
  - TEST_EMAIL
  - TEST_PASSWORD
tags:
  - release
  - smoke
---

Launch the app.
Enter `${TEST_EMAIL}` and `${TEST_PASSWORD}`.
Tap Log In.
Expect the Home screen to be visible.
