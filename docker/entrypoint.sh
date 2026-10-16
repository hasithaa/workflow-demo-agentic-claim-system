#!/usr/bin/env bash
# Runs a Ballerina service with its mounted Config.toml. With ICP_SECRET_FILE set, it first waits for the
# Integration Control Plane secret (minted by icp-seed on first start) and adds the ICP bridge settings.
set -euo pipefail
FILES=/app/config/Config.toml
# The model provider settings live in their own file, so the access token stays out of the shared config.
[ -s /app/config/model.toml ] && MODEL=":/app/config/model.toml" || MODEL=""

if [ -n "${ICP_SECRET_FILE:-}" ]; then
    echo "[entrypoint] waiting for the ICP secret at ${ICP_SECRET_FILE}"
    for _ in $(seq 1 120); do [ -s "$ICP_SECRET_FILE" ] && break; sleep 5; done
    [ -s "$ICP_SECRET_FILE" ] || { echo "[entrypoint] no ICP secret after 10 minutes; check: docker compose logs icp-seed" >&2; exit 1; }
    cat > /tmp/icp.toml <<TOML
[wso2.icp.runtime.bridge]
serverUrl = "${ICP_SERVER_URL:-https://icp:9445}"
secret = "$(cat "$ICP_SECRET_FILE")"
project = "${ICP_PROJECT:?ICP_PROJECT is required}"
integration = "${ICP_INTEGRATION:?ICP_INTEGRATION is required}"
environment = "${ICP_ENVIRONMENT:-dev}"
runtimeHostUrl = "${ICP_RUNTIME_HOST_URL:-http://localhost}"
TOML
    FILES="$FILES:/tmp/icp.toml"
    # The ICP console reaches the Workflow Management API with the same secret as an API key (its human-task pages);
    # add it to the API's settings in a copy of the mounted Config.toml.
    if grep -q '^\[ballerina.workflow.management.rest\]' /app/config/Config.toml; then
        sed "/^\[ballerina.workflow.management.rest\]/a enableApiKey = true\\
apiKeyValue = \"$(cat "$ICP_SECRET_FILE")\"" /app/config/Config.toml > /tmp/Config.toml
        FILES="/tmp/Config.toml:/tmp/icp.toml"
    fi
fi

export BAL_CONFIG_FILES="$FILES$MODEL"
exec java -jar /app/app.jar
