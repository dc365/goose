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
- administrator installation governance with version distribution, active-client, project, and pending-upgrade statistics;
- managed intranet users with `viewer`, `publisher`, and `admin` roles;
- Argon2id password hashing and revocable in-memory desktop sessions;
- embedded `/admin/` console for Experts, Skills, content operations, governance, users, policies, and audit records;
- organization, role, and user policy delivery for desktop model, Skill, Connector, and permission controls;
- organization Skill allowlists and optional administrator approval before publication;
- owner-scoped Skill management with administrator ownership transfer;
- owner-scoped Expert registry with immutable revisions and optimistic concurrency;
- private, organization, and public Expert visibility with desktop offline synchronization;
- administrator review, stable percentage or allowlist distribution, lifecycle control, and revision rollback for managed Experts;
- failed-login throttling and last-active-administrator protection;
- append-only JSONL audit log;
- optional seeding from MeteoMate bundled Skills.

Bundled seeding is idempotent only when the package digest is unchanged. A changed package with the same `skillId@version` is rejected; update `meteomate.json` to a newer version before seeding again. The seed reads display name, icon, categories, and tags from that sidecar so the desktop fallback catalog and SkillHub catalog share one metadata source.

## Run locally

从 MeteoMate 产品目录可直接启动：

```bash
cd products/meteo-office-desktop
npm run skillhub:start
```

首次创建管理员时，先按下方方式配置启动环境变量。

```bash
cd products/meteo-office-desktop/services/skillhub

export METEOMATE_SKILLHUB_BOOTSTRAP_USERNAME=admin
export METEOMATE_SKILLHUB_BOOTSTRAP_PASSWORD='replace-this-password'
export METEOMATE_SKILLHUB_BOOTSTRAP_NAME='系统管理员'

go run ./cmd/skillhub \
  -addr 127.0.0.1:8088 \
  -data ./data \
  -seed-dir ../../bundled-skills
```

Health check:

```bash
curl http://127.0.0.1:8088/healthz
```

Open the administration console:

```text
http://127.0.0.1:8088/admin/
```

The console does not use email, public registration, cookies, or browser password storage. Its bearer session exists only in the current page memory. Closing or refreshing the page requires another login.

The bootstrap account is created only when the user store is empty. Remove the bootstrap password from the environment after the first successful start. The bootstrap administrator must change the temporary password at first login.

Create an intranet user from the administration backend after logging in:

```bash
export METEOMATE_SKILLHUB_SESSION_TOKEN='<sessionToken returned by /v1/auth/login>'
curl -X POST http://127.0.0.1:8088/v1/admin/users \
  -H "Authorization: Bearer ${METEOMATE_SKILLHUB_SESSION_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"username":"forecaster","displayName":"值班预报员","password":"temporary-password","role":"publisher","orgId":"meteomate","mustChangePassword":true}'
```

The bundled Compose configuration also requires an explicit bootstrap password:

```bash
export METEOMATE_SKILLHUB_BOOTSTRAP_PASSWORD='replace-this-password'
docker compose up --build
```

Desktop login:

```bash
curl -X POST http://127.0.0.1:8088/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"forecaster","password":"temporary-password","clientId":"meteomate-desktop"}'
```

Public search:

```bash
curl 'http://127.0.0.1:8088/v1/skills?q=weather'
```

## Administration behavior

- Five failed logins for the same username and source address cause a five-minute block.
- Disabling a user, resetting a password, or choosing **退出所有设备** revokes the user's active sessions immediately.
- The last active managed administrator cannot be disabled or demoted.
- Temporary passwords are generated in the administration page, shown once, and never written to SkillHub logs.
- Audit records include login results, user changes, session revocation, and Skill lifecycle operations.
- User content, desktop conversations, local projects, and Connector secrets are not uploaded to the administration service.
- Publishers manage only their own Skill records; administrators can manage all records and transfer ownership to another active publisher or administrator.
- Organization policy can keep publisher-direct releases or route publisher submissions into the administrator review queue. High-risk packages always enter review.
- Default Skills are constrained by the effective Skill allowlist before policy delivery to the desktop.

For access from other computers, put SkillHub behind an internal HTTPS reverse proxy. Plain HTTP is suitable only for loopback development because login passwords otherwise travel unencrypted on the network.

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

When `skillPublishMode` is `admin_approval`, a publisher receives `202 Accepted` and the version enters `pending_review`. An administrator approves it with the same publish endpoint or returns it to draft with:

```bash
curl -X POST \
  -H 'Authorization: Bearer <admin-session-token>' \
  -H 'Content-Type: application/json' \
  -d '{"note":"补充兼容性说明后重新提交"}' \
  http://127.0.0.1:8088/v1/skills/weather-report-writing/versions/1.0.0/reject
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
| `METEOMATE_SKILLHUB_BOOTSTRAP_USERNAME` | empty | first administrator username when the user store is empty |
| `METEOMATE_SKILLHUB_BOOTSTRAP_PASSWORD` | empty | first administrator temporary password; remove after bootstrap |
| `METEOMATE_SKILLHUB_BOOTSTRAP_NAME` | username | first administrator display name |
| `METEOMATE_SKILLHUB_SEED_DIR` | empty | optional directory containing one Skill per child directory |

When neither managed accounts nor static service tokens are configured, public read APIs remain available but authenticated write APIs are unavailable.

## Data layout

```text
data/
├── auth/
│   └── users.json
├── policy/
│   └── policies.json
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
POST   /v1/auth/login
POST   /v1/auth/logout
GET    /v1/me
PATCH  /v1/me
POST   /v1/me/password
GET    /v1/me/policy
GET    /v1/admin/users
POST   /v1/admin/users
PATCH  /v1/admin/users/{id}
POST   /v1/admin/users/{id}/reset-password
POST   /v1/admin/users/{id}/revoke-sessions
GET    /v1/admin/sessions
DELETE /v1/admin/sessions/{id}
GET    /v1/admin/audit
GET    /v1/admin/policies
PUT    /v1/admin/policies/organization
PUT    /v1/admin/policies/roles/{role}
DELETE /v1/admin/policies/roles/{role}
PUT    /v1/admin/policies/users/{id}
DELETE /v1/admin/policies/users/{id}
GET    /v1/admin/policies/effective/users/{id}
GET    /v1/trust/keys
GET    /v1/experts
POST   /v1/experts
GET    /v1/experts/{id}
PUT    /v1/experts/{id}
POST   /v1/experts/{id}/submit-review
POST   /v1/experts/{id}/review
POST   /v1/experts/{id}/status
PUT    /v1/experts/{id}/distribution
GET    /v1/experts/{id}/revisions
GET    /v1/experts/{id}/revisions/{revision}
POST   /v1/experts/{id}/rollback/{revision}
GET    /v1/skills
GET    /v1/skills/{id}
PATCH  /v1/skills/{id}
GET    /v1/skills/{id}/versions/{version}
GET    /v1/skills/{id}/versions/{version}/download
POST   /v1/packages/inspect
POST   /v1/skills/{id}/versions
POST   /v1/skills/{id}/versions/{version}/publish
POST   /v1/skills/{id}/versions/{version}/reject
POST   /v1/skills/{id}/versions/{version}/deprecate
GET    /v1/collections
PUT    /v1/collections/{id}
DELETE /v1/collections/{id}
GET    /v1/admin/recommendation-rules
PUT    /v1/admin/recommendation-rules/{id}
DELETE /v1/admin/recommendation-rules/{id}
PUT    /v1/admin/featured-placements
GET    /v1/recommendations
GET    /v1/installations
POST   /v1/installations
DELETE /v1/installations/{id}
GET    /v1/admin/installations/summary
```

## Production evolution

The current file store is suitable for an internal pilot and small team. The `store.Store` boundary is deliberately isolated so a later release can add:

- PostgreSQL metadata and transactions;
- MinIO / S3 package storage;
- organization SSO and OAuth/OIDC;
- asynchronous malware scanning and multi-stage review;
- publisher key management and package transparency logs;
- ratings, comments, usage analytics, and moderation queues.
