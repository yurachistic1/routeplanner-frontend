#!/bin/zsh
# Publishes firestore.rules to the runthe-app Firebase project.
set -euo pipefail
cd "$(dirname "$0")/.."
P=runthe-app
API=https://firebaserules.googleapis.com/v1/projects/${P}
H=(-H "Authorization: Bearer $(gcloud auth print-access-token)" -H "X-Goog-User-Project: ${P}" -H "Content-Type: application/json")

body=$(python3 -c 'import json; print(json.dumps({"source":{"files":[{"name":"firestore.rules","content":open("firestore.rules").read()}]}}))')
ruleset=$(curl -fsS -X POST "${H[@]}" -d "$body" "${API}/rulesets" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')

release=projects/${P}/releases/cloud.firestore
payload="{\"release\":{\"name\":\"${release}\",\"rulesetName\":\"${ruleset}\"}}"
# Update the live release, or create it the first time.
curl -fsS -X PATCH "${H[@]}" -d "$payload" "${API}/releases/cloud.firestore" >/dev/null \
  || curl -fsS -X POST "${H[@]}" -d "{\"name\":\"${release}\",\"rulesetName\":\"${ruleset}\"}" "${API}/releases" >/dev/null
echo "Live: ${ruleset}"
