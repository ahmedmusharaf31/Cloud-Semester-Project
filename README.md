# CE-408 — Auto-Scaling E-Commerce Backend with Chaos Engineering

Build guide for the revised proposal (`CE408_Project_Proposal_Revised.md`).
All resource IDs are in `vars.sh` — run `source vars.sh` at the start of every session.

---

## 1. Architecture

```
   k6 EC2  ──►  ALB  ──►  /catalog/*  ──►  Catalog Fargate  ──►  RDS Postgres
                      ──►  /cart/*     ──►  Cart    Fargate  ──►  DynamoDB
                      ──►  /orders/*   ──►  Orders  Fargate  ──►  RDS Postgres + SQS

   chaos/kill-task.sh   ──►  task termination (ECS stop-task)
   chaos/latency.sh     ──►  latency injection (env-var rollout)
   CloudWatch           ──►  metrics, logs, alarms, dashboard (ce-408)
```

| Service | Compute | Data store |
|---|---|---|
| Catalog | Fargate (0.25 vCPU / 0.5 GB) | RDS Postgres `catalog` DB |
| Cart | Fargate (0.25 vCPU / 0.5 GB) | DynamoDB `ce-408-cart-sessions` |
| Orders | Fargate (0.25 vCPU / 0.5 GB) | RDS Postgres `orders` DB + SQS |

---

## 2. Prerequisites

| Tool | Verify |
|---|---|
| AWS CLI v2 | `aws --version` |
| Docker Desktop | `docker --version` |
| Python 3.11+ | `python --version` |
| Git Bash | `bash --version` |

```bash
aws configure
# Region: us-east-1 | Output: json
```

---

## 3. Phase 1 — Foundation

### 3.1 VPC

AWS Console → VPC → "Create VPC and more":
- Name prefix: `ce-408`, CIDR: `10.0.0.0/16`
- 2 AZs, 2 public + 2 private subnets, NAT Gateway: **1 AZ only**

```bash
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=ce-408-vpc" \
  --query "Vpcs[0].VpcId" --output text)
aws ec2 create-tags --resources $VPC_ID --tags Key=Project,Value=ce-408

# List subnets to capture IDs into vars.sh
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[].{ID:SubnetId,Name:Tags[?Key=='Name']|[0].Value,Public:MapPublicIpOnLaunch}" \
  --output table
```

### 3.2 Security Groups

```bash
# ALB SG — open port 80
ALB_SG=$(aws ec2 create-security-group --group-name ce-408-alb-sg \
  --description "ALB ingress" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG \
  --protocol tcp --port 80 --cidr 0.0.0.0/0

# Service SG — only ALB can reach 8000
SVC_SG=$(aws ec2 create-security-group --group-name ce-408-svc-sg \
  --description "Fargate services" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SVC_SG \
  --protocol tcp --port 8000 --source-group $ALB_SG

# RDS SG — only services can reach 5432
RDS_SG=$(aws ec2 create-security-group --group-name ce-408-rds-sg \
  --description "RDS Postgres" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG \
  --protocol tcp --port 5432 --source-group $SVC_SG
```

### 3.3 IAM Roles

```bash
cat > trust-ecs.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole" } ] }
EOF

aws iam create-role --role-name ce-408-ecs-exec \
  --assume-role-policy-document file://trust-ecs.json
aws iam attach-role-policy --role-name ce-408-ecs-exec \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam attach-role-policy --role-name ce-408-ecs-exec \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess

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

---

## 4. Phase 2 — Data Layer

### 4.1 RDS PostgreSQL

```bash
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
echo $DB_PASSWORD   # save this in vars.sh

aws rds create-db-subnet-group \
  --db-subnet-group-name ce-408-db-subnets \
  --db-subnet-group-description "ce-408 RDS subnets" \
  --subnet-ids $PRIV_SUBNET_1 $PRIV_SUBNET_2

aws rds create-db-instance \
  --db-instance-identifier ce-408-postgres \
  --db-instance-class db.t4g.micro --engine postgres --engine-version 16.3 \
  --master-username ce408admin --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 --storage-type gp3 \
  --vpc-security-group-ids $RDS_SG \
  --db-subnet-group-name ce-408-db-subnets \
  --no-publicly-accessible --backup-retention-period 1 \
  --tags Key=Project,Value=ce-408

aws rds wait db-instance-available --db-instance-identifier ce-408-postgres

RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier ce-408-postgres \
  --query "DBInstances[0].Endpoint.Address" --output text)
echo $RDS_ENDPOINT   # save in vars.sh
```

### 4.2 Bootstrap Schema

```bash
# Run from local Git Bash once k6 EC2 is up (§9)
ssh -i ce-408-k6.pem ec2-user@$K6_PUBLIC_IP \
  "PGPASSWORD='$DB_PASSWORD' psql -h $RDS_ENDPOINT -U ce408admin -d postgres -f -" \
  < bootstrap.sql
```

Schema is in `bootstrap.sql` — creates `catalog` and `orders` databases, tables, and seed products.

### 4.3 DynamoDB

```bash
aws dynamodb create-table \
  --table-name ce-408-cart-sessions \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --tags Key=Project,Value=ce-408
```

### 4.4 SQS

```bash
aws sqs create-queue --queue-name ce-408-orders-fulfilment \
  --attributes VisibilityTimeout=60,MessageRetentionPeriod=345600 \
  --tags Project=ce-408
```

---

## 5. Phase 3 — Microservices

### 5.1 Structure

```
ce-408-services/
├── catalog/app/main.py   (FastAPI + asyncpg, GET /catalog/products)
├── cart/app/main.py      (FastAPI + boto3 DynamoDB)
├── orders/app/main.py    (FastAPI + asyncpg + SQS + CHAOS_LATENCY_MS middleware)
├── */Dockerfile
├── */requirements.txt
└── scripts/build-and-push.sh
```

All services include `CORSMiddleware(allow_origins=["*"])` for the S3 storefront.

Orders service includes chaos latency middleware (activated by `CHAOS_LATENCY_MS` env var, default 0).

### 5.2 Dockerfile Pattern

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
```

### 5.3 Build and Push

```bash
cd ce-408-services
chmod +x scripts/build-and-push.sh
./scripts/build-and-push.sh
```

Script logs into ECR, builds all three images, and pushes to `470337543459.dkr.ecr.us-east-1.amazonaws.com/ce-408/<svc>:latest`.

---

## 6. Phase 4 — Compute & Routing

### 6.1 ECS Cluster

```bash
aws ecs create-cluster --cluster-name ce-408-cluster \
  --capacity-providers FARGATE --tags key=Project,value=ce-408

aws logs create-log-group --log-group-name "/ecs/ce-408"
aws logs put-retention-policy --log-group-name "/ecs/ce-408" --retention-in-days 7
```

### 6.2 Task Definitions

Task definition JSON files are in the project root (`catalog-taskdef.json`, `cart-taskdef.json`, `orders-taskdef.json`). Each uses 0.25 vCPU / 512 MB, pulls from ECR, and reads `DB_PASSWORD` from SSM.

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

# Target groups (one per service)
for svc in catalog cart orders; do
  aws elbv2 create-target-group --name ce-408-$svc-tg \
    --protocol HTTP --port 8000 --vpc-id $VPC_ID --target-type ip \
    --health-check-path "/healthz" --health-check-interval-seconds 15 \
    --tags Key=Project,Value=ce-408
done

# Listener with path-based routing
LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions Type=fixed-response,FixedResponseConfig='{StatusCode=404,ContentType=text/plain,MessageBody="not found"}' \
  --query "Listeners[0].ListenerArn" --output text)

aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 10 \
  --conditions Field=path-pattern,Values='/catalog/*' \
  --actions Type=forward,TargetGroupArn=$CATALOG_TG
aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 20 \
  --conditions Field=path-pattern,Values='/cart/*' \
  --actions Type=forward,TargetGroupArn=$CART_TG
aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 30 \
  --conditions Field=path-pattern,Values='/orders/*' \
  --actions Type=forward,TargetGroupArn=$ORDERS_TG
# Exact /orders match (POST /orders body)
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

aws ecs wait services-stable --cluster ce-408-cluster \
  --services ce-408-catalog ce-408-cart ce-408-orders
```

### 6.5 Auto-Scaling (CPU target tracking at 60%)

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
      "ScaleOutCooldown": 60, "ScaleInCooldown": 120
    }'
done
```

> **Auto-scaling delay is expected:** CloudWatch needs ~3 consecutive minutes of CPU > 60% before the alarm fires, then Fargate takes ~2 min to provision the new task. Total detection-to-scale: **6–9 minutes**.

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

---

## 7. Phase 5 — Storefront (S3)

Single-page HTML storefront at `storefront/index.html`. Deployed to S3 static website hosting. Uses `__ALB_DNS__` placeholder replaced at deploy time.

### 7.1 Create Bucket

```bash
BUCKET=ce-408-storefront-$ACCOUNT_ID
aws s3api create-bucket --bucket $BUCKET --region us-east-1
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
aws s3api put-bucket-policy --bucket $BUCKET --policy "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",
    \"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$BUCKET/*\"}]}"
aws s3 website s3://$BUCKET --index-document index.html
```

### 7.2 Deploy Storefront

```bash
ALB_DNS=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].DNSName" --output text)
sed "s/__ALB_DNS__/$ALB_DNS/g" storefront/index.html > storefront/index.deploy.html
aws s3 cp storefront/index.deploy.html s3://$BUCKET/index.html \
  --content-type "text/html" --cache-control "no-cache"
echo "Storefront: http://$BUCKET.s3-website-us-east-1.amazonaws.com"
```

### 7.3 Update Storefront

Edit `storefront/index.html`, then re-run the `sed` + `aws s3 cp` lines above. No build step. Cache-control is `no-cache` so reloads see the latest version.

---

## 8. Phase 6 — Observability

### 8.1 Enable Container Insights

```bash
aws ecs update-cluster-settings --cluster ce-408-cluster \
  --settings name=containerInsights,value=enabled
```

Takes 2–3 minutes to start emitting data.

### 8.2 CloudWatch Dashboard

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

# Git Bash on Windows requires an explicit empty backup suffix for sed -i:
LB_SUFFIX=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].LoadBalancerArn" --output text | awk -F'loadbalancer/' '{print $2}')
sed -i "" "s|app/ce-408-alb/XXXX|$LB_SUFFIX|g" dashboard.json

aws cloudwatch put-dashboard --dashboard-name ce-408 \
  --dashboard-body file://dashboard.json
```

### 8.3 Alarms

```bash
# Alarm 1: ALB 5xx errors
aws cloudwatch put-metric-alarm --alarm-name ce-408-alb-5xx-high \
  --metric-name HTTPCode_Target_5XX_Count --namespace AWS/ApplicationELB \
  --statistic Sum --period 60 --threshold 10 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 --dimensions Name=LoadBalancer,Value=$LB_SUFFIX

# Alarm 2: Unhealthy targets
aws cloudwatch put-metric-alarm --alarm-name ce-408-unhealthy-targets \
  --metric-name UnHealthyHostCount --namespace AWS/ApplicationELB \
  --statistic Maximum --period 60 --threshold 0 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 --dimensions Name=LoadBalancer,Value=$LB_SUFFIX

# Alarm 3: RDS CPU
aws cloudwatch put-metric-alarm --alarm-name ce-408-rds-cpu-high \
  --metric-name CPUUtilization --namespace AWS/RDS \
  --statistic Average --period 60 --threshold 80 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 --dimensions Name=DBInstanceIdentifier,Value=ce-408-postgres
```

---

## 9. Phase 7 — Load Generation (k6)

### 9.1 k6 EC2

```bash
MY_IP=$(curl -s ifconfig.me)
K6_SG=$(aws ec2 create-security-group --group-name ce-408-k6-sg \
  --description "k6 generator" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $K6_SG \
  --protocol tcp --port 22 --cidr $MY_IP/32

AMI=$(aws ec2 describe-images --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023.*-x86_64" \
  --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text)

aws ec2 run-instances --image-id $AMI --instance-type t3.micro \
  --key-name ce-408-k6 --security-group-ids $K6_SG \
  --subnet-id $PUB_SUBNET_1 --associate-public-ip-address \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=ce-408},{Key=Name,Value=ce-408-k6}]"
```

> **Dynamic IP tip:** If SSH times out, your ISP may have changed your IP. Re-authorize or temporarily open to `0.0.0.0/0`, connect, then lock back down.

```bash
K6_PUBLIC_IP=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=ce-408-k6" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
ssh -i ce-408-k6.pem ec2-user@$K6_PUBLIC_IP
```

On the instance:

```bash
sudo dnf install -y postgresql15
curl -L https://github.com/grafana/k6/releases/download/v0.52.0/k6-v0.52.0-linux-amd64.tar.gz | tar xz
sudo mv k6-v0.52.0-linux-amd64/k6 /usr/local/bin/
```

Allow k6 SG to reach RDS (run from local Git Bash):

```bash
K6_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=ce-408-k6-sg" \
  --query "SecurityGroups[0].GroupId" --output text)
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG --protocol tcp --port 5432 --source-group $K6_SG
```

### 9.2 k6 Scripts

Create these files on the k6 EC2 (SSH session):

**`baseline.js`** — 20 VUs, 5 min, catalog + cart:
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

**`spike.js`** — flash-sale shape, 200 VUs peak, orders:
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

Run from the EC2 (`$ALB_DNS` is not available in SSH — paste the DNS directly):

```bash
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run baseline.js
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run spike.js
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run stress.js
```

**Reference results:**
- Baseline (20 VUs, 5 min): 0% errors, p95 = 14ms, ~20 req/s
- Spike (200 VUs, 3m45s): 0% errors, p95 = 9.3s, ~63 req/s

---

## 10. Phase 8 — Chaos Experiments

Scripts are in `chaos/`. Run from local Git Bash (they use the AWS CLI).

### 10.1 Experiment 1 — Task Termination

Start baseline load in SSH session first:
```bash
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run baseline.js
```

Then in local Git Bash:
```bash
chmod +x chaos/kill-task.sh chaos/latency.sh
./chaos/kill-task.sh catalog        # kills one Catalog task
./chaos/kill-task.sh orders         # or kill an Orders task
```

**Hypothesis:** ALB removes dead target within 30s; ECS restores task within 90s; 5xx stays < 1%.

**Result:** Task count 0→1 between 17:45–17:47, 0 5xx, ~2 min recovery.

### 10.2 Experiment 2 — Network Latency Injection

The chaos latency middleware is already in `orders/app/main.py` and deployed. `chaos/latency.sh` registers a new task definition with `CHAOS_LATENCY_MS=500`, deploys it, holds 180s, then auto-rolls back.

```bash
./chaos/latency.sh                  # 500ms for 3 min (default)
./chaos/latency.sh 300 1000         # 1000ms for 5 min
```

Poll orders latency while it runs:
```bash
while true; do
  curl -s -o /dev/null -w "%{time_total}s\n" \
    -X POST http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com/orders \
    -H "Content-Type: application/json" \
    -d '{"userId":"u1","items":[{"sku":"SKU-001","qty":1}]}'
  sleep 5
done
```

**Result:** Baseline ~50ms → chaos avg ~550ms (11× increase), 0 5xx, auto-rollback at 180s.

### 10.3 Chaos Session for Resilience Report

For each experiment:

1. Start `baseline.js` k6 from the EC2.
2. Wait 60s — confirm dashboard: 1 task per service, ALB 5xx near zero.
3. Run the chaos script.
4. Note time of first signal and time of full recovery.
5. Stop k6.
6. Record recovery time and peak error/latency in `resilience-report.html`.

> **Why scripted, not FIS?** FIS requires a paid tier. Same two experiments are implemented via direct ECS API calls — dashboard signatures are identical. A FIS migration is in Future Work in the proposal.

---

## 11. Phase 9 — Demo Runbook (Viva)

**Duration: 5–8 minutes.** Full video guide in `demo.md`.

### Before Recording (5 min before)

Open on separate screens:
1. **CloudWatch** → Dashboards → `ce-408` (Last 30 min, refresh 10s)
2. **Storefront** — S3 website URL

Start baseline load in SSH session:
```bash
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run baseline.js
```
Wait 60s for dashboard to show live data.

---

### 0:00 — Architecture (1 min)

Show the architecture diagram from §1.

*"Three microservices on ECS Fargate behind an ALB. RDS, DynamoDB, SQS. Observable via CloudWatch."*

---

### 1:00 — Normal Operation (1.5 min)

Switch to storefront:
1. Browse products
2. Add 2 items to cart
3. Place an order — show success modal
4. Point at dashboard: **1 task per service, 0 5xx, ~14ms latency**

*"Under 20 VUs the stack handles requests in under 14ms p95 with zero errors."*

---

### 2:30 — Auto-Scaling (2 min)

Stop baseline (Ctrl+C). Start stress test in SSH:
```bash
ALB="http://ce-408-alb-390225980.us-east-1.elb.amazonaws.com" k6 run stress.js
```

Wait ~4 min. Point at dashboard: **CPU climbs → task count 1→2**.

*"CPU crossed 60% — auto-scaling fired. A second task spun up automatically. No manual intervention. Detection-to-scale is ~6-9 min by design to avoid thrashing."*

---

### 4:30 — Chaos: Task Kill (1.5 min)

In local Git Bash:
```bash
./chaos/kill-task.sh catalog
```

Watch dashboard: task count dips to 0, recovers to 1 within ~2 min.

*"We just killed the Catalog service. ECS detected it, replaced it, and the ALB re-routed traffic — zero 5xx errors. Self-healed in under 2 minutes."*

---

### 6:00 — Chaos: Latency Injection (1.5 min)

In local Git Bash:
```bash
./chaos/latency.sh 180 500
```

In another terminal, show curl loop — latency jumps from **~0.05s → ~0.55s**.

*"500ms injected into Orders. 11× latency increase, zero errors, Cart and Catalog unaffected. Script auto-rolls back after 3 minutes."*

---

### 7:30 — Wrap Up (30s)

Show `resilience-report.pdf`.

*"Both experiments confirm zero user-visible errors under failure, automatic recovery, and full fault isolation."*

---

### Key Numbers to Remember

| Metric | Value |
|---|---|
| Baseline p95 | 14ms |
| Spike error rate | 0% at 200 VUs |
| Task kill recovery | ~2 min |
| Latency injection | 50ms → 550ms, auto-rollback |
| Auto-scaling trigger | CPU > 60% for ~3 min |

---

> Have **two backup screenshots** of a successful run (dashboard + storefront) in case AWS misbehaves on the day.

---

Good luck with the submission! 😊
