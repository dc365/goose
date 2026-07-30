# MeteoMate Weather Golden Replay

This directory stores versioned, deterministic weather-pipeline replay cases. The first case is a
fully synthetic Fujian-style warm-sector rainstorm scenario. It contains no operational
observations, no personal information, and no authoritative forecast.

Each immutable revision contains:

- `manifest.json`: data policy, input and expected SHA-256 digests, fixed component versions,
  replay clocks, and headline expectations.
- `dataset.json`: raw `meteomate.weather.dataset/v1` input.
- `expected.json`: deterministic normalized dataset, validation, diagnosis, Evidence, rendered
  Artifact, publication assessment, and lineage projections. The test also exercises the Harness
  publication gate at the manifest's in-window and expired clocks.

Runtime-only fields are deliberately removed from `expected.json`: source `retrievedAt`, provider
attestation, Evidence `createdAt`, Artifact `createdAt`, and the Artifact's absolute workspace
path. Everything else remains reviewable rather than being collapsed into a single hash.

## Updating a replay

Never edit a released revision in place. Copy the latest revision to a new `vN` directory, increase
`revision`, set `supersedes`, regenerate the expected projection, and update `index.json`. A
normalizer, diagnosis algorithm, renderer, input, or expected-output change must be visible in the
manifest and its SHA-256 values.

Run `node tests/weather-golden-replay.cjs` from `products/meteo-office-desktop` to verify the replay,
including idempotence, ordering invariance, cross-workspace stability, lineage, mutation
sensitivity, expiry clocks, and the synthetic publication gate.
