#!/usr/bin/env bash
# Signs a demo user in through Thunder's hosted-login flow API and prints an access token, the same token the
# web app gets after the browser login. For scripts only: ./scripts/token.sh ann@example.com
set -euo pipefail
USER_ID="$1"; PASSWORD="${2:-demo12345}"
IDP=${IDP:-https://localhost:8095}
CLIENT=${CLIENT:-claims-web}
REDIRECT=${REDIRECT:-http://localhost:8080/callback/}
py() { python3 -c "$@"; }
VERIFIER=$(py "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode())")
CHALLENGE=$(py "import hashlib,base64,sys;print(base64.urlsafe_b64encode(hashlib.sha256(sys.argv[1].encode()).digest()).rstrip(b'=').decode())" "$VERIFIER")
ENC_REDIRECT=$(py "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$REDIRECT")
LOC=$(curl -sk -D - -o /dev/null "$IDP/oauth2/authorize?response_type=code&client_id=$CLIENT&redirect_uri=$ENC_REDIRECT&scope=openid%20profile%20email%20groups&state=s&code_challenge=$CHALLENGE&code_challenge_method=S256" | grep -i '^location' | tr -d '\r')
EXEC=$(echo "$LOC" | sed 's/.*executionId=\([^&]*\).*/\1/')
AUTH=$(echo "$LOC" | sed 's/.*authId=\([^&]*\).*/\1/')
STEP=$(curl -sk -X POST "$IDP/flow/execute" -H 'content-type: application/json' -d "{\"executionId\":\"$EXEC\"}")
CHALLENGE_TOKEN=$(echo "$STEP" | py "import sys,json;print(json.load(sys.stdin)['challengeToken'])")
DONE=$(curl -sk -X POST "$IDP/flow/execute" -H 'content-type: application/json' -d "{\"executionId\":\"$EXEC\",\"challengeToken\":\"$CHALLENGE_TOKEN\",\"action\":\"action_001\",\"inputs\":{\"username\":\"$USER_ID\",\"password\":\"$PASSWORD\"}}")

ASSERTION=$(echo "$DONE" | py "import sys,json;print(json.load(sys.stdin)['assertion'])")
CB=$(curl -sk -X POST "$IDP/oauth2/auth/callback" -H 'content-type: application/json' -d "{\"authId\":\"$AUTH\",\"assertion\":\"$ASSERTION\"}")
CODE=$(echo "$CB" | py "import sys,json,urllib.parse as u;print(u.parse_qs(u.urlparse(json.load(sys.stdin)['redirect_uri']).query)['code'][0])")
curl -sk -X POST "$IDP/oauth2/token" -d grant_type=authorization_code -d "code=$CODE" -d "redirect_uri=$REDIRECT" \
    -d "client_id=$CLIENT" -d "code_verifier=$VERIFIER" | py "import sys,json;print(json.load(sys.stdin)['access_token'])"
