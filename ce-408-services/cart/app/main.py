from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os, boto3

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

dynamo = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))
table = dynamo.Table(os.environ.get("CART_TABLE", "ce-408-cart-sessions"))

@app.get("/healthz")
async def healthz(): return {"ok": True}

@app.get("/cart/sessions/{userId}")
async def get_cart(userId: str):
    r = table.get_item(Key={"userId": userId})
    return r.get("Item", {"userId": userId, "items": {}})

@app.put("/cart/sessions/{userId}/items/{sku}")
async def upsert_item(userId: str, sku: str, qty: int = 1):
    table.update_item(
        Key={"userId": userId},
        UpdateExpression="SET #it.#sku = :q",
        ExpressionAttributeNames={"#it": "items", "#sku": sku},
        ExpressionAttributeValues={":q": qty}
    )
    return {"userId": userId, "sku": sku, "qty": qty}

@app.delete("/cart/sessions/{userId}")
async def clear_cart(userId: str):
    table.delete_item(Key={"userId": userId})
    return {"cleared": True}
