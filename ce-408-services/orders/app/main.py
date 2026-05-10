from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os, asyncpg, boto3, json, asyncio

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

CHAOS_LATENCY_MS = int(os.environ.get("CHAOS_LATENCY_MS", "0"))

@app.middleware("http")
async def inject_chaos_latency(request, call_next):
    if CHAOS_LATENCY_MS:
        await asyncio.sleep(CHAOS_LATENCY_MS / 1000)
    return await call_next(request)

_pool = None
async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            host=os.environ["DB_HOST"], database="orders",
            user="ce408admin", password=os.environ["DB_PASSWORD"],
            min_size=1, max_size=4)
    return _pool

sqs = boto3.client("sqs", region_name=os.environ.get("AWS_REGION", "us-east-1"))
QUEUE_URL = os.environ.get("ORDERS_QUEUE_URL", "")

@app.get("/healthz")
async def healthz(): return {"ok": True}

@app.post("/orders")
async def create_order(user_id: str, items: list[dict]):
    total = sum(i["price_cents"] * i["qty"] for i in items)
    pool = await get_pool()
    async with pool.acquire() as conn:
        order_id = await conn.fetchval(
            "INSERT INTO orders(user_id, total_cents, status) VALUES($1,$2,'PENDING') RETURNING id",
            user_id, total)
        for i in items:
            await conn.execute(
                "INSERT INTO order_items(order_id, sku, qty, price_cents) VALUES($1,$2,$3,$4)",
                order_id, i["sku"], i["qty"], i["price_cents"])
    if QUEUE_URL:
        sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps({"order_id": order_id}))
    return {"order_id": order_id, "total_cents": total, "status": "PENDING"}

@app.get("/orders/{order_id}")
async def get_order(order_id: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM orders WHERE id=$1", order_id)
        if not r: raise HTTPException(404)
        return dict(r)
