#!/bin/sh
# Puts the seeded claims' bills into bill storage and lets nginx write uploads there.
set -e
mkdir -p /data/files/seed
cp -n /seed-files/* /data/files/seed/ 2>/dev/null || true
chown -R nginx /data/files
