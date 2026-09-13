#!/bin/sh
# Check the public proxy chain without credentials or changes to task data.
set -eu

base=${1:?Usage: sh deploy/check-origin.sh http://server:27182}
base=${base%/}

check() {
    origin=$1
    expected=$2
    actual=$(curl --silent --show-error --max-time 10 --output /dev/null \
        --write-out '%{http_code}' --request POST "$base/api/v1/tasks/0/move" \
        --header "Origin: $origin" --header 'Content-Type: application/json' \
        --data '{"status":"todo"}')
    if [ "$actual" != "$expected" ]; then
        echo "FAIL: Origin $origin: expected HTTP $expected, got $actual" >&2
        exit 1
    fi
    echo "PASS: Origin $origin: HTTP $actual"
}

# Same-origin requests must reach authentication (401), not fail CSRF (403).
# No cookie/token is sent, so neither probe can move a task.
check "$base" 401
check 'http://cross-origin.invalid' 403
