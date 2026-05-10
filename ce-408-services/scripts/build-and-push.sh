#!/usr/bin/env bash
set -euo pipefail
: "${AWS_REGION:?}"; : "${ACCOUNT_ID:?}"
REGISTRY=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $REGISTRY
for svc in catalog cart orders; do
  echo "=== Building $svc ==="
  docker build -t ce-408/$svc:latest ./$svc
  docker tag ce-408/$svc:latest $REGISTRY/ce-408/$svc:latest
  docker push $REGISTRY/ce-408/$svc:latest
done
