from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os, asyncpg, boto3, json, asyncio
from pydantic import BaseModel

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

_catalog_pool = None
async def get_catalog_pool():
    global _catalog_pool
    if _catalog_pool is None:
        _catalog_pool = await asyncpg.create_pool(
            host=os.environ["DB_HOST"], database="catalog",
            user="ce408admin", password=os.environ["DB_PASSWORD"],
            min_size=1, max_size=2)
    return _catalog_pool

sqs = boto3.client("sqs", region_name=os.environ.get("AWS_REGION", "us-east-1"))
QUEUE_URL = os.environ.get("ORDERS_QUEUE_URL", "")

class OrderItem(BaseModel):
    sku: str
    qty: int

class OrderIn(BaseModel):
    userId: str
    items: list[OrderItem]

@app.get("/healthz")
async def healthz(): return {"ok": True}

@app.post("/orders")
async def create_order(body: OrderIn):
    catalog = await get_catalog_pool()
    async with catalog.acquire() as conn:
        prices = {r["sku"]: r["price_cents"] for r in await conn.fetch("SELECT sku, price_cents FROM products")}

    total = sum(prices.get(i.sku, 0) * i.qty for i in body.items)
    pool = await get_pool()
    async with pool.acquire() as conn:
        order_id = await conn.fetchval(
            "INSERT INTO orders(user_id, total_cents, status) VALUES($1,$2,'PENDING') RETURNING id",
            body.userId, total)
        for i in body.items:
            await conn.execute(
                "INSERT INTO order_items(order_id, sku, qty, price_cents) VALUES($1,$2,$3,$4)",
                order_id, i.sku, i.qty, prices.get(i.sku, 0))

    if QUEUE_URL:
        sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps({"order_id": order_id}))
    return {"orderId": order_id, "total_cents": total, "status": "PENDING"}

@app.get("/orders/{order_id}")
async def get_order(order_id: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.fetchrow("SELECT * FROM orders WHERE id=$1", order_id)
        if not r: raise HTTPException(404)
        return dict(r)
