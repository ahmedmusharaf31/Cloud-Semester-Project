# CE-408 — Auto-Scaling E-Commerce Backend with Chaos Engineering

| | |
|---|---|
| **Members** | Ahmed Musharaf (2022067) · Abdullah Saeed (2022329) · Abdullah Zafar (2022328) |
| **Instructor** | Miss Safia Baloch |
| **Semester** | 8th |
| **Course** | Cloud Computing (CE-408) |
| **Inspiration** | https://aws.amazon.com/blogs/architecture/chaos-engineering-in-the-cloud/ |
| **Live Demo** | http://ce-408-storefront-470337543459.s3-website-us-east-1.amazonaws.com/ |

Build and run guide for the revised proposal (`CE408_Project_Proposal_Revised.md`).
All resource IDs live in `vars.sh` — run `source vars.sh` at the start of every session.

---

## 1. Architecture

```
   Browser ──► S3 Storefront (GIKI Mart)
                     │ fetch()
                     ▼
   k6 EC2  ──►  ALB (ce-408-alb)
                     │
                     ├──  /catalog/*  ──►  Catalog Fargate  ──►  RDS Postgres (catalog DB)
                     ├──  /cart/*     ──►  Cart    Fargate  ──►  DynamoDB (ce-408-cart-sessions)
                     └──  /orders/*   ──►  Orders  Fargate  ──►  RDS Postgres (orders DB)
                                                                        │
                                                                        ▼
                                                                  SQS (ce-408-orders-fulfilment)

   chaos/kill-task.sh  ──►  ECS task termination
   chaos/latency.sh    ──►  500ms latency injection via env-var rollout
   CloudWatch          ──►  metrics, logs, 3 alarms, 4-widget dashboard (ce-408)
```

### Service Mapping

| Service | Compute | Data Store | Key Endpoints |
|---|---|---|---|
| Catalog | Fargate 0.25 vCPU / 0.5 GB | RDS Postgres `catalog` DB | `GET /catalog/products`, `GET /catalog/products/{sku}` |
| Cart | Fargate 0.25 vCPU / 0.5 GB | DynamoDB `ce-408-cart-sessions` | `GET/POST /cart/sessions/{userId}/items` |
| Orders | Fargate 0.25 vCPU / 0.5 GB | RDS Postgres `orders` DB + SQS | `POST /orders` |

### API Contract

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/catalog/products` | — | `[{id, sku, name, price_cents, inventory}]` |
| `GET` | `/catalog/products/{sku}` | — | `{id, sku, name, price_cents, inventory}` |
| `GET` | `/cart/sessions/{userId}` | — | `{userId, items: [{sku, qty}]}` |
| `POST` | `/cart/sessions/{userId}/items` | `{sku, qty}` | accumulates qty on existing line |
| `PUT` | `/cart/sessions/{userId}/items/{sku}` | `{qty}` | sets absolute qty; `0` removes line |
| `DELETE` | `/cart/sessions/{userId}` | — | clears cart |
| `POST` | `/orders` | `{userId, items: [{sku, qty}]}` | `{orderId, total_cents, status}` |

### What's Deferred to Future Work

CloudFront, Route 53, Cognito, ElastiCache, X-Ray, React frontend, AZ-failure chaos, AWS FIS integration. See proposal §6.

---

## 2. Prerequisites

### 2.1 Local Tools

| Tool | Purpose | Verify |
|---|---|---|
| AWS CLI v2 | All AWS API calls | `aws --version` → `aws-cli/2.x` |
| Docker Desktop | Build & push container images | `docker --version` |
| Python 3.11+ | Service code | `python --version` |
| Git Bash | Shell scripts (bash syntax) | `bash --version` |

```bash
aws configure
# AWS Access Key ID:     <IAM user key>
# AWS Secret Access Key: <secret>
# Default region name:   us-east-1
# Default output format: json
```

### 2.2 Shell Variables

Source at the start of every session:

```bash
source vars.sh
```

`vars.sh` contains all resource IDs (VPC, subnets, SGs, endpoints, ARNs). Never commit it — it's in `.gitignore`.

---

## 3. Phase 1 — Foundation

### 3.1 VPC

AWS Console → VPC → **"Create VPC and more"**:

- Name prefix: `ce-408`
- IPv4 CIDR: `10.0.0.0/16`
- AZs: **2**, Public subnets: **2**, Private subnets: **2**
- NAT Gateway: **In 1 AZ only** (single NAT saves cost)
- VPC endpoints: none

Tag the VPC and capture subnet IDs:

```bash
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=ce-408-vpc" \
  --query "Vpcs[0].VpcId" --output text)
aws ec2 create-tags --resources $VPC_ID --tags Key=Project,Value=ce-408

# List subnets — capture public/private IDs into vars.sh
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[].{ID:SubnetId,Name:Tags[?Key=='Name']|[0].Value,Public:MapPublicIpOnLaunch}" \
  --output table
```

### 3.2 Security Groups

Three SGs chained so each tier only accepts traffic from the previous tier:

```bash
# ALB SG — open port 80 to internet
ALB_SG=$(aws ec2 create-security-group --group-name ce-408-alb-sg \
  --description "ALB ingress" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 create-tags --resources $ALB_SG --tags Key=Project,Value=ce-408

# Service SG — only ALB can reach port 8000
SVC_SG=$(aws ec2 create-security-group --group-name ce-408-svc-sg \
  --description "Fargate services" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SVC_SG \
  --protocol tcp --port 8000 --source-group $ALB_SG
aws ec2 create-tags --resources $SVC_SG --tags Key=Project,Value=ce-408

# RDS SG — only services can reach port 5432
RDS_SG=$(aws ec2 create-security-group --group-name ce-408-rds-sg \
  --description "RDS Postgres" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG \
  --protocol tcp --port 5432 --source-group $SVC_SG
aws ec2 create-tags --resources $RDS_SG --tags Key=Project,Value=ce-408
```

### 3.3 IAM Roles

Two roles: one for ECS task execution (pull images, write logs), one for runtime permissions (DynamoDB + SQS):

```bash
cat > trust-ecs.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole" } ] }
EOF

# Execution role
aws iam create-role --role-name ce-408-ecs-exec \
  --assume-role-policy-document file://trust-ecs.json
aws iam attach-role-policy --role-name ce-408-ecs-exec \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam attach-role-policy --role-name ce-408-ecs-exec \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess

# Task role (least-privilege: only what services need)
aws iam create-role --role-name ce-408-task-role \
  --assume-role-policy-document file://trust-ecs.json
cat > task-policy.json <<EOF
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow",
    "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem"],
    "Resource": "arn:aws:dynamodb:us-east-1:$ACCOUNT_ID:table/ce-408-cart-sessions" },
  { "Effect": "Allow",
    "Action": ["sqs:SendMessage","sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"],
    "Resource": "arn:aws:sqs:us-east-1:$ACCOUNT_ID:ce-408-orders-fulfilment" }
] }
EOF
aws iam put-role-policy --role-name ce-408-task-role \
  --policy-name ce-408-task-inline --policy-document file://task-policy.json
```

### 3.4 ECR Repositories

```bash
for svc in catalog cart orders; do
  aws ecr create-repository --repository-name ce-408/$svc \
    --image-scanning-configuration scanOnPush=true \
    --tags Key=Project,Value=ce-408
done
```

### 3.5 Verification

```bash
aws ec2 describe-vpcs --filters "Name=tag:Project,Values=ce-408" --query "Vpcs[].VpcId"
aws ecr describe-repositories --query "repositories[].repositoryName"
aws iam list-roles --query "Roles[?starts_with(RoleName,'ce-408')].RoleName"
```

Expected: 1 VPC, 3 ECR repos, 2 IAM roles.

---

## 4. Phase 2 — Data Layer

### 4.1 RDS PostgreSQL

```bash
# Generate a strong password and save it in vars.sh
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
echo "export DB_PASSWORD=$DB_PASSWORD" >> vars.sh

# DB subnet group across the 2 private subnets
aws rds create-db-subnet-group \
  --db-subnet-group-name ce-408-db-subnets \
  --db-subnet-group-description "ce-408 RDS subnets" \
  --subnet-ids $PRIV_SUBNET_1 $PRIV_SUBNET_2

# Single AZ, smallest burstable instance
aws rds create-db-instance \
  --db-instance-identifier ce-408-postgres \
  --db-instance-class db.t4g.micro --engine postgres --engine-version 16.3 \
  --master-username ce408admin --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 --storage-type gp3 \
  --vpc-security-group-ids $RDS_SG \
  --db-subnet-group-name ce-408-db-subnets \
  --no-publicly-accessible --backup-retention-period 1 \
  --tags Key=Project,Value=ce-408

# Wait ~10–15 min
aws rds wait db-instance-available --db-instance-identifier ce-408-postgres

RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier ce-408-postgres \
  --query "DBInstances[0].Endpoint.Address" --output text)
echo $RDS_ENDPOINT   # add to vars.sh
```

### 4.2 Schema Bootstrap

Schema file `bootstrap.sql` creates two databases (`catalog`, `orders`), their tables, and seeds 3 products. Run it from the k6 EC2 once it's up (§9):

```bash
ssh -i ce-408-k6.pem ec2-user@$K6_PUBLIC_IP \
  "PGPASSWORD='$DB_PASSWORD' psql -h $RDS_ENDPOINT -U ce408admin -d postgres -f -" \
  < bootstrap.sql
```

If databases/tables already exist, psql will print duplicate errors — these are harmless.

### 4.3 DynamoDB

On-demand billing — $0 when idle, no configuration needed after creation:

```bash
aws dynamodb create-table \
  --table-name ce-408-cart-sessions \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --tags Key=Project,Value=ce-408
```

Cart items are stored as a nested map `{sku: qty}` under the `items` attribute.

### 4.4 SQS

```bash
ORDERS_QUEUE_URL=$(aws sqs create-queue \
  --queue-name ce-408-orders-fulfilment \
  --attributes VisibilityTimeout=60,MessageRetentionPeriod=345600 \
  --tags Project=ce-408 \
  --query QueueUrl --output text)
echo $ORDERS_QUEUE_URL   # add to vars.sh
```

### 4.5 Store Config in SSM

Task definitions read secrets and endpoints from SSM at startup:

```bash
MSYS_NO_PATHCONV=1 aws ssm put-parameter \
  --name "/ce-408/rds/password" --type SecureString --value "$DB_PASSWORD" --overwrite
MSYS_NO_PATHCONV=1 aws ssm put-parameter \
  --name "/ce-408/rds/endpoint" --type String --value "$RDS_ENDPOINT" --overwrite
MSYS_NO_PATHCONV=1 aws ssm put-parameter \
  --name "/ce-408/sqs/orders-url" --type String --value "$ORDERS_QUEUE_URL" --overwrite
```

---

## 5. Phase 3 — Microservices

### 5.1 Repository Layout

```
ce-408-services/
├── catalog/
│   ├── app/main.py         FastAPI + asyncpg
│   ├── requirements.txt
│   └── Dockerfile
├── cart/
│   ├── app/main.py         FastAPI + boto3 DynamoDB
│   ├── requirements.txt
│   └── Dockerfile
├── orders/
│   ├── app/main.py         FastAPI + asyncpg + SQS + chaos latency middleware
│   ├── requirements.txt
│   └── Dockerfile
└── scripts/build-and-push.sh
```

### 5.2 Key Implementation Notes

**All three services** include:
```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
```
Required because the S3 storefront makes cross-origin requests to the ALB.

**Cart `add_item`** uses a two-step DynamoDB update to handle the case where the `items` map doesn't exist yet:
1. `if_not_exists` to initialise the map
2. Separate update to set `#it.#sku = :qty`

**Orders** includes a chaos latency middleware that sleeps `CHAOS_LATENCY_MS / 1000` seconds when the env var is set (default 0 — no overhead in production):
```python
CHAOS_LATENCY_MS = int(os.environ.get("CHAOS_LATENCY_MS", "0"))

@app.middleware("http")
async def inject_chaos_latency(request, call_next):
    if CHAOS_LATENCY_MS:
        await asyncio.sleep(CHAOS_LATENCY_MS / 1000)
    return await call_next(request)
```

### 5.3 Dockerfile Pattern

Same Dockerfile for all three services:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
```

### 5.4 Build and Push to ECR

```bash
cd ce-408-services
chmod +x scripts/build-and-push.sh
./scripts/build-and-push.sh
```

The script logs into ECR, builds all three images, and pushes to:
`470337543459.dkr.ecr.us-east-1.amazonaws.com/ce-408/<svc>:latest`

To rebuild and redeploy a single service after a code change:

```bash
cd ce-408-services
./scripts/build-and-push.sh
aws ecs update-service --cluster ce-408-cluster --service ce-408-<svc> \
  --force-new-deployment
aws ecs wait services-stable --cluster ce-408-cluster --services ce-408-<svc>
```

---

## 6. Phase 4 — Compute & Routing

### 6.1 ECS Cluster

```bash
aws ecs create-cluster --cluster-name ce-408-cluster \
  --capacity-providers FARGATE --tags key=Project,value=ce-408

# Per-service log groups with 7-day retention
for svc in catalog cart orders; do
  aws logs create-log-group --log-group-name "/ecs/ce-408-$svc"
  aws logs put-retention-policy --log-group-name "/ecs/ce-408-$svc" --retention-in-days 7
done
```

### 6.2 Task Definitions

Task definition JSON files are in the project root (`catalog-taskdef.json`, `cart-taskdef.json`, `orders-taskdef.json`). Each uses **0.25 vCPU / 512 MB**, pulls from ECR, reads `DB_PASSWORD` from SSM, and writes logs to CloudWatch.

```bash
aws ecs register-task-definition --cli-input-json file://catalog-taskdef.json
aws ecs register-task-definition --cli-input-json file://cart-taskdef.json
aws ecs register-task-definition --cli-input-json file://orders-taskdef.json
```

### 6.3 Application Load Balancer

```bash
ALB_ARN=$(aws elbv2 create-load-balancer --name ce-408-alb \
  --type application --scheme internet-facing \
  --subnets $PUB_SUBNET_1 $PUB_SUBNET_2 \
  --security-groups $ALB_SG --tags Key=Project,Value=ce-408 \
  --query "LoadBalancers[0].LoadBalancerArn" --output text)

# One target group per service — health check on /healthz
for svc in catalog cart orders; do
  aws elbv2 create-target-group --name ce-408-$svc-tg \
    --protocol HTTP --port 8000 --vpc-id $VPC_ID --target-type ip \
    --health-check-path "/healthz" --health-check-interval-seconds 15 \
    --tags Key=Project,Value=ce-408
done

# Default listener: 404 for unmatched paths
LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions Type=fixed-response,FixedResponseConfig='{StatusCode=404,ContentType=text/plain,MessageBody="not found"}' \
  --query "Listeners[0].ListenerArn" --output text)

# Path-based routing rules
aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 10 \
  --conditions Field=path-pattern,Values='/catalog/*' \
  --actions Type=forward,TargetGroupArn=$CATALOG_TG
aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 20 \
  --conditions Field=path-pattern,Values='/cart/*' \
  --actions Type=forward,TargetGroupArn=$CART_TG
aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 30 \
  --conditions Field=path-pattern,Values='/orders/*' \
  --actions Type=forward,TargetGroupArn=$ORDERS_TG
# Exact match for POST /orders (pattern /orders/* won't match a body-less path)
aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 31 \
  --conditions Field=path-pattern,Values='/orders' \
  --actions Type=forward,TargetGroupArn=$ORDERS_TG
```

### 6.4 ECS Services

```bash
for svc in catalog cart orders; do
  TG=$(aws elbv2 describe-target-groups --names ce-408-$svc-tg \
    --query "TargetGroups[0].TargetGroupArn" --output text)
  aws ecs create-service \
    --cluster ce-408-cluster --service-name ce-408-$svc \
    --task-definition ce-408-$svc \
    --desired-count 1 --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$PRIV_SUBNET_1,$PRIV_SUBNET_2],securityGroups=[$SVC_SG],assignPublicIp=DISABLED}" \
    --load-balancers "targetGroupArn=$TG,containerName=app,containerPort=8000" \
    --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}" \
    --tags key=Project,value=ce-408
done

# Wait for all three services to stabilize (5–10 min)
aws ecs wait services-stable --cluster ce-408-cluster \
  --services ce-408-catalog ce-408-cart ce-408-orders
```

### 6.5 Auto-Scaling (CPU Target Tracking)

Policy: scale out when average CPU > 60%, min 1 task / max 4 tasks per service.

```bash
for svc in catalog cart orders; do
  aws application-autoscaling register-scalable-target \
    --service-namespace ecs \
    --resource-id service/ce-408-cluster/ce-408-$svc \
    --scalable-dimension ecs:service:DesiredCount \
    --min-capacity 1 --max-capacity 4

  aws application-autoscaling put-scaling-policy \
    --service-namespace ecs \
    --resource-id service/ce-408-cluster/ce-408-$svc \
    --scalable-dimension ecs:service:DesiredCount \
    --policy-name cpu60 --policy-type TargetTrackingScaling \
    --target-tracking-scaling-policy-configuration '{
      "TargetValue": 60.0,
      "PredefinedMetricSpecification": {"PredefinedMetricType": "ECSServiceAverageCPUUtilization"},
      "ScaleOutCooldown": 60,
      "ScaleInCooldown": 120
    }'
done
```

> **Auto-scaling delay is expected:** CloudWatch evaluates CPU over ~3 consecutive minutes before the alarm fires, then Fargate takes ~2 min to provision the new task. Total detection-to-scale: **6–9 minutes**. This prevents thrashing on brief spikes.

### 6.6 Smoke Test

```bash
ALB_DNS=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].DNSName" --output text)

curl http://$ALB_DNS/catalog/products
curl http://$ALB_DNS/cart/sessions/u1
curl -X POST http://$ALB_DNS/orders \
  -H "content-type: application/json" \
  -d '{"userId":"u1","items":[{"sku":"SKU-001","qty":1}]}'
```

All three should return 200 with JSON bodies. The ALB root `/` returns 404 — expected.

---

## 7. Phase 5 — Storefront (S3)

Single-page HTML at `storefront/index.html` (GIKI Mart). No React, no build pipeline — one file, one bucket. Uses `__ALB_DNS__` as a placeholder replaced at deploy time.

### 7.1 Create S3 Bucket

```bash
BUCKET=ce-408-storefront-$ACCOUNT_ID
aws s3api create-bucket --bucket $BUCKET --region us-east-1
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
aws s3api put-bucket-policy --bucket $BUCKET --policy "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",
    \"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$BUCKET/*\"}]}"
aws s3 website s3://$BUCKET --index-document index.html
```

### 7.2 Deploy

```bash
ALB_DNS=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].DNSName" --output text)
sed "s/__ALB_DNS__/$ALB_DNS/g" storefront/index.html > storefront/index.deploy.html
aws s3 cp storefront/index.deploy.html s3://$BUCKET/index.html \
  --content-type "text/html" --cache-control "no-cache"
echo "Storefront: http://$BUCKET.s3-website-us-east-1.amazonaws.com"
```

### 7.3 Update Storefront

Edit `storefront/index.html`, then re-run the `sed` + `aws s3 cp` lines above. No build step needed. `cache-control: no-cache` ensures browsers fetch the latest version on reload.

---

## 8. Phase 6 — Observability

### 8.1 Enable Container Insights

Required for the **Task count per service** dashboard widget:

```bash
aws ecs update-cluster-settings --cluster ce-408-cluster \
  --settings name=containerInsights,value=enabled
```

Takes 2–3 minutes to start emitting data after enabling.

### 8.2 CloudWatch Dashboard

Four widgets: ECS CPU, ALB request count + 5xx, task count per service, RDS CPU + SQS depth.

```bash
cat > dashboard.json <<'EOF'
{
  "widgets": [
    {"type":"metric","x":0,"y":0,"width":12,"height":6,
      "properties":{"title":"ECS CPU per service","region":"us-east-1","metrics":[
        ["AWS/ECS","CPUUtilization","ServiceName","ce-408-catalog","ClusterName","ce-408-cluster"],
        ["...","ServiceName","ce-408-cart"],
        ["...","ServiceName","ce-408-orders"]],"stat":"Average","period":60}},
    {"type":"metric","x":12,"y":0,"width":12,"height":6,
      "properties":{"title":"ALB request count + 5xx","region":"us-east-1","metrics":[
        ["AWS/ApplicationELB","RequestCount","LoadBalancer","app/ce-408-alb/XXXX"],
        [".","HTTPCode_Target_5XX_Count",".","."]],"stat":"Sum","period":60}},
    {"type":"metric","x":0,"y":6,"width":12,"height":6,
      "properties":{"title":"Task count per service","region":"us-east-1","metrics":[
        ["ECS/ContainerInsights","RunningTaskCount","ServiceName","ce-408-catalog","ClusterName","ce-408-cluster"],
        ["...","ServiceName","ce-408-cart"],
        ["...","ServiceName","ce-408-orders"]],"stat":"Average","period":60}},
    {"type":"metric","x":12,"y":6,"width":12,"height":6,
      "properties":{"title":"RDS CPU & SQS depth","region":"us-east-1","metrics":[
        ["AWS/RDS","CPUUtilization","DBInstanceIdentifier","ce-408-postgres"],
        ["AWS/SQS","ApproximateNumberOfMessagesVisible","QueueName","ce-408-orders-fulfilment"]],"stat":"Average","period":60}}
  ]
}
EOF

# Git Bash on Windows: sed -i requires an explicit empty backup suffix
LB_SUFFIX=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].LoadBalancerArn" --output text | awk -F'loadbalancer/' '{print $2}')
sed -i "" "s|app/ce-408-alb/XXXX|$LB_SUFFIX|g" dashboard.json

aws cloudwatch put-dashboard --dashboard-name ce-408 \
  --dashboard-body file://dashboard.json
```

### 8.3 Alarms

```bash
# ALB 5xx error rate
aws cloudwatch put-metric-alarm --alarm-name ce-408-alb-5xx-high \
  --metric-name HTTPCode_Target_5XX_Count --namespace AWS/ApplicationELB \
  --statistic Sum --period 60 --threshold 10 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 --dimensions Name=LoadBalancer,Value=$LB_SUFFIX

# Unhealthy ALB targets
aws cloudwatch put-metric-alarm --alarm-name ce-408-unhealthy-targets \
  --metric-name UnHealthyHostCount --namespace AWS/ApplicationELB \
  --statistic Maximum --period 60 --threshold 0 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 --dimensions Name=LoadBalancer,Value=$LB_SUFFIX

# RDS CPU
aws cloudwatch put-metric-alarm --alarm-name ce-408-rds-cpu-high \
  --metric-name CPUUtilization --namespace AWS/RDS \
  --statistic Average --period 60 --threshold 80 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 --dimensions Name=DBInstanceIdentifier,Value=ce-408-postgres
```

---

## 9. Phase 7 — Load Generation (k6)

### 9.1 EC2 Setup

```bash
# Key pair
aws ec2 create-key-pair --key-name ce-408-k6 \
  --query "KeyMaterial" --output text > ce-408-k6.pem
chmod 400 ce-408-k6.pem

# Security group — SSH from your current IP only
MY_IP=$(curl -s ifconfig.me)
K6_SG=$(aws ec2 create-security-group --group-name ce-408-k6-sg \
  --description "k6 generator" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $K6_SG \
  --protocol tcp --port 22 --cidr $MY_IP/32

# Latest Amazon Linux 2023 AMI
AMI=$(aws ec2 describe-images --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023.*-x86_64" \
  --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text)

aws ec2 run-instances --image-id $AMI --instance-type t3.micro \
  --key-name ce-408-k6 --security-group-ids $K6_SG \
  --subnet-id $PUB_SUBNET_1 --associate-public-ip-address \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=ce-408},{Key=Name,Value=ce-408-k6}]"
```

> **Dynamic IP tip:** If SSH times out, your ISP may have rotated your IP since the SG rule was created. Get your current IP (`curl -s ifconfig.me`), revoke the old rule, and add a new one — or temporarily open to `0.0.0.0/0`, connect, then lock it back down.

```bash
K6_PUBLIC_IP=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=ce-408-k6" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
ssh -i ce-408-k6.pem ec2-user@$K6_PUBLIC_IP
```

On the instance, install tools:

```bash
sudo dnf install -y postgresql15
curl -L https://github.com/grafana/k6/releases/download/v0.52.0/k6-v0.52.0-linux-amd64.tar.gz | tar xz
sudo mv k6-v0.52.0-linux-amd64/k6 /usr/local/bin/
k6 version
```

Allow k6 SG to reach RDS (run from **local** Git Bash):

```bash
K6_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=ce-408-k6-sg" \
  --query "SecurityGroups[0].GroupId" --output text)
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG --protocol tcp --port 5432 --source-group $K6_SG
```

### 9.2 k6 Scripts

Create on the k6 EC2 (SSH session). Note: `$ALB_DNS` is not set inside SSH — paste the DNS value directly.

**`baseline.js`** — 20 VUs for 5 min, hits catalog + cart:

```javascript
import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  vus: 20, duration: '5m',
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] }
};
const ALB = __ENV.ALB;
export default function () {
  check(http.get(`${ALB}/catalog/products`), { 'catalog 200': (r) => r.status === 200 });
  sleep(1);
  check(http.get(`${ALB}/cart/sessions/u${__VU}`), { 'cart 200': (r) => r.status === 200 });
  sleep(1);
}
```

**`spike.js`** — flash-sale shape, ramps to 200 VUs, hammers orders:

```javascript
import http from 'k6/http';
export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '15s', target: 200 },
    { duration: '2m',  target: 200 },
    { duration: '1m',  target: 10 },
  ]
};
const ALB = __ENV.ALB;
export default function () {
  http.post(`${ALB}/orders`,
    JSON.stringify({userId:`u${__VU}`,items:[{sku:'SKU-001',qty:1}]}),
    { headers: { 'content-type': 'application/json' } });
}
```

**`stress.js`** — catalog-heavy, use this to trigger auto-scaling:

```javascript
import http from 'k6/http';
export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 100 },
    { duration: '1m', target: 0 },
  ]
};
const ALB = __ENV.ALB;
export default function () { http.get(`${ALB}/catalog/products`); }
```

Run:

```bash
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run baseline.js
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run spike.js
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run stress.js
```

### 9.3 Reference Results

| Test | VUs | Duration | Error rate | p95 latency | Throughput |
|---|---|---|---|---|---|
| Baseline | 20 | 5 min | 0% | 14ms | ~20 req/s |
| Spike (orders) | 200 peak | 3m45s | 0% | 9.3s | ~63 req/s |
| Stress (catalog) | 100 peak | 5 min | 0% | — | — |

Auto-scaling fired during `stress.js` — catalog task count went 1→2 after ~7 min of sustained high CPU.

---

## 10. Phase 8 — Chaos Experiments

Scripts are in `chaos/`. Run from **local** Git Bash (they call the AWS CLI). Before each experiment, start `baseline.js` in the SSH session so traffic is flowing during the event.

### 10.1 Experiment 1 — Task Termination (Catalog)

```bash
# SSH session — start baseline load
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run baseline.js

# Local Git Bash — kill the task
chmod +x chaos/kill-task.sh chaos/latency.sh
./chaos/kill-task.sh catalog
```

Watch CloudWatch dashboard:
- **Task count** drops from 1→0, recovers to 1 within ~90s
- **5xx count** stays at 0 (ALB drained connections before failing requests)

**Hypothesis:** ALB removes dead target within 30s; ECS restores task within 90s; 5xx < 1%.

**Actual result:** Task count 0→1 between 17:45–17:47, **0 5xx**, ~2 min full recovery.

### 10.2 Experiment 2 — Network Latency Injection (Orders, +500ms)

The chaos middleware is already in `orders/app/main.py` and deployed. `chaos/latency.sh` registers a new Orders task definition with `CHAOS_LATENCY_MS=500`, deploys it, holds for 180s, then auto-rolls back to the clean definition.

```bash
./chaos/latency.sh                  # 500ms for 3 min (default)
./chaos/latency.sh 300 1000         # 1000ms for 5 min
```

Poll orders response time while it runs:

```bash
while true; do
  curl -s -o /dev/null -w "%{time_total}s\n" \
    -X POST http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com/orders \
    -H "Content-Type: application/json" \
    -d '{"userId":"u1","items":[{"sku":"SKU-001","qty":1}]}'
  sleep 5
done
```

**Hypothesis:** Orders p95 rises from ~50ms to ~550ms; Cart/Catalog unaffected; auto-rollback restores baseline within 60s.

**Actual result:** Latency ~0.494s–1.057s (avg ~550ms, **11× baseline**), peak 3.6s during rolling deploy, **0 5xx**, Cart/Catalog unchanged.

### 10.3 Chaos Session Procedure (for Resilience Report)

Run this sequence for each experiment:

1. Start `baseline.js` on k6 EC2.
2. Wait 60s — confirm dashboard: 1 task/service, 5xx near zero, CPU stable.
3. Run the chaos script.
4. Note: time of first signal (task count dip / latency spike) and time of full recovery.
5. Stop k6.
6. Record metrics in `resilience-report.html` → print as `resilience-report.pdf`.

> **Why scripted chaos instead of AWS FIS?** FIS requires a paid AWS account tier. The same two experiments are implemented via direct ECS API calls — the CloudWatch dashboard signatures are identical to what FIS would produce. Task termination triggers ALB target replacement; env-var rollout injects latency on every Orders task. A FIS migration path is documented in Future Work (proposal §6).

---

## 11. Phase 9 — Demo Runbook (Viva)

**Duration: 5–8 minutes.** Full video guide with commands also in `demo.md`.

### Pre-Flight (5 min before)

Open on separate screens:
1. **CloudWatch** → Dashboards → `ce-408` (Last 30 min, auto-refresh 10s)
2. **Storefront** — S3 website URL (GIKI Mart)
3. **Git Bash** terminal in project root (SSH to k6 EC2 ready)

Start baseline load in SSH session and wait 60s:

```bash
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run baseline.js
```

---

### 0:00 — Architecture Overview (1 min)

Show the architecture diagram from §1.

*"Three microservices — Catalog, Cart, Orders — on ECS Fargate behind an Application Load Balancer. RDS PostgreSQL for transactional data, DynamoDB for session storage, SQS for order fulfilment events. All observable via this CloudWatch dashboard."*

---

### 1:00 — Normal Operation (1.5 min)

Switch to the storefront. Do live:
1. Browse the product catalog
2. Add 2 different items to cart
3. Place an order — show the success modal
4. Switch to CloudWatch — point at: **1 task per service, 0 5xx, ~14ms p95 latency**

*"Under 20 VUs, requests complete in under 14ms p95 with zero errors."*

---

### 2:30 — Auto-Scaling (2 min)

Stop baseline (Ctrl+C in SSH). Start stress test:

```bash
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run stress.js
```

Wait ~4 minutes. Point at CloudWatch: **ECS CPU climbs above 60% → task count 1→2**.

*"CPU crossed the 60% threshold. Auto-scaling fired — a second Catalog task spun up automatically. CloudWatch needs ~3 min of sustained CPU to confirm the alarm, then Fargate takes ~2 min to provision. Total: 6–9 min by design to prevent thrashing on brief spikes."*

---

### 4:30 — Chaos: Task Kill (1.5 min)

In local Git Bash:

```bash
./chaos/kill-task.sh catalog
```

Watch dashboard: task count dips to 0, recovers to 1 within ~2 min.

*"We just terminated the Catalog service. ECS detected it within 30s, the ALB drained connections before failing any requests, and a replacement task was running within 2 minutes — zero 5xx errors throughout."*

---

### 6:00 — Chaos: Latency Injection (1.5 min)

In local Git Bash:

```bash
./chaos/latency.sh 180 500
```

In another terminal, show the curl loop — response times jump from **~0.05s → ~0.55s**.

*"500ms of artificial latency injected into Orders. Response times jumped 11×. Cart and Catalog are completely unaffected — they don't call Orders synchronously. The script auto-rolls back after 3 minutes."*

---

### 7:30 — Wrap Up (30s)

Show `resilience-report.pdf`.

*"Both chaos experiments confirm zero user-visible errors under failure conditions, automatic recovery without manual intervention, and full fault isolation between services."*

---

### Key Numbers to Know

| Metric | Value |
|---|---|
| Baseline p95 latency | 14ms |
| Spike test (200 VUs) error rate | 0% |
| Task kill recovery time | ~2 min |
| Latency injection effect | 50ms → 550ms (11×) |
| Auto-scaling trigger | CPU > 60% sustained for ~3 min |
| Auto-scaling total time | 6–9 min (detection + provisioning) |

---

> Have **two backup screenshots** of a successful run (dashboard + storefront) in case AWS misbehaves on the day. A clickable storefront lands harder than a `curl` in front of the examiner.

---

Good luck with the submission! 😊
