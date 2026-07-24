# MeteoMate managed runtimes

MeteoMate runs the pinned `@playwright/mcp` application dependency with Electron's embedded Node.js runtime. It does not require a user-installed Node.js or `npx` in packaged builds.

`npm run runtime:prepare` installs Chromium into `runtime/browsers/`, downloads the pinned Cua Driver executable into `runtime/cua-driver/<platform>-<arch>/`, prepares the isolated Python and LibreOffice Office Runtime under `runtime/office/<platform>-<arch>/`, and writes generated runtime manifests before packaging. Cua release archives are verified against the SHA-256 values published with the pinned GitHub release. Office Runtime critical entry points are recorded with SHA-256 values in its manifest. Generated binaries and manifests are not committed.

The Cua downloader uses the system `curl`, so `http_proxy`, `https_proxy`, and `no_proxy` are honored. It retries transient failures and resumes the cached partial archive. Set `METEOMATE_CUA_DRIVER_DOWNLOAD_BASE_URL` to an HTTPS release mirror when GitHub is unavailable; the pinned SHA-256 verification still applies.

An optional standalone Node.js distribution may be supplied at `runtime/node/<platform>-<arch>/`. The resolver prefers that distribution when present, then developer overrides, then Electron's embedded Node.js. System `npx` is only available as a development fallback or when `METEOMATE_ALLOW_SYSTEM_BROWSER_RUNTIME=1` is explicitly set.

Packaged desktop automation uses Cua Driver's embedded-host mode. MeteoMate owns the macOS permission identity, starts a private daemon, disables Cua telemetry and update checks, and exposes only the product allowlist through stdio MCP. A developer may set `METEOMATE_CUA_DRIVER_PATH` to a compatible executable; system fallback is limited to development unless `METEOMATE_ALLOW_SYSTEM_COMPUTER_RUNTIME=1` is explicitly set.

The Office Connector exposes a fixed DOCX/PPTX/XLSX/PDF tool allowlist through a local stdio MCP host. Packaged builds require the prepared Office Runtime and fail closed when its manifest, Python dependencies, or critical binaries are missing or invalid. Developers may use `METEOMATE_PYTHON_PATH` and `METEOMATE_SOFFICE_PATH`; system fallback is limited to development unless `METEOMATE_ALLOW_SYSTEM_OFFICE_RUNTIME=1` is explicitly set.

Release builds must set `METEOMATE_PYTHON_HOME_PATH` to a complete relocatable Python distribution and `METEOMATE_LIBREOFFICE_APP_PATH` to the LibreOffice application root before running `npm run runtime:prepare:office`. The preparation step copies both runtimes into the product, installs the locked Python packages with the copied runtime's `PYTHONHOME`, and records the provisioning mode and critical-file hashes in `manifest.json`. A virtual environment created from the build host is accepted only for development preparation and must not be used as a release artifact.
