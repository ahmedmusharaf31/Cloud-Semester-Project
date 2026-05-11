#!/usr/bin/env bash
set -euo pipefail
SVC=${1:-catalog}
CLUSTER=ce-408-cluster
TASK=$(aws ecs list-tasks --cluster $CLUSTER \
  --service-name ce-408-$SVC \
  --query "taskArns[0]" --output text)
[ "$TASK" = "None" ] && { echo "no running task for $SVC"; exit 1; }
echo "Killing $TASK"
aws ecs stop-task --cluster $CLUSTER --task "$TASK" \
  --reason "chaos: scripted task termination"
echo "Stopped. Watch the dashboard — ALB target should mark unhealthy within ~30s,"
echo "and ECS should restore baseline within ~90s."
