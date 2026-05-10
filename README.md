# CE-408 — Auto-Scaling E-Commerce Backend with Chaos Engineering

End-to-end build, pause, resume, and teardown guide for the revised proposal
(`CE408_Project_Proposal_Revised.md`).

> **Read this first.** This README is written so you can: (a) build the entire
> stack from scratch in 1–2 work sessions, (b) **pause all paid resources**
> between sessions and after the build is done, (c) **resume in ~30 minutes**
> on viva day, (d) tear everything down cleanly afterwards. The pause/resume
> sections (§12–§13) are the load-bearing parts — follow them exactly or AWS
> will quietly bill you while you wait for viva day.

---

## 0. Quick Cost Cheat-Sheet

Resources you create and what each one costs at rest. All prices are
approximate `us-east-1` figures — verify in your own AWS Cost Explorer.

| Resource | Bills while running? | Bills while idle (Strategy A)? | Bills while paused (Strategy B)? | Action to fully stop |
|---|---|---|---|---|
| ECS Fargate tasks (3 services) | Yes (~$22/mo) | No (`desiredCount: 0`) | No | Scale to 0 |
| Application Load Balancer | Yes (~$16/mo) | **Yes (~$16/mo)** | No | Delete |
| NAT Gateway | Yes (~$32/mo) | **Yes (~$32/mo)** | No | Delete + release EIP |
| RDS PostgreSQL `db.t4g.micro` | Yes (~$12/mo) | No (stopped, max 7 days) | No (snapshot only ~$0.50/mo) | Snapshot + delete |
| DynamoDB on-demand | Pay-per-request | $0 | $0 | Nothing — leave it |
| SQS standard queue | Pay-per-request | $0 | $0 | Nothing — leave it |
| CloudWatch dashboard | $3/mo each | $3/mo | $0 | Delete |
| CloudWatch logs | Storage only | Storage only | Storage only | Set 7-day retention |
| ECR images | ~$0.10/GB-month | ~$0.10 | ~$0.10 | Leave them |
| EC2 t3.micro (k6 generator) | Yes (~$8/mo) | No (stopped, EBS ~$1/mo) | No | Stop or terminate |
| S3 storefront (1 HTML file) | ~$0 | ~$0 | ~$0 | Leave it — pause-friendly |

**Approximate totals**

| State | Monthly cost | When to use |
|---|---|---|
| Fully running | **~$95/month** (≈ $3.20/day) | While building and during viva day |
| **Strategy A** — short pause (≤ 7 days) | **~$50/month** | You'll be back tomorrow; ALB + NAT keep billing |
| **Strategy B** — long pause (recommended) | **under $1/month** | Weeks until viva; 30-min resume on the day |

If your viva is more than a week away, **use Strategy B**. The 30-minute resume cost on viva day is dramatically cheaper than $50/month of idle ALB+NAT. The procedures are §12 (pause) and §13 (resume).

---

## 1. Prerequisites

### 1.1 AWS account setup (do this once, before anything else)

1. Sign in to AWS as the root user → IAM → create an admin IAM user
   (`ce-408-admin`), generate access keys, store in your password manager.
2. **Enable a Budget alert immediately**, before you create any resources:
   - AWS Budgets → Create budget → Use a template → "Monthly cost budget"
   - Amount: `$10` (warning) and a second at `$25` (alarm)
   - Email: your address
   - This is your safety net — if you miss a pause step, you get an email
     before the bill is large.
3. Pick a region and stick with it for the whole project. **Recommended:
   `us-east-1`** (cheapest, all services available).
4. (Skipped — we use scripted chaos instead of AWS FIS, so no quota request
   is needed. See §10 for the rationale.)

### 1.2 Local tools

Install on your laptop (Windows):

| Tool | Purpose | Verify |
|---|---|---|
| AWS CLI v2 | All AWS API calls | `aws --version` → `aws-cli/2.x` |
| Docker Desktop | Build & test microservices | `docker --version` |
| Python 3.11+ | Microservice code, helper scripts | `python --version` |
| Git | Version control | `git --version` |
| `jq` | JSON parsing in scripts | `jq --version` |
| (optional) k6 | Local k6 runs before EC2 | `k6 version` |

Configure AWS CLI:

```bash
aws configure
# AWS Access Key ID:     <paste from IAM user>
# AWS Secret Access Key: <paste>
# Default region name:   us-east-1
# Default output format: json
```

### 1.3 Conventions used in this README

- All resources tagged `Project=ce-408` so cleanup is one filter away.
- Shell snippets are **bash** (works in Git Bash on Windows). For PowerShell
  replace `$VAR` with `$env:VAR` and trailing `\` with backtick `` ` ``.
- Variables you'll set once at the top of every shell session:

```bash
export AWS_REGION=us-east-1
export PROJECT=ce-408
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export TAG="Key=Project,Value=$PROJECT"
```

---

## 2. Architecture Overview

```
                                ┌───────────────────────┐
   k6 EC2  ─── HTTPS ───►  ALB  │  /catalog/* ─► Catalog Fargate ─► RDS Postgres
                                │  /cart/*    ─► Cart    Fargate ─► DynamoDB
                                │  /orders/*  ─► Orders  Fargate ─► RDS Postgres
                                └───────────────────────┘                    │
                                                                             ▼
                                                                            SQS
                                                                  (orders-fulfilment)

   Chaos scripts ── inject ──► task termination, network latency (env-var rollout)
   CloudWatch ── collects ──► metrics, logs, alarms, dashboard
```

Service-to-data mapping (matches §2 of the revised proposal):

| Service | Compute | Data store | Notes |
|---|---|---|---|
| Catalog | Fargate | RDS Postgres `catalog` DB | Read-heavy, simple GET endpoints |
| Cart | Fargate | DynamoDB `cart-sessions` | Per-user session, low-latency |
| Orders | Fargate | RDS Postgres `orders` DB + SQS | Writes order, emits SQS message |

**Deferred to Future Work** (deliberately not in this build): CloudFront, Route 53, Cognito, ElastiCache, X-Ray, React storefront, request-rate auto-scaling, and the AZ-failure / CPU-stress chaos experiments. See the proposal §6.

---

## 3. Phase 1 — Foundation

Goal by end of Phase 1: empty-but-correct AWS account, ready to host workloads.

### 3.1 VPC and networking

Use the AWS Console wizard for speed (this is a one-time thing):

**Console** → VPC → "Create VPC" → "VPC and more":

- Name tag prefix: `ce-408`
- IPv4 CIDR: `10.0.0.0/16`
- Number of AZs: `2`
- Public subnets: `2`, Private subnets: `2`
- NAT gateways: **In 1 AZ** (single — saves $32/mo per extra AZ)
- VPC endpoints: **None** (we'll use the NAT for ECR pulls)
- Click "Create VPC".

Then tag the VPC:

```bash
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=ce-408-vpc" \
  --query "Vpcs[0].VpcId" --output text)
aws ec2 create-tags --resources $VPC_ID --tags $TAG
```

Capture the IDs you'll need later:

```bash
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[].{ID:SubnetId,Name:Tags[?Key=='Name']|[0].Value,AZ:AvailabilityZone,Public:MapPublicIpOnLaunch}" \
  --output table
```

Save the public and private subnet IDs into your shell:

```bash
export PUB_SUBNET_1=subnet-xxxx
export PUB_SUBNET_2=subnet-yyyy
export PRIV_SUBNET_1=subnet-zzzz
export PRIV_SUBNET_2=subnet-wwww
```

### 3.2 Security groups

Three SGs, chained so each only allows the previous tier:

```bash
# ALB SG — open 80 to internet
ALB_SG=$(aws ec2 create-security-group --group-name ce-408-alb-sg \
  --description "ALB ingress" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 create-tags --resources $ALB_SG --tags $TAG

# Service SG — only ALB can reach 8000
SVC_SG=$(aws ec2 create-security-group --group-name ce-408-svc-sg \
  --description "Fargate services" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $SVC_SG \
  --protocol tcp --port 8000 --source-group $ALB_SG
aws ec2 create-tags --resources $SVC_SG --tags $TAG

# RDS SG — only services can reach 5432
RDS_SG=$(aws ec2 create-security-group --group-name ce-408-rds-sg \
  --description "RDS Postgres" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG \
  --protocol tcp --port 5432 --source-group $SVC_SG
aws ec2 create-tags --resources $RDS_SG --tags $TAG
```

Save these IDs — you will reference them everywhere:

```bash
echo "ALB_SG=$ALB_SG"
echo "SVC_SG=$SVC_SG"
echo "RDS_SG=$RDS_SG"
```

### 3.3 IAM roles

```bash
# ECS task execution role — pulls images, writes logs
cat > trust-ecs.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole" } ] }
EOF
aws iam create-role --role-name ce-408-ecs-exec \
  --assume-role-policy-document file://trust-ecs.json
aws iam attach-role-policy --role-name ce-408-ecs-exec \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Task role — what the running container can do
aws iam create-role --role-name ce-408-task-role \
  --assume-role-policy-document file://trust-ecs.json
# Inline policy: DynamoDB on cart-sessions, SQS on orders-fulfilment
cat > task-policy.json <<EOF
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow",
    "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem"],
    "Resource": "arn:aws:dynamodb:$AWS_REGION:$ACCOUNT_ID:table/ce-408-cart-sessions" },
  { "Effect": "Allow",
    "Action": ["sqs:SendMessage","sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"],
    "Resource": "arn:aws:sqs:$AWS_REGION:$ACCOUNT_ID:ce-408-orders-fulfilment" }
] }
EOF
aws iam put-role-policy --role-name ce-408-task-role \
  --policy-name ce-408-task-inline --policy-document file://task-policy.json

# (No FIS role — chaos is scripted via direct ECS API calls; see Phase 8)
```

### 3.4 ECR repositories

```bash
for svc in catalog cart orders; do
  aws ecr create-repository --repository-name ce-408/$svc \
    --image-scanning-configuration scanOnPush=true \
    --tags Key=Project,Value=$PROJECT
done
```

### 3.5 Verification

```bash
aws ec2 describe-vpcs --filters "Name=tag:Project,Values=$PROJECT"
aws ecr describe-repositories --query "repositories[].repositoryName"
aws iam list-roles --query "Roles[?starts_with(RoleName,'ce-408')].RoleName"
```

You should see one VPC, three ECR repos, and two IAM roles.

---

## 4. Phase 2 — Data Layer

### 4.1 RDS PostgreSQL

```bash
# Generate and store a strong password — save the output in Notepad!
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
echo $DB_PASSWORD
```

```bash
# DB subnet group across the 2 private subnets
aws rds create-db-subnet-group --db-subnet-group-name ce-408-db-subnets --db-subnet-group-description "ce-408 RDS subnets" --subnet-ids $PRIV_SUBNET_1 $PRIV_SUBNET_2 --tags Key=Project,Value=$PROJECT
```

```bash
# Store password in SSM (MSYS_NO_PATHCONV=1 prevents Git Bash path mangling)
MSYS_NO_PATHCONV=1 aws ssm put-parameter --name "/ce-408/rds/password" --type SecureString --value "$DB_PASSWORD" --overwrite
```

```bash
# Create the instance — single AZ, no multi-AZ, smallest burstable
aws rds create-db-instance --db-instance-identifier ce-408-postgres --db-instance-class db.t4g.micro --engine postgres --engine-version 16.3 --master-username ce408admin --master-user-password "$DB_PASSWORD" --allocated-storage 20 --storage-type gp3 --vpc-security-group-ids $RDS_SG --db-subnet-group-name ce-408-db-subnets --no-publicly-accessible --backup-retention-period 1 --tags Key=Project,Value=$PROJECT
```

Wait ~10–15 min for status `available`:

```bash
aws rds wait db-instance-available --db-instance-identifier ce-408-postgres
```

```bash
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier ce-408-postgres --query "DBInstances[0].Endpoint.Address" --output text)
echo $RDS_ENDPOINT
```

### 4.2 Bootstrap schemas

The easiest way to run psql against a private RDS is from a temporary ECS
"oneshot" task or from an EC2 bastion. Simplest now: spin up a temporary
EC2 in a public subnet, run psql, terminate. Or wait until §9 when you
spin up the k6 EC2 — it can double as a DB bastion.

Schemas to create (save as `bootstrap.sql`):

```sql
CREATE DATABASE catalog;
CREATE DATABASE orders;

\c catalog
CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  sku           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  inventory     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO products (sku, name, price_cents, inventory) VALUES
  ('SKU-001','Wireless Mouse',2499,100),
  ('SKU-002','USB-C Hub',3999,50),
  ('SKU-003','Mechanical Keyboard',8999,25);

\c orders
CREATE TABLE orders (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  total_cents   INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE order_items (
  order_id      INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,
  qty           INTEGER NOT NULL,
  price_cents   INTEGER NOT NULL,
  PRIMARY KEY (order_id, sku)
);
```

Run after k6 EC2 is up (§9):

```bash
ssh -i ce-408-k6.pem ec2-user@$K6_PUBLIC_IP "PGPASSWORD='$DB_PASSWORD' psql -h $RDS_ENDPOINT -U ce408admin -f -" < bootstrap.sql
```

### 4.3 DynamoDB

```bash
aws dynamodb create-table \
  --table-name ce-408-cart-sessions \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --tags Key=Project,Value=$PROJECT
```

PAY_PER_REQUEST means **$0 when idle** — leave it running across pauses.

### 4.4 SQS

```bash
ORDERS_QUEUE_URL=$(aws sqs create-queue --queue-name ce-408-orders-fulfilment \
  --attributes VisibilityTimeout=60,MessageRetentionPeriod=345600 \
  --tags Project=$PROJECT --query QueueUrl --output text)
aws sqs tag-queue --queue-url $ORDERS_QUEUE_URL --tags Project=$PROJECT
echo $ORDERS_QUEUE_URL
```

Same — pay-per-request, $0 idle.

### 4.5 Store endpoints in SSM (so containers can find them)

```bash
MSYS_NO_PATHCONV=1 aws ssm put-parameter --name "/ce-408/rds/endpoint" --type String --value "$RDS_ENDPOINT" --overwrite
MSYS_NO_PATHCONV=1 aws ssm put-parameter --name "/ce-408/sqs/orders-url" --type String --value "$ORDERS_QUEUE_URL" --overwrite
MSYS_NO_PATHCONV=1 aws ssm put-parameter --name "/ce-408/dynamodb/cart-table" --type String --value "ce-408-cart-sessions" --overwrite
```

---

## 5. Phase 3 — Microservices

### 5.1 Repo layout

Create one local repo with all three services:

```
ce-408-services/
├── catalog/
│   ├── app/main.py
│   ├── requirements.txt
│   └── Dockerfile
├── cart/        (same shape — DynamoDB instead of SQL)
├── orders/      (same shape — SQL + SQS publish + chaos latency middleware)
└── scripts/build-and-push.sh
```

### 5.2 FastAPI skeleton (Catalog)

`catalog/app/main.py` — minimum viable shape:

```python
from fastapi import FastAPI, HTTPException
import os, asyncpg

app = FastAPI()
_pool = None

async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            host=os.environ["DB_HOST"], database="catalog",
            user="ce-408admin", password=os.environ["DB_PASSWORD"],
            min_size=1, max_size=4)
    return _pool

@app.get("/healthz")
async def healthz(): return {"ok": True}

@app.get("/catalog/products")
async def list_products():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, sku, name, price_cents, inventory FROM products")
        return [dict(r) for r in rows]

@app.get("/catalog/products/{sku}")
async def get_product(sku: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM products WHERE sku=$1", sku)
        if not r: raise HTTPException(404)
        return dict(r)
```

Cart and Orders follow the same shape — Cart uses `boto3.resource('dynamodb')`,
Orders does an INSERT then `boto3.client('sqs').send_message(...)`.

### 5.3 Dockerfile pattern (use this for all three)

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
```

`requirements.txt` (Catalog/Orders):

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
asyncpg==0.29.0
boto3==1.34.150  # orders only
```

### 5.4 Build and push to ECR

`scripts/build-and-push.sh`:

```bash
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
```

Run it:

```bash
cd ce-408-services
chmod +x scripts/build-and-push.sh
./scripts/build-and-push.sh
```

### 5.5 Local smoke test (optional but saves AWS debugging time)

```bash
docker run --rm -p 8000:8000 \
  -e DB_HOST=host.docker.internal -e DB_PASSWORD=dummy \
  ce-408/catalog:latest
curl http://localhost:8000/healthz   # → {"ok":true}
```

---

## 6. Phase 4 — Compute & Routing

### 6.1 ECS cluster

```bash
aws ecs create-cluster --cluster-name ce-408-cluster \
  --capacity-providers FARGATE \
  --tags key=Project,value=$PROJECT
```

CloudWatch log group:

```bash
MSYS_NO_PATHCONV=1 aws logs create-log-group --log-group-name "/ecs/ce-408"
MSYS_NO_PATHCONV=1 aws logs put-retention-policy --log-group-name "/ecs/ce-408" --retention-in-days 7
```

### 6.2 Task definitions

`catalog-taskdef.json` (repeat for cart and orders, change name + image + env):

```json
{
  "family": "ce-408-catalog",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ce-408-ecs-exec",
  "taskRoleArn":      "arn:aws:iam::ACCOUNT_ID:role/ce-408-task-role",
  "containerDefinitions": [{
    "name": "app",
    "image": "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/ce-408/catalog:latest",
    "essential": true,
    "portMappings": [{"containerPort": 8000, "protocol": "tcp"}],
    "secrets": [
      {"name":"DB_PASSWORD","valueFrom":"arn:aws:ssm:us-east-1:ACCOUNT_ID:parameter/ce-408/rds/password"}
    ],
    "environment": [
      {"name":"DB_HOST","value":"RDS_ENDPOINT_HERE"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/ce-408",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "catalog"
      }
    }
  }]
}
```

Register all three (real values are already filled in the JSON files):

```bash
aws ecs register-task-definition --cli-input-json file://catalog-taskdef.json
aws ecs register-task-definition --cli-input-json file://cart-taskdef.json
aws ecs register-task-definition --cli-input-json file://orders-taskdef.json
```

You'll also need to allow the execution role to read SSM:

```bash
aws iam attach-role-policy --role-name ce-408-ecs-exec \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess
```

### 6.3 Application Load Balancer

```bash
ALB_ARN=$(aws elbv2 create-load-balancer --name ce-408-alb --type application --scheme internet-facing --subnets $PUB_SUBNET_1 $PUB_SUBNET_2 --security-groups $ALB_SG --tags Key=Project,Value=$PROJECT --query "LoadBalancers[0].LoadBalancerArn" --output text)
echo $ALB_ARN
```

```bash
MSYS_NO_PATHCONV=1 aws elbv2 create-target-group --name ce-408-catalog-tg --protocol HTTP --port 8000 --vpc-id $VPC_ID --target-type ip --health-check-path "/healthz" --health-check-interval-seconds 15 --tags Key=Project,Value=$PROJECT
MSYS_NO_PATHCONV=1 aws elbv2 create-target-group --name ce-408-cart-tg --protocol HTTP --port 8000 --vpc-id $VPC_ID --target-type ip --health-check-path "/healthz" --health-check-interval-seconds 15 --tags Key=Project,Value=$PROJECT
MSYS_NO_PATHCONV=1 aws elbv2 create-target-group --name ce-408-orders-tg --protocol HTTP --port 8000 --vpc-id $VPC_ID --target-type ip --health-check-path "/healthz" --health-check-interval-seconds 15 --tags Key=Project,Value=$PROJECT
```

```bash
CATALOG_TG=$(aws elbv2 describe-target-groups --names ce-408-catalog-tg --query "TargetGroups[0].TargetGroupArn" --output text)
CART_TG=$(aws elbv2 describe-target-groups --names ce-408-cart-tg --query "TargetGroups[0].TargetGroupArn" --output text)
ORDERS_TG=$(aws elbv2 describe-target-groups --names ce-408-orders-tg --query "TargetGroups[0].TargetGroupArn" --output text)
echo $CATALOG_TG $CART_TG $ORDERS_TG

# Default listener returns 404; rules route by path
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
```

### 6.4 ECS services

```bash
for svc in catalog cart orders; do
  TG_VAR=$(echo ${svc}_TG | tr '[:lower:]' '[:upper:]')
  TG_ARN=$(eval echo \$$TG_VAR)
  aws ecs create-service \
    --cluster ce-408-cluster \
    --service-name ce-408-$svc \
    --task-definition ce-408-$svc \
    --desired-count 1 --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$PRIV_SUBNET_1,$PRIV_SUBNET_2],securityGroups=[$SVC_SG],assignPublicIp=DISABLED}" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=app,containerPort=8000" \
    --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}" \
    --tags key=Project,value=$PROJECT
done
```

Wait for them to stabilize (5–10 min):

```bash
aws ecs wait services-stable --cluster ce-408-cluster \
  --services ce-408-catalog ce-408-cart ce-408-orders
```

### 6.5 Auto-scaling (CPU target tracking)

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

### 6.6 Smoke test the live stack

```bash
ALB_DNS=$(aws elbv2 describe-load-balancers --names ce-408-alb --query "LoadBalancers[0].DNSName" --output text)
```

```bash
curl http://$ALB_DNS/catalog/products
curl http://$ALB_DNS/cart/sessions/u1
curl -X POST "http://$ALB_DNS/orders?user_id=u1" -H "content-type: application/json" -d '[{"sku":"SKU-001","qty":1,"price_cents":2499}]'
```

Note: hitting the ALB root URL (`/`) returns "not found" — that is expected. The ALB only routes `/catalog/*`, `/cart/*`, and `/orders/*`. The UI is served from S3 (§7).

Also add a listener rule for the exact `/orders` path (required because the ALB pattern `/orders/*` won't match a POST to `/orders`):

```bash
MSYS_NO_PATHCONV=1 aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 31 --conditions Field=path-pattern,Values='/orders' --actions Type=forward,TargetGroupArn=$ORDERS_TG
```

End of Phase 1 (proposal day 4). Happy path works.

---

## 7. Phase 5 — Frontend (Storefront on S3)

A polished, single-page storefront hosted on S3 that gives examiners a real
clickable demo: browse products, add to cart, place an order — all backed by
your live Fargate services. No build pipeline, no React, no CloudFront.
**One bucket, one HTML file, ~$0/month, pause-friendly.**

### 7.1 Enable CORS on the FastAPI services

The browser blocks calls from the S3 origin to the ALB origin unless the
backend sends CORS headers. Add this to each service's `app/main.py`
(Catalog, Cart, Orders) before the route definitions:

```python
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Rebuild and force a new deployment so the running tasks pick up the change:

```bash
cd ce-408-services && ./scripts/build-and-push.sh
for svc in catalog cart orders; do
  aws ecs update-service --cluster ce-408-cluster --service ce-408-$svc \
    --force-new-deployment
done
aws ecs wait services-stable --cluster ce-408-cluster \
  --services ce-408-catalog ce-408-cart ce-408-orders
```

### 7.2 Required API contract

The storefront expects these endpoints. Implement any that don't exist yet:

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/catalog/products` | — | `[{id, sku, name, price_cents, inventory}]` |
| `GET` | `/cart/sessions/{userId}` | — | `{userId, items: [{sku, qty}]}` |
| `POST` | `/cart/sessions/{userId}/items` | `{sku, qty}` | adds `qty` to existing line (positive only) |
| `PUT` | `/cart/sessions/{userId}/items/{sku}` | `{qty}` | sets absolute qty; `0` removes the line |
| `DELETE` | `/cart/sessions/{userId}` | — | clears the cart |
| `POST` | `/orders` | `{userId, items: [{sku, qty}]}` | `{orderId, total_cents, status}` |

### 7.3 The storefront — `storefront/index.html`

Save this as a single file. Leave `__ALB_DNS__` as-is — the deploy script in
§7.4 substitutes it at upload time.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>GIKI Mart — CE-408</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root {
      --maroon: #7b1d2e;
      --maroon-dark: #5e1422;
      --maroon-soft: #faf0f2;
      --bg: #f9fafb;
      --card: #ffffff;
      --line: #e5e7eb;
      --text: #111827;
      --muted: #6b7280;
      --green: #16a34a;
      --amber: #d97706;
      --red: #dc2626;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
      --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
      --shadow-lg: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.04);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.5; min-height: 100vh;
    }
    button { cursor: pointer; font-family: inherit; }

    header {
      background: white; border-bottom: 1px solid var(--line);
      position: sticky; top: 0; z-index: 50; box-shadow: var(--shadow-sm);
    }
    .header-inner {
      max-width: 1200px; margin: 0 auto; padding: 14px 24px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
      width: 38px; height: 38px; border-radius: 10px;
      background: linear-gradient(135deg, var(--maroon), var(--maroon-dark));
      color: white; display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 18px; box-shadow: var(--shadow);
    }
    .brand-name { font-weight: 700; font-size: 17px; color: var(--maroon); line-height: 1.2; }
    .brand-sub { color: var(--muted); font-size: 11px; }
    .header-right { display: flex; align-items: center; gap: 12px; }
    .user-pill {
      background: var(--maroon-soft); color: var(--maroon);
      padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 500;
    }
    .cart-btn {
      position: relative; background: var(--maroon); color: white; border: 0;
      padding: 9px 16px 9px 14px; border-radius: 999px;
      display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500;
      transition: background 0.15s, transform 0.1s;
    }
    .cart-btn:hover { background: var(--maroon-dark); }
    .cart-btn:active { transform: scale(0.97); }
    .cart-btn svg { width: 16px; height: 16px; }
    .cart-badge {
      background: white; color: var(--maroon);
      min-width: 22px; height: 22px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; padding: 0 6px;
    }

    .hero { max-width: 1200px; margin: 36px auto 12px; padding: 0 24px; }
    .hero h1 { font-size: 30px; color: var(--text); margin-bottom: 6px; letter-spacing: -0.5px; }
    .hero p { color: var(--muted); font-size: 15px; }

    .status-bar {
      max-width: 1200px; margin: 0 auto; padding: 0 24px 20px;
      display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; color: var(--muted);
    }
    .status-item { display: flex; align-items: center; gap: 6px; }
    .status-dot {
      width: 8px; height: 8px; border-radius: 999px; background: var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

    .grid {
      max-width: 1200px; margin: 0 auto 64px; padding: 0 24px;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card); border-radius: 12px; overflow: hidden;
      box-shadow: var(--shadow); display: flex; flex-direction: column;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
    .card-image {
      height: 170px; display: flex; align-items: center; justify-content: center;
      font-size: 64px; font-weight: 700; color: white; position: relative;
      letter-spacing: -2px;
    }
    .stock-badge {
      position: absolute; top: 12px; right: 12px;
      background: white; padding: 4px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; box-shadow: var(--shadow-sm);
    }
    .stock-badge.in { color: var(--green); }
    .stock-badge.low { color: var(--amber); }
    .stock-badge.out { color: var(--red); }
    .card-body { padding: 16px; flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .card-sku { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
    .card-name { font-weight: 600; font-size: 15px; }
    .card-bottom { margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .card-price { font-weight: 700; font-size: 20px; color: var(--text); }
    .add-btn {
      background: var(--maroon); color: white; border: 0;
      padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
      transition: background 0.15s;
    }
    .add-btn:hover { background: var(--maroon-dark); }
    .add-btn:disabled { background: #d1d5db; cursor: not-allowed; }

    .skel-card { background: white; border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
    .skel { background: linear-gradient(90deg,#f3f4f6,#e5e7eb,#f3f4f6); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 4px; }
    @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    .skel-img { height: 170px; border-radius: 0; }
    .skel-body { padding: 16px; }
    .skel-line { height: 12px; margin-bottom: 8px; }

    .drawer-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100;
      opacity: 0; pointer-events: none; transition: opacity 0.2s;
    }
    .drawer-overlay.open { opacity: 1; pointer-events: auto; }
    .drawer {
      position: fixed; top: 0; right: 0; height: 100vh;
      width: 100%; max-width: 440px; background: white; z-index: 101;
      transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
      box-shadow: -10px 0 30px rgba(0,0,0,0.15);
    }
    .drawer.open { transform: translateX(0); }
    .drawer-head {
      padding: 20px 24px; border-bottom: 1px solid var(--line);
      display: flex; justify-content: space-between; align-items: center;
    }
    .drawer-head h2 { font-size: 18px; }
    .close-btn {
      background: transparent; border: 0; width: 32px; height: 32px; border-radius: 6px;
      color: var(--muted); display: flex; align-items: center; justify-content: center;
    }
    .close-btn:hover { background: var(--bg); color: var(--text); }
    .close-btn svg { width: 20px; height: 20px; }
    .drawer-body { flex: 1; overflow-y: auto; padding: 8px 24px; }
    .cart-item { display: flex; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--line); }
    .cart-item:last-child { border-bottom: 0; }
    .cart-item-img {
      width: 60px; height: 60px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 24px; font-weight: 700; flex-shrink: 0;
    }
    .cart-item-info { flex: 1; min-width: 0; }
    .cart-item-name { font-weight: 500; font-size: 14px; margin-bottom: 4px; }
    .cart-item-price { color: var(--maroon); font-weight: 600; font-size: 14px; }
    .qty-controls { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .qty-btn {
      width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--line);
      background: white; font-size: 14px; font-weight: 600; color: var(--text);
      display: flex; align-items: center; justify-content: center;
    }
    .qty-btn:hover { background: var(--maroon-soft); border-color: var(--maroon); color: var(--maroon); }
    .qty-val { min-width: 24px; text-align: center; font-weight: 500; font-size: 14px; }
    .remove-btn {
      margin-left: auto; background: transparent; border: 0; color: var(--red);
      font-size: 12px; padding: 4px 8px; border-radius: 4px;
    }
    .remove-btn:hover { background: #fee2e2; }
    .empty-cart { text-align: center; padding: 60px 20px; color: var(--muted); }
    .empty-cart svg { width: 64px; height: 64px; opacity: 0.3; margin-bottom: 16px; color: var(--muted); }
    .empty-cart p { font-size: 14px; }
    .drawer-foot { padding: 20px 24px; border-top: 1px solid var(--line); background: var(--bg); }
    .summary-row {
      display: flex; justify-content: space-between; margin-bottom: 8px;
      font-size: 14px; color: var(--muted);
    }
    .summary-row.total {
      color: var(--text); font-weight: 700; font-size: 18px;
      padding-top: 12px; border-top: 1px solid var(--line); margin-top: 8px;
    }
    .checkout-btn {
      width: 100%; background: var(--maroon); color: white; border: 0;
      padding: 14px; border-radius: 10px; font-size: 15px; font-weight: 600;
      margin-top: 16px; transition: background 0.15s;
    }
    .checkout-btn:hover { background: var(--maroon-dark); }
    .checkout-btn:disabled { background: #d1d5db; cursor: not-allowed; }

    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none; transition: opacity 0.2s;
    }
    .modal-overlay.open { opacity: 1; pointer-events: auto; }
    .modal {
      background: white; border-radius: 16px; padding: 36px 32px;
      max-width: 420px; width: 90%; text-align: center;
      transform: scale(0.92); transition: transform 0.2s;
    }
    .modal-overlay.open .modal { transform: scale(1); }
    .modal-icon {
      width: 72px; height: 72px; border-radius: 999px;
      background: var(--green); color: white;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px;
    }
    .modal-icon svg { width: 36px; height: 36px; }
    .modal h3 { font-size: 22px; margin-bottom: 8px; }
    .modal p { color: var(--muted); font-size: 14px; margin-bottom: 0; }
    .order-id { color: var(--maroon); font-weight: 700; }

    .toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(120px);
      background: var(--text); color: white; padding: 12px 20px; border-radius: 10px;
      font-size: 14px; box-shadow: var(--shadow-lg);
      transition: transform 0.25s; z-index: 300;
    }
    .toast.show { transform: translateX(-50%) translateY(0); }
    .toast.error { background: var(--red); }

    @media (max-width: 600px) {
      .hero { padding: 0 16px; }
      .hero h1 { font-size: 22px; }
      .header-inner { padding: 12px 16px; }
      .brand-sub { display: none; }
      .grid { padding: 0 16px; gap: 14px; }
      .user-pill { display: none; }
      .status-bar { padding: 0 16px 20px; }
    }
  </style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="brand">
      <div class="brand-logo">G</div>
      <div>
        <div class="brand-name">GIKI Mart</div>
        <div class="brand-sub">CE-408 Resilient E-Commerce</div>
      </div>
    </div>
    <div class="header-right">
      <span class="user-pill" id="userPill">guest</span>
      <button class="cart-btn" id="cartBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>
        Cart <span class="cart-badge" id="cartBadge">0</span>
      </button>
    </div>
  </div>
</header>

<div class="hero">
  <h1>Today's Picks</h1>
  <p>Live storefront on AWS Fargate · auto-scales under load · survives chaos experiments</p>
</div>

<div class="status-bar">
  <div class="status-item"><span class="status-dot"></span> Backend healthy</div>
  <div class="status-item" id="latencyMeta">Catalog latency: --</div>
</div>

<div class="grid" id="grid"></div>

<div class="drawer-overlay" id="drawerOverlay"></div>
<aside class="drawer" id="drawer">
  <div class="drawer-head">
    <h2>Your Cart</h2>
    <button class="close-btn" id="closeBtn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="drawer-body" id="drawerBody"></div>
  <div class="drawer-foot" id="drawerFoot" style="display:none">
    <div class="summary-row"><span>Items</span><span id="itemCount">0</span></div>
    <div class="summary-row"><span>Subtotal</span><span id="subtotal">$0.00</span></div>
    <div class="summary-row total"><span>Total</span><span id="totalAmt">$0.00</span></div>
    <button class="checkout-btn" id="checkoutBtn">Place Order</button>
  </div>
</aside>

<div class="modal-overlay" id="modalOverlay">
  <div class="modal">
    <div class="modal-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <h3>Order Placed</h3>
    <p>Order <span class="order-id" id="orderIdText">#----</span> received in <span id="orderTime">--</span> ms.</p>
    <button class="checkout-btn" id="modalCloseBtn">Continue Shopping</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
  const API = (location.search.match(/api=([^&]+)/) || [])[1]
            || localStorage.getItem('ce-408_api')
            || prompt('Enter ALB DNS (no http://, no trailing slash):', '__ALB_DNS__');
  if (API) localStorage.setItem('ce-408_api', API);
  const BASE = `http://${API}`;

  let userId = localStorage.getItem('ce-408_user');
  if (!userId) {
    userId = 'u' + Math.floor(Math.random() * 100000);
    localStorage.setItem('ce-408_user', userId);
  }
  document.getElementById('userPill').textContent = `user: ${userId}`;

  const GRADIENTS = [
    'linear-gradient(135deg,#7b1d2e,#b53e54)',
    'linear-gradient(135deg,#1e3a8a,#3b82f6)',
    'linear-gradient(135deg,#166534,#22c55e)',
    'linear-gradient(135deg,#713f12,#d97706)',
    'linear-gradient(135deg,#581c87,#a855f7)',
    'linear-gradient(135deg,#0e7490,#06b6d4)',
  ];
  function gradientFor(sku) {
    let h = 0;
    for (const c of sku) h = (h * 31 + c.charCodeAt(0)) | 0;
    return GRADIENTS[Math.abs(h) % GRADIENTS.length];
  }
  function letterFor(name) {
    const m = name.match(/[A-Za-z]/);
    return (m ? m[0] : '?').toUpperCase();
  }
  function fmt(cents) { return '$' + (cents / 100).toFixed(2); }
  function stockClass(n) { return n === 0 ? 'out' : (n < 10 ? 'low' : 'in'); }
  function stockText(n) { return n === 0 ? 'Out of stock' : (n < 10 ? `Only ${n} left` : 'In stock'); }

  let products = [];
  let cart = { items: [] };
  const $ = (id) => document.getElementById(id);
  const grid = $('grid'), drawer = $('drawer'), drawerOverlay = $('drawerOverlay');

  function renderSkeletons() {
    grid.innerHTML = Array.from({length: 6}).map(() => `
      <div class="skel-card">
        <div class="skel skel-img"></div>
        <div class="skel-body">
          <div class="skel skel-line" style="width:40%"></div>
          <div class="skel skel-line" style="width:80%"></div>
          <div class="skel skel-line" style="width:60%; margin-top:14px"></div>
        </div>
      </div>`).join('');
  }

  function renderProducts() {
    if (!products.length) {
      grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;text-align:center;padding:40px">No products available.</p>';
      return;
    }
    grid.innerHTML = products.map(p => `
      <div class="card">
        <div class="card-image" style="background:${gradientFor(p.sku)}">
          ${letterFor(p.name)}
          <span class="stock-badge ${stockClass(p.inventory)}">${stockText(p.inventory)}</span>
        </div>
        <div class="card-body">
          <div class="card-sku">${p.sku}</div>
          <div class="card-name">${p.name}</div>
          <div class="card-bottom">
            <span class="card-price">${fmt(p.price_cents)}</span>
            <button class="add-btn" data-sku="${p.sku}" ${p.inventory === 0 ? 'disabled' : ''}>
              ${p.inventory === 0 ? 'Sold out' : 'Add'}
            </button>
          </div>
        </div>
      </div>`).join('');
    grid.querySelectorAll('.add-btn[data-sku]').forEach(b => {
      b.addEventListener('click', () => addToCart(b.dataset.sku));
    });
  }

  async function loadProducts() {
    renderSkeletons();
    const t0 = performance.now();
    try {
      const r = await fetch(`${BASE}/catalog/products`);
      products = await r.json();
      renderProducts();
      $('latencyMeta').textContent = `Catalog responded in ${(performance.now() - t0).toFixed(0)} ms`;
    } catch (e) {
      grid.innerHTML = `<p style="color:var(--red);grid-column:1/-1;text-align:center;padding:40px">Failed to load products: ${e.message}</p>`;
    }
  }

  function renderCart() {
    const items = cart.items || [];
    $('cartBadge').textContent = items.reduce((s,i) => s + i.qty, 0);
    if (!items.length) {
      $('drawerBody').innerHTML = `
        <div class="empty-cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>
          <p>Your cart is empty</p>
        </div>`;
      $('drawerFoot').style.display = 'none';
      return;
    }
    let subtotal = 0;
    $('drawerBody').innerHTML = items.map(i => {
      const p = products.find(x => x.sku === i.sku) || { name: i.sku, price_cents: 0 };
      const lineTotal = p.price_cents * i.qty;
      subtotal += lineTotal;
      return `
        <div class="cart-item">
          <div class="cart-item-img" style="background:${gradientFor(i.sku)}">${letterFor(p.name)}</div>
          <div class="cart-item-info">
            <div class="cart-item-name">${p.name}</div>
            <div class="cart-item-price">${fmt(lineTotal)}</div>
            <div class="qty-controls">
              <button class="qty-btn" data-act="dec" data-sku="${i.sku}">−</button>
              <span class="qty-val">${i.qty}</span>
              <button class="qty-btn" data-act="inc" data-sku="${i.sku}">+</button>
              <button class="remove-btn" data-act="rm" data-sku="${i.sku}">Remove</button>
            </div>
          </div>
        </div>`;
    }).join('');
    $('drawerFoot').style.display = 'block';
    $('itemCount').textContent = items.reduce((s,i) => s + i.qty, 0);
    $('subtotal').textContent = fmt(subtotal);
    $('totalAmt').textContent = fmt(subtotal);
    $('drawerBody').querySelectorAll('button[data-sku]').forEach(b => {
      b.addEventListener('click', () => updateQty(b.dataset.sku, b.dataset.act));
    });
  }

  async function loadCart() {
    try {
      const r = await fetch(`${BASE}/cart/sessions/${userId}`);
      cart = r.ok ? await r.json() : { items: [] };
    } catch (e) { cart = { items: [] }; }
    renderCart();
  }

  async function addToCart(sku) {
    try {
      await fetch(`${BASE}/cart/sessions/${userId}/items`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, qty: 1 })
      });
      toast('Added to cart');
      loadCart();
    } catch (e) { toast('Add failed: ' + e.message, true); }
  }

  async function updateQty(sku, act) {
    const item = cart.items.find(i => i.sku === sku);
    if (!item) return;
    let newQty = item.qty;
    if (act === 'inc') newQty++;
    else if (act === 'dec') newQty--;
    else if (act === 'rm') newQty = 0;
    if (newQty < 0) newQty = 0;
    try {
      await fetch(`${BASE}/cart/sessions/${userId}/items/${sku}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qty: newQty })
      });
    } catch (e) { toast('Update failed', true); }
    loadCart();
  }

  function openDrawer() { drawer.classList.add('open'); drawerOverlay.classList.add('open'); }
  function closeDrawer() { drawer.classList.remove('open'); drawerOverlay.classList.remove('open'); }
  $('cartBtn').addEventListener('click', openDrawer);
  $('closeBtn').addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  $('checkoutBtn').addEventListener('click', async () => {
    const items = cart.items || [];
    if (!items.length) return;
    const btn = $('checkoutBtn');
    btn.disabled = true; btn.textContent = 'Placing...';
    const t0 = performance.now();
    try {
      const r = await fetch(`${BASE}/orders`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, items })
      });
      const data = await r.json();
      $('orderIdText').textContent = '#' + (data.orderId || '----');
      $('orderTime').textContent = (performance.now() - t0).toFixed(0);
      $('modalOverlay').classList.add('open');
      await fetch(`${BASE}/cart/sessions/${userId}`, { method: 'DELETE' });
      closeDrawer();
      loadCart();
    } catch (e) {
      toast('Checkout failed: ' + e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Place Order';
    }
  });

  $('modalCloseBtn').addEventListener('click', () => $('modalOverlay').classList.remove('open'));
  $('modalOverlay').addEventListener('click', (e) => {
    if (e.target === $('modalOverlay')) $('modalOverlay').classList.remove('open');
  });

  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  loadProducts().then(loadCart);
  setInterval(loadCart, 15000);
</script>
</body>
</html>
```

What you get visually:

- Sticky white header with maroon brand mark, user pill, cart button with item-count badge.
- Hero strip ("Today's Picks") with a live status row (green pulsing dot + Catalog latency in ms).
- Responsive product grid (3 cols desktop / 2 tablet / 1 mobile) with hover-lift cards, gradient "image" tiles per product, stock badges (in stock / only N left / sold out), and an Add button.
- Sliding cart drawer from the right with quantity +/− controls, per-line subtotal, remove button, and a sticky footer with the totals and "Place Order".
- Order success modal with checkmark icon and the live order placement time in ms.
- Toast notifications (success and error variants).
- Loading skeletons while the catalog request is in flight.

### 7.4 Deploy to S3

```bash
BUCKET=ce-408-storefront-$ACCOUNT_ID
aws s3api create-bucket --bucket $BUCKET --region $AWS_REGION

# Disable Block Public Access on this bucket only
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Public-read policy (only on this bucket — not your account)
cat > bucket-policy.json <<EOF
{ "Version":"2012-10-17","Statement":[{
  "Sid":"PublicRead","Effect":"Allow","Principal":"*",
  "Action":"s3:GetObject",
  "Resource":"arn:aws:s3:::$BUCKET/*"
}] }
EOF
aws s3api put-bucket-policy --bucket $BUCKET --policy file://bucket-policy.json

# Enable static website hosting
aws s3 website s3://$BUCKET/ --index-document index.html

# Substitute the live ALB DNS into the file before upload
ALB_DNS=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].DNSName" --output text)
sed "s/__ALB_DNS__/$ALB_DNS/g" storefront/index.html > storefront/index.deploy.html

aws s3 cp storefront/index.deploy.html s3://$BUCKET/index.html \
  --content-type "text/html" \
  --cache-control "no-cache"

echo "Storefront live at: http://$BUCKET.s3-website-$AWS_REGION.amazonaws.com"
```

That URL is your **live, shareable storefront**, in this format:

```
http://ce-408-storefront-123456789012.s3-website-us-east-1.amazonaws.com
```

### 7.5 Verify

Open the URL in a browser. You should see:

- The product grid loads with three demo products from the bootstrap SQL.
- The status row shows "Catalog responded in NN ms".
- Clicking "Add" pops a toast and increments the cart badge.
- Opening the cart drawer shows the line item with +/− controls.
- "Place Order" returns a modal with the order ID and the round-trip time.

If you see "Failed to load products", check (in order): CORS middleware deployed (§7.1), ALB DNS in the file is correct, ECS services have at least one running task.

### 7.6 Updating the storefront

Edit `storefront/index.html`, then rerun the `sed` + `aws s3 cp` lines from §7.4. No build step. Cache-control is `no-cache` so reloads see the latest version immediately.

After a Strategy B resume the ALB DNS will have changed. Either re-deploy the HTML with the new DNS, or just open the storefront with `?api=NEW_ALB_DNS` once and the value is remembered in localStorage for the rest of the session.

---

## 8. Phase 6 — Observability

### 7.1 Dashboard JSON

Save as `dashboard.json` and create:

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

# Replace the LB suffix in the JSON (CloudWatch needs the app/<name>/<id> form):
LB_SUFFIX=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].LoadBalancerArn" --output text | awk -F'loadbalancer/' '{print $2}')
sed -i "s|app/ce-408-alb/XXXX|$LB_SUFFIX|g" dashboard.json

aws cloudwatch put-dashboard --dashboard-name ce-408 \
  --dashboard-body file://dashboard.json
```

### 7.2 Alarms

```bash
aws cloudwatch put-metric-alarm --alarm-name ce-408-alb-5xx-high \
  --metric-name HTTPCode_Target_5XX_Count --namespace AWS/ApplicationELB \
  --statistic Sum --period 60 --threshold 10 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=LoadBalancer,Value=$LB_SUFFIX
```

(Add a SNS topic + email subscription if you want push alerts.)

---

## 9. Phase 7 — Load Generation (k6)

### 8.1 EC2 generator

```bash
# Key pair
aws ec2 create-key-pair --key-name ce-408-k6 \
  --query "KeyMaterial" --output text > ce-408-k6.pem
chmod 400 ce-408-k6.pem

# SG: allow SSH from your IP
MY_IP=$(curl -s ifconfig.me)
K6_SG=$(aws ec2 create-security-group --group-name ce-408-k6-sg \
  --description "k6 generator" --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $K6_SG \
  --protocol tcp --port 22 --cidr $MY_IP/32

# Latest AL2023 AMI
AMI=$(aws ec2 describe-images --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023.*-x86_64" \
  --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text)

aws ec2 run-instances --image-id $AMI --instance-type t3.micro \
  --key-name ce-408-k6 --security-group-ids $K6_SG \
  --subnet-id $PUB_SUBNET_1 --associate-public-ip-address \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=$PROJECT},{Key=Name,Value=ce-408-k6}]"
```

Get the public IP:

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
k6 version
```

Before running bootstrap.sql, allow the k6 SG to reach RDS (the RDS SG only allows Fargate by default):

```bash
K6_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=ce-408-k6-sg" --query "SecurityGroups[0].GroupId" --output text)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG --protocol tcp --port 5432 --source-group $K6_SG
```

Then run bootstrap.sql from your local Git Bash:

```bash
ssh -i ce-408-k6.pem ec2-user@$K6_PUBLIC_IP "PGPASSWORD='$DB_PASSWORD' psql -h $RDS_ENDPOINT -U ce408admin -d postgres -f -" < bootstrap.sql
```

### 8.2 k6 scripts

`baseline.js`:

```javascript
import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  vus: 20,
  duration: '5m',
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] }
};

const ALB = __ENV.ALB;

export default function () {
  const r1 = http.get(`${ALB}/catalog/products`);
  check(r1, { 'catalog 200': (r) => r.status === 200 });
  sleep(1);
  const r2 = http.get(`${ALB}/cart/sessions/u${__VU}`);
  check(r2, { 'cart 200': (r) => r.status === 200 });
  sleep(1);
}
```

`spike.js` (flash-sale shape):

```javascript
import http from 'k6/http';
export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '15s', target: 200 },   // sudden spike
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

Run from the EC2:

```bash
ALB="http://$ALB_DNS" k6 run baseline.js
ALB="http://$ALB_DNS" k6 run spike.js
```

Watch the CloudWatch dashboard while it runs — Catalog and Orders should
scale out from 1 → 2+ tasks during the spike.

---

## 10. Phase 8 — Chaos Experiments (Scripted)

We use a **scripted chaos harness** rather than AWS Fault Injection Service
(FIS). Reason: FIS requires a paid AWS account tier and was blocking
day-one progress. The scripted approach uses direct ECS API calls and a
small middleware in the Orders service — total of ~50 lines of bash and ~10
lines of Python — and produces the same dashboard signatures as the
equivalent FIS experiments. A future migration path to FIS is preserved in
proposal §6 (Future Work).

### 10.1 Experiment 1 — Task termination

Save as `chaos/kill-task.sh`:

```bash
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
echo "and auto-scaling should restore baseline within ~90s."
```

Run it:

```bash
chmod +x chaos/kill-task.sh
./chaos/kill-task.sh catalog        # kill one Catalog task
./chaos/kill-task.sh orders         # or kill an Orders task
```

**Hypothesis**: ALB removes the dead target within 30 s; auto-scaling brings
the count back to baseline within 90 s; user-visible 5xx rate stays < 1 %
during the event because there's still a healthy task to serve traffic.

**Steady-state metric (capture for the resilience report)**: ALB
`HTTPCode_Target_5XX_Count` and `HealthyHostCount` per target group.

### 10.2 Experiment 2 — Network latency injection

Latency is injected by setting an env var on the Orders service that
activates a tiny middleware. First, add the middleware once (in
`orders/app/main.py`, near the top):

```python
import os, asyncio
CHAOS_LATENCY_MS = int(os.environ.get("CHAOS_LATENCY_MS", "0"))

@app.middleware("http")
async def inject_chaos_latency(request, call_next):
    if CHAOS_LATENCY_MS:
        await asyncio.sleep(CHAOS_LATENCY_MS / 1000)
    return await call_next(request)
```

Rebuild and push the Orders image once with this middleware in place:

```bash
cd ce-408-services && ./scripts/build-and-push.sh
aws ecs update-service --cluster ce-408-cluster --service ce-408-orders \
  --force-new-deployment
```

Now the chaos script flips the env var on, waits, and rolls back. Save as
`chaos/latency.sh`:

```bash
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
  | jq --arg ms "$LATENCY_MS" '
      .containerDefinitions[0].environment += [{"name":"CHAOS_LATENCY_MS","value":$ms}]
      | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,
            .compatibilities,.registeredAt,.registeredBy)
    ' > /tmp/orders-chaos.json
CHAOS_TD=$(aws ecs register-task-definition --cli-input-json file:///tmp/orders-chaos.json \
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
```

Run it:

```bash
chmod +x chaos/latency.sh
./chaos/latency.sh                  # default 500ms for 3 min
./chaos/latency.sh 300 1000         # 1000ms for 5 min
```

**Hypothesis**: p95 latency on `/orders` jumps from ~50 ms baseline to
~550 ms within 30 s of the rollout completing; recovery within 60 s of
rollback; no cascade into Cart or Catalog because they don't call Orders
synchronously.

**Steady-state metric**: ALB `TargetResponseTime` p95 on the orders target
group, plus the storefront's checkout round-trip-time displayed in the
order-success modal.

### 10.3 Running a chaos session for the resilience report

For each experiment:

1. Start `baseline.js` k6 from the EC2 (60 RPS steady).
2. Wait 60 s for steady state — confirm dashboard shows 1 task per service,
   ALB 5xx near zero, p95 latency stable.
3. Run the chaos script.
4. Watch the dashboard. Note the time of the first signal (target unhealthy /
   latency spike) and the time of full recovery.
5. Stop k6.
6. Export the relevant CloudWatch metric data — write recovery time and
   peak error/latency into the resilience report.

The two experiments together exercise the auto-scaling, ALB target health,
inter-service timeout behaviour, and request-path latency — the four
properties the resilience report quantifies.

---

## 11. Phase 9 — Demo Runbook (viva day)

Order of operations during the live viva (memorize this):

1. **Pre-flight (T-15 min)**: ensure stack is up per §13 Resume; baseline k6
   running for 60 s; CloudWatch dashboard up on one screen, **GIKI Mart
   storefront open on another**.
2. **T-0: explain architecture** using the diagram in §2 (60 s).
3. **T-1: show normal operation in the storefront** — browse products, add
   two items to the cart, place an order, show the order confirmation modal
   and the round-trip latency. Point at the 1-task baseline on the dashboard.
4. **T-3: start `spike.js`** on the k6 EC2; narrate auto-scaling kicking in
   (target count climbs 1 → 3, CPU drops back below 60 %). Reload the
   storefront mid-spike to show it stays responsive.
5. **T-6: run `chaos/kill-task.sh catalog`**; show ALB target marked
   unhealthy and a new task replacing it; user-visible 5xx stays low; place
   another order from the storefront to prove it.
6. **T-9: run `chaos/latency.sh 180 500`**; show p95 latency spike on the
   dashboard; place an order — the round-trip time in the storefront's
   success modal jumps from ~50 ms to ~550 ms, then recovers when the
   script rolls back.
7. **T-13: walk through the resilience report** (printed handout).
8. **T-15: Q&A.**

Have **two backup screenshots** of a previously successful run (dashboard +
storefront) in case AWS misbehaves on the day. A clickable storefront lands
much harder than a `curl` in front of the examiner.

> **Why scripted, not FIS?** If asked, the honest answer is the right one:
> "FIS requires a paid AWS account tier, so we implemented the same two
> experiments via direct ECS API calls. The dashboard signatures are
> identical to what FIS would produce — task termination triggers ALB
> target replacement, env-var rollout injects latency on every Orders task.
> A FIS migration is in Future Work in the proposal."

---

## 12. Pause Procedure

Run these the moment you finish a work session OR after the build is
complete and you're waiting for viva day. **Pick one strategy.**

### 12.A Strategy A — Short pause (≤ 7 days)

Best when you'll be back tomorrow. Costs ~$50/month while paused (ALB + NAT keep billing). Resume in < 10 minutes.

```bash
# 1. Scale all Fargate services to 0 — Fargate billing stops
for svc in catalog cart orders; do
  aws ecs update-service --cluster ce-408-cluster --service ce-408-$svc --desired-count 0
done

# 2. Stop the RDS instance — billing stops, max 7 days then auto-restarts
aws rds stop-db-instance --db-instance-identifier ce-408-postgres

# 3. Stop the k6 EC2
K6_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=ce-408-k6" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
[ -n "$K6_ID" ] && aws ec2 stop-instances --instance-ids $K6_ID
```

That's it. ALB, NAT GW, VPC, IAM, ECR, task definitions, dashboard all stay in place — resume is just the inverse of the above.

### 12.B Strategy B — Long pause (> 7 days, RECOMMENDED for waiting until viva)

Best when the viva is weeks out. Costs **under $1/month**. Resume takes ~30 minutes; **practice the resume once before viva day**.

```bash
# === 1. Snapshot RDS, then delete the instance ===
aws rds create-db-snapshot \
  --db-snapshot-identifier ce-408-postgres-pause \
  --db-instance-identifier ce-408-postgres
aws rds wait db-snapshot-available --db-snapshot-identifier ce-408-postgres-pause
aws rds delete-db-instance --db-instance-identifier ce-408-postgres \
  --skip-final-snapshot --delete-automated-backups

# === 2. Scale Fargate to 0 (you can also delete services — task defs persist for free) ===
for svc in catalog cart orders; do
  aws ecs update-service --cluster ce-408-cluster --service ce-408-$svc --desired-count 0
done

# === 3. Delete the ALB (target groups stay — they're free) ===
ALB_ARN=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].LoadBalancerArn" --output text)
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN

# === 4. Delete the NAT Gateway and release its EIP ===
NAT_ID=$(aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=$VPC_ID" "Name=state,Values=available" \
  --query "NatGateways[0].NatGatewayId" --output text)
EIP_ALLOC=$(aws ec2 describe-nat-gateways --nat-gateway-ids $NAT_ID \
  --query "NatGateways[0].NatGatewayAddresses[0].AllocationId" --output text)
aws ec2 delete-nat-gateway --nat-gateway-id $NAT_ID
# Wait for the NAT to actually delete (~2 min) before releasing the EIP
aws ec2 wait nat-gateway-deleted --nat-gateway-ids $NAT_ID
aws ec2 release-address --allocation-id $EIP_ALLOC

# === 5. Stop (or terminate) the k6 EC2 ===
K6_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=ce-408-k6" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
[ -n "$K6_ID" ] && aws ec2 stop-instances --instance-ids $K6_ID

# === 6. Delete the dashboard (saves $3/month) ===
aws cloudwatch delete-dashboards --dashboard-names ce-408
# (You'll re-create it on resume from the dashboard.json file you saved.)

# === 7. Sanity check — what's left billable? ===
aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=$PROJECT \
  --query "ResourceTagMappingList[].ResourceARN" --output table
```

After Strategy B, the only things still in the account are:

- VPC, subnets, IGW, route tables, security groups (free)
- IAM roles (free)
- ECR images (~$0.10/month)
- ECS task definitions (free, including the chaos-latency one)
- Target groups (free)
- DynamoDB table — empty, on-demand → $0
- SQS queue — empty → $0
- RDS snapshot (~$0.02/GB-month → ~$0.50)
- SSM parameters (free)
- Stopped EC2 + EBS volume (~$1)

**Total: well under $1/month.** Verify in Cost Explorer 24 h after the pause.

### 12.C Pause checklist

| # | Resource | Action | Cost after |
|---|---|---|---|
| 1 | ECS services (×3) | `update-service --desired-count 0` | $0 |
| 2 | RDS Postgres | Snapshot, then `delete-db-instance --skip-final-snapshot` | ~$0.50 (snapshot) |
| 3 | ALB | `delete-load-balancer` | $0 |
| 4 | NAT Gateway | `delete-nat-gateway` + `release-address` | $0 |
| 5 | EC2 k6 | `stop-instances` | ~$1 (EBS) |
| 6 | CloudWatch dashboard | `delete-dashboards` | $0 |
| 7 | DynamoDB | (leave) | $0 |
| 8 | SQS | (leave) | $0 |
| 9 | ECR images | (leave) | ~$0.10 |
| 10 | S3 storefront | (leave) | ~$0 |
| 11 | Task definitions, IAM, VPC | (leave) | $0 |

The S3 storefront stays live throughout the pause, but it'll show "Failed to load products" while the ALB is gone. That's fine — it lights up again the moment you resume in §13 (after a quick re-deploy with the new ALB DNS).

---

## 13. Resume Procedure (viva day, T-60 min)

For Strategy B — about 30 minutes wall-clock, mostly waiting.

```bash
# Reload your shell variables (export AWS_REGION, ACCOUNT_ID, PROJECT, VPC_ID,
# subnets, security groups — keep a `vars.sh` file from the build)
source vars.sh

# === 1. Recreate NAT Gateway + EIP ===
EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
NAT_ID=$(aws ec2 create-nat-gateway --subnet-id $PUB_SUBNET_1 \
  --allocation-id $EIP_ALLOC --query "NatGateway.NatGatewayId" --output text)
aws ec2 wait nat-gateway-available --nat-gateway-ids $NAT_ID

# Update the private route table to point 0.0.0.0/0 at the new NAT
PRIV_RTB=$(aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=association.subnet-id,Values=$PRIV_SUBNET_1" \
  --query "RouteTables[0].RouteTableId" --output text)
aws ec2 delete-route --route-table-id $PRIV_RTB --destination-cidr-block 0.0.0.0/0 || true
aws ec2 create-route --route-table-id $PRIV_RTB \
  --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT_ID

# === 2. Restore RDS from snapshot ===
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier ce-408-postgres \
  --db-snapshot-identifier ce-408-postgres-pause \
  --db-instance-class db.t4g.micro \
  --db-subnet-group-name ce-408-db-subnets \
  --vpc-security-group-ids $RDS_SG \
  --no-publicly-accessible
aws rds wait db-instance-available --db-instance-identifier ce-408-postgres
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier ce-408-postgres \
  --query "DBInstances[0].Endpoint.Address" --output text)

# Endpoint may have changed — update SSM and any task defs that hardcoded it
MSYS_NO_PATHCONV=1 aws ssm put-parameter --name "/ce-408/rds/endpoint" --type String --value "$RDS_ENDPOINT" --overwrite
# Re-register task defs (update DB_HOST value in catalog-taskdef.json and orders-taskdef.json if endpoint changed, then):
aws ecs register-task-definition --cli-input-json file://catalog-taskdef.json
aws ecs register-task-definition --cli-input-json file://orders-taskdef.json

# === 3. Recreate ALB and listener rules ===
ALB_ARN=$(aws elbv2 create-load-balancer --name ce-408-alb --type application \
  --scheme internet-facing --subnets $PUB_SUBNET_1 $PUB_SUBNET_2 \
  --security-groups $ALB_SG --tags Key=Project,Value=$PROJECT \
  --query "LoadBalancers[0].LoadBalancerArn" --output text)

CATALOG_TG=$(aws elbv2 describe-target-groups --names ce-408-catalog-tg --query "TargetGroups[0].TargetGroupArn" --output text)
CART_TG=$(aws elbv2 describe-target-groups   --names ce-408-cart-tg    --query "TargetGroups[0].TargetGroupArn" --output text)
ORDERS_TG=$(aws elbv2 describe-target-groups --names ce-408-orders-tg  --query "TargetGroups[0].TargetGroupArn" --output text)

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

# Reattach services to the new target groups (services keep their TG link
# only if you didn't delete the service — if you did, recreate per §6.4)
for svc in catalog cart orders; do
  aws ecs update-service --cluster ce-408-cluster --service ce-408-$svc --desired-count 1
done
aws ecs wait services-stable --cluster ce-408-cluster \
  --services ce-408-catalog ce-408-cart ce-408-orders

# === 4. Recreate the dashboard ===
LB_SUFFIX=$(echo $ALB_ARN | awk -F'loadbalancer/' '{print $2}')
sed -i "s|app/ce-408-alb/[A-Za-z0-9]*|$LB_SUFFIX|g" dashboard.json
aws cloudwatch put-dashboard --dashboard-name ce-408 --dashboard-body file://dashboard.json

# === 5. Start the k6 EC2 ===
K6_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=ce-408-k6" "Name=instance-state-name,Values=stopped" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
aws ec2 start-instances --instance-ids $K6_ID
aws ec2 wait instance-running --instance-ids $K6_ID

# === 6. Re-deploy the storefront with the new ALB DNS ===
ALB_DNS=$(aws elbv2 describe-load-balancers --names ce-408-alb \
  --query "LoadBalancers[0].DNSName" --output text)
BUCKET=ce-408-storefront-$ACCOUNT_ID
sed "s/__ALB_DNS__/$ALB_DNS/g" storefront/index.html > storefront/index.deploy.html
aws s3 cp storefront/index.deploy.html s3://$BUCKET/index.html \
  --content-type "text/html" --cache-control "no-cache"

# === 7. Smoke test ===
curl http://$ALB_DNS/catalog/products
curl http://$ALB_DNS/cart/sessions/u1
echo "Storefront: http://$BUCKET.s3-website-$AWS_REGION.amazonaws.com"
```

If the smoke test passes, open the storefront URL in a browser, run a
60-second baseline k6 to populate the dashboard, and you're demo-ready.

> **Quick alternative for the storefront URL after resume:** instead of
> re-deploying the HTML, just open the storefront with `?api=NEW_ALB_DNS`
> appended once — the new DNS is remembered in localStorage for the rest of
> the session. Useful if you forget step 6 above.

---

## 14. Full Teardown (after viva)

Order matters — delete dependents before parents.

```bash
# Delete ECS services
for svc in catalog cart orders; do
  aws ecs update-service --cluster ce-408-cluster --service ce-408-$svc --desired-count 0
  aws ecs delete-service --cluster ce-408-cluster --service ce-408-$svc --force
done
aws ecs delete-cluster --cluster ce-408-cluster

# Delete ALB, listener, target groups
ALB_ARN=$(aws elbv2 describe-load-balancers --names ce-408-alb --query "LoadBalancers[0].LoadBalancerArn" --output text 2>/dev/null || true)
[ -n "$ALB_ARN" ] && aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN
for svc in catalog cart orders; do
  TG=$(aws elbv2 describe-target-groups --names ce-408-$svc-tg --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null || true)
  [ -n "$TG" ] && aws elbv2 delete-target-group --target-group-arn $TG
done

# Delete RDS (no final snapshot = $0 going forward) and any saved snapshots
aws rds delete-db-instance --db-instance-identifier ce-408-postgres --skip-final-snapshot 2>/dev/null || true
aws rds delete-db-snapshot --db-snapshot-identifier ce-408-postgres-pause 2>/dev/null || true
aws rds delete-db-subnet-group --db-subnet-group-name ce-408-db-subnets

# DynamoDB, SQS
aws dynamodb delete-table --table-name ce-408-cart-sessions
aws sqs delete-queue --queue-url $(aws sqs get-queue-url --queue-name ce-408-orders-fulfilment --query QueueUrl --output text)

# ECR (deletes images too)
for r in catalog cart orders; do aws ecr delete-repository --repository-name ce-408/$r --force; done

# S3 storefront bucket (empty first, then delete)
BUCKET=ce-408-storefront-$ACCOUNT_ID
aws s3 rm s3://$BUCKET --recursive 2>/dev/null || true
aws s3api delete-bucket --bucket $BUCKET 2>/dev/null || true

# EC2 + key pair + SG
K6_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=ce-408-k6" --query "Reservations[].Instances[].InstanceId" --output text)
[ -n "$K6_ID" ] && aws ec2 terminate-instances --instance-ids $K6_ID
aws ec2 delete-key-pair --key-name ce-408-k6

# NAT GW + EIP (if still around)
NAT_ID=$(aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VPC_ID" "Name=state,Values=available" --query "NatGateways[0].NatGatewayId" --output text 2>/dev/null || true)
if [ "$NAT_ID" != "None" ] && [ -n "$NAT_ID" ]; then
  aws ec2 delete-nat-gateway --nat-gateway-id $NAT_ID
  aws ec2 wait nat-gateway-deleted --nat-gateway-ids $NAT_ID
fi

# CloudWatch
aws cloudwatch delete-dashboards --dashboard-names ce-408 2>/dev/null || true
aws cloudwatch delete-alarms --alarm-names ce-408-alb-5xx-high 2>/dev/null || true
aws logs delete-log-group --log-group-name /ecs/ce-408 2>/dev/null || true

# (No FIS templates to delete — chaos was scripted.)

# IAM roles
for r in ce-408-ecs-exec ce-408-task-role; do
  for p in $(aws iam list-attached-role-policies --role-name $r --query "AttachedPolicies[].PolicyArn" --output text); do
    aws iam detach-role-policy --role-name $r --policy-arn $p
  done
  for p in $(aws iam list-role-policies --role-name $r --query "PolicyNames" --output text); do
    aws iam delete-role-policy --role-name $r --policy-name $p
  done
  aws iam delete-role --role-name $r
done

# SSM parameters
for p in /ce-408/rds/password /ce-408/rds/endpoint /ce-408/sqs/orders-url /ce-408/dynamodb/cart-table; do
  aws ssm delete-parameter --name $p
done

# Finally — VPC (use console: VPC → ce-408-vpc → Delete VPC; it cascades subnets/IGW/RTBs/SGs)
```

Verify nothing remains:

```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=$PROJECT
```

Should return an empty array. Also check **AWS Cost Explorer** 24 h later for any stragglers.

---

## 15. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| ECS task stuck in `PROVISIONING` for > 5 min | Subnet has no NAT route or NAT GW deleted | Check route table; private subnet must have `0.0.0.0/0 → nat-gw-xxx` |
| ECS task stops with `CannotPullContainerError` | Same as above — can't reach ECR | Confirm NAT works, or add VPC endpoints for ECR + S3 |
| ALB target unhealthy | SG mismatch, wrong port, wrong health-check path | Verify `SVC_SG` allows 8000 from `ALB_SG`; health check path = `/healthz` |
| RDS `Connection refused` | RDS SG doesn't allow 5432 from service SG | `authorize-security-group-ingress` chain |
| `chaos/kill-task.sh` says "no running task" | Service is scaled to 0 or still provisioning | `aws ecs describe-services --cluster ce-408-cluster --services ce-408-catalog` — confirm `desiredCount` and `runningCount` ≥ 1 |
| `chaos/latency.sh` finishes but latency never rose | Middleware not deployed; CHAOS_LATENCY_MS is being read at import-time but the new task def isn't running yet | Check `aws ecs describe-services` — wait for the new task def revision to be `runningCount` then re-test; verify the env var is on the new task with `aws ecs describe-tasks` |
| RDS endpoint changed after restore-from-snapshot and services keep crashing | Old endpoint baked into task definition | Re-register task def with new `DB_HOST` env, then `update-service --force-new-deployment` |
| Stuck deletion of VPC | Some ENI / SG dependency lingering | `aws ec2 describe-network-interfaces --filters Name=vpc-id,Values=$VPC_ID` to find the holdout |
| Cost Explorer shows charges after teardown | NAT GW still up or ALB still up | The two services that bill hourly with no usage. Check for stragglers by ARN tag filter |

---

## Appendix A — `vars.sh` template

Save this file alongside the README and `source vars.sh` at the start of every session:

```bash
export AWS_REGION=us-east-1
export PROJECT=ce-408
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export TAG="Key=Project,Value=$PROJECT"

export VPC_ID=vpc-xxxxxxxx
export PUB_SUBNET_1=subnet-xxxxxxxx
export PUB_SUBNET_2=subnet-yyyyyyyy
export PRIV_SUBNET_1=subnet-zzzzzzzz
export PRIV_SUBNET_2=subnet-wwwwwwww

export ALB_SG=sg-xxxxxxxx
export SVC_SG=sg-yyyyyyyy
export RDS_SG=sg-zzzzzzzz
```

---

## Appendix B — One-page operator checklist

**End of work session:**
- [ ] Push any code changes to git
- [ ] Run §12.A (or §12.B if you'll be away > 7 days)
- [ ] Confirm `aws ecs list-tasks` returns nothing in any service
- [ ] Spot-check Cost Explorer next morning

**1 hour before viva:**
- [ ] Run §13 resume procedure
- [ ] Wait for `services-stable`
- [ ] Smoke test all three endpoints
- [ ] Run baseline k6 for 60 s — confirm dashboard widgets populate
- [ ] Have `chaos/kill-task.sh` and `chaos/latency.sh` open in a terminal, pre-tested

**Day after viva:**
- [ ] Run §14 teardown
- [ ] Verify empty `get-resources` result
- [ ] Delete the AWS Budget alert (or keep for next project)
