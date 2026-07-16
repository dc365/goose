# MeteoMate SkillHub Server V1

A self-hosted Go service for publishing, discovering, recommending, signing, and downloading MeteoMate / Agent Skills packages.

The service is intentionally independent of Goose Core. It stores metadata in an atomically written JSON document and package bytes in content-addressed storage. This makes the first server version simple to deploy while keeping API and storage boundaries ready for PostgreSQL and object storage later.

## Capabilities

- public, organization, and private Skill visibility;
- immutable Skill versions and explicit publish/deprecate lifecycle;
- safe ZIP inspection with path, symlink, size, entry-count, and risk checks;
- content-addressed package storage using SHA-256;
- Ed25519 signatures for published packages;
- featured collections and rule-based recommendations;
- installation telemetry scoped to the authenticated user;
- bearer-token roles: `viewer`, `publisher`, and `admin`;
- append-only JSONL audit log;
- optional seeding from MeteoMate bundled Skills.

## Run locally

```bash
cd products/meteo-office-desktop/services/skillhub

export METEOMATE_SKILLHUB_TOKENS='{
  "dev-admin": {"subject":"admin","name":"Local Admin","role":"admin","orgId":"meteomate"},
  "dev-publisher": {"subject":"publisher","name":"Local Publisher","role":"publisher","orgId":"meteomate"},
  "dev-user": {"subject":"user-1","name":"Local User","role":"viewer","orgId":"meteomate"}
}'

go run ./cmd/skillhub \
  -addr 127.0.0.1:8088 \
  -data ./data \
  -seed-dir ../../bundled-skills
```

Health check:

```bash
curl http://127.0.0.1:8088/healthz
```

Public search:

```bash
curl 'http://127.0.0.1:8088/v1/skills?q=weather'
```

## Publish a Skill

Inspect without storing:

```bash
curl -H 'Authorization: Bearer dev-publisher' \
  -F 'package=@weather-report-writing.zip' \
  http://127.0.0.1:8088/v1/packages/inspect
```

Upload a draft version:

```bash
curl -H 'Authorization: Bearer dev-publisher' \
  -F 'package=@weather-report-writing.zip' \
  -F 'metadata={"name":"气象预报写稿","summary":"从分析到正式稿件","categories":["内容创作"],"tags":["气象","写稿"],"visibility":"public","changelog":"Initial release"}' \
  http://127.0.0.1:8088/v1/skills/weather-report-writing/versions
```

Publish:

```bash
curl -X POST \
  -H 'Authorization: Bearer dev-publisher' \
  http://127.0.0.1:8088/v1/skills/weather-report-writing/versions/1.0.0/publish
```

Download:

```bash
curl -OJ http://127.0.0.1:8088/v1/skills/weather-report-writing/versions/1.0.0/download
```

Published package responses include:

- `X-MeteoMate-Digest`;
- `X-MeteoMate-Signature`;
- `X-MeteoMate-Key-Id`.

Public signing keys are available from `GET /v1/trust/keys`.

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `METEOMATE_SKILLHUB_ADDR` | `127.0.0.1:8088` | HTTP listen address |
| `METEOMATE_SKILLHUB_DATA` | `./data` | metadata, packages, trust keys, and audit log |
| `METEOMATE_SKILLHUB_TOKENS` | empty | JSON object mapping bearer tokens to actors |
| `METEOMATE_SKILLHUB_SEED_DIR` | empty | optional directory containing one Skill per child directory |

When no tokens are configured, public read APIs remain available but all write APIs are disabled.

## Data layout

```text
data/
├── metadata.json
├── audit.jsonl
├── packages/
│   └── sha256/<digest>.zip
└── trust/
    └── ed25519.json
```

The private signing key is generated with file mode `0600`. Back up the `trust` directory before moving a production SkillHub instance.

## API overview

```text
GET    /healthz
GET    /v1/me
GET    /v1/trust/keys
GET    /v1/skills
GET    /v1/skills/{id}
GET    /v1/skills/{id}/versions/{version}
GET    /v1/skills/{id}/versions/{version}/download
POST   /v1/packages/inspect
POST   /v1/skills/{id}/versions
POST   /v1/skills/{id}/versions/{version}/publish
POST   /v1/skills/{id}/versions/{version}/deprecate
GET    /v1/collections
PUT    /v1/collections/{id}
GET    /v1/recommendations
GET    /v1/installations
POST   /v1/installations
DELETE /v1/installations/{id}
```

## Production evolution

The current file store is suitable for an internal pilot and small team. The `store.Store` boundary is deliberately isolated so a later release can add:

- PostgreSQL metadata and transactions;
- MinIO / S3 package storage;
- organization SSO and OAuth/OIDC;
- asynchronous malware scanning and human review;
- publisher key management and package transparency logs;
- ratings, comments, usage analytics, and moderation queues.
