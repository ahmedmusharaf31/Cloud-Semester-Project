#!/usr/bin/env bash
set -euo pipefail
DURATION_S=${1:-180}     # default: 3 minutes
LATENCY_MS=${2:-500}     # default: 500 ms

CLEAN_TD_ARN=$(aws ecs describe-task-definition --task-definition ce-408-orders \
  --query "taskDefinition.taskDefinitionArn" --output text)
echo "Clean task def: $CLEAN_TD_ARN"

# Re-register the same task def with CHAOS_LATENCY_MS injected
aws ecs describe-task-definition --task-definition ce-408-orders \
  --query "taskDefinition" \
  | python -c "
import json, sys
data = json.load(sys.stdin)
ms = '$LATENCY_MS'
env = data['containerDefinitions'][0].get('environment', [])
env.append({'name': 'CHAOS_LATENCY_MS', 'value': ms})
data['containerDefinitions'][0]['environment'] = env
for k in ['taskDefinitionArn','revision','status','requiresAttributes','compatibilities','registeredAt','registeredBy']:
    data.pop(k, None)
print(json.dumps(data))
" > ./orders-chaos.json
CHAOS_TD=$(aws ecs register-task-definition --cli-input-json file://orders-chaos.json \
  --query "taskDefinition.taskDefinitionArn" --output text)
echo "Chaos task def: $CHAOS_TD"

aws ecs update-service --cluster ce-408-cluster --service ce-408-orders \
  --task-definition $CHAOS_TD --force-new-deployment
echo "${LATENCY_MS}ms latency injected on Orders. Holding for ${DURATION_S}s..."
sleep $DURATION_S

echo "Rolling back to clean task def..."
aws ecs update-service --cluster ce-408-cluster --service ce-408-orders \
  --task-definition $CLEAN_TD_ARN --force-new-deployment
echo "Rolled back. Latency should return to baseline within ~60s."
