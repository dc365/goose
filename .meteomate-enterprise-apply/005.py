from pathlib import Path
target = Path('products/meteo-office-desktop/services/skillhub/docker-compose.yml')
target.parent.mkdir(parents=True, exist_ok=True)
data = 'services:\n  control-plane:\n    build: .\n    ports:\n      - "8088:8088"\n    environment:\n      METEOMATE_BOOTSTRAP_ADMIN_USERNAME: ${METEOMATE_BOOTSTRAP_ADMIN_USERNAME:-admin}\n      METEOMATE_BOOTSTRAP_ADMIN_PASSWORD: ${METEOMATE_BOOTSTRAP_ADMIN_PASSWORD:?set METEOMATE_BOOTSTRAP_ADMIN_PASSWORD}\n      METEOMATE_BOOTSTRAP_ADMIN_NAME: ${METEOMATE_BOOTSTRAP_ADMIN_NAME:-MeteoMate Administrator}\n      METEOMATE_BOOTSTRAP_ADMIN_EMAIL: ${METEOMATE_BOOTSTRAP_ADMIN_EMAIL:-}\n      METEOMATE_BOOTSTRAP_ORG_SLUG: ${METEOMATE_BOOTSTRAP_ORG_SLUG:-meteomate}\n      METEOMATE_BOOTSTRAP_ORG_NAME: ${METEOMATE_BOOTSTRAP_ORG_NAME:-MeteoMate}\n      METEOMATE_SKILLHUB_TOKENS: ${METEOMATE_SKILLHUB_TOKENS:-{}}\n      METEOMATE_CONTROL_PLANE_PUBLIC_URL: ${METEOMATE_CONTROL_PLANE_PUBLIC_URL:-}\n    volumes:\n      - control-plane-data:/var/lib/meteomate-skillhub/data\n\nvolumes:\n  control-plane-data:\n'
with target.open('w', encoding='utf-8', newline='') as handle:
    handle.write(data)
