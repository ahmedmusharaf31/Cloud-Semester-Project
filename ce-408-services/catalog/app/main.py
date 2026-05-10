from fastapi import FastAPI, HTTPException
import os, asyncpg

app = FastAPI()
_pool = None

async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            host=os.environ["DB_HOST"], database="catalog",
            user="ce408admin", password=os.environ["DB_PASSWORD"],
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
