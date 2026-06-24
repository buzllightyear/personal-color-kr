#!/bin/sh
# Render start command — invoked as a single absolute path by render.yaml's
# `dockerCommand` (see that file).
#
# Why a script instead of an inline `dockerCommand`: Render treats the
# dockerCommand string as a single command, so an `&&`-chained inline command
# (`cd ... && alembic upgrade head && uvicorn ...`) is parsed as one command
# name and fails with `Exited with status 127` (`sh: 1: ...: not found`).
# Putting the migrate-then-serve sequence in this file lets dockerCommand be a
# single, space-free path that Render cannot mangle.
#
# Single free instance => running `alembic upgrade head` at boot is race-free
# (the accepted testing-host tradeoff documented in render.yaml). The launch
# host should move migration to a dedicated pre-deploy/release phase instead.
set -e

cd /app/apps/api
alembic upgrade head

cd /app
exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-8000}"
