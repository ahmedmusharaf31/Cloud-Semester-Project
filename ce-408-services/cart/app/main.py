from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os, boto3
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

dynamo = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))
table = dynamo.Table(os.environ.get("CART_TABLE", "ce-408-cart-sessions"))

class ItemBody(BaseModel):
    sku: str = None
    qty: int = 1

@app.get("/healthz")
async def healthz(): return {"ok": True}

@app.get("/cart/sessions/{userId}")
async def get_cart(userId: str):
    r = table.get_item(Key={"userId": userId})
    item = r.get("Item", {"userId": userId, "items": {}})
    items_dict = item.get("items", {})
    return {"userId": userId, "items": [{"sku": k, "qty": int(v)} for k, v in items_dict.items()]}

@app.post("/cart/sessions/{userId}/items")
async def add_item(userId: str, body: ItemBody):
    r = table.get_item(Key={"userId": userId})
    current = r.get("Item", {}).get("items", {})
    new_qty = int(current.get(body.sku, 0)) + body.qty
    table.update_item(
        Key={"userId": userId},
        UpdateExpression="SET #it = if_not_exists(#it, :empty)",
        ExpressionAttributeNames={"#it": "items"},
        ExpressionAttributeValues={":empty": {}}
    )
    table.update_item(
        Key={"userId": userId},
        UpdateExpression="SET #it.#sku = :q",
        ExpressionAttributeNames={"#it": "items", "#sku": body.sku},
        ExpressionAttributeValues={":q": new_qty}
    )
    return {"userId": userId, "sku": body.sku, "qty": new_qty}

@app.put("/cart/sessions/{userId}/items/{sku}")
async def upsert_item(userId: str, sku: str, body: ItemBody):
    if body.qty == 0:
        table.update_item(
            Key={"userId": userId},
            UpdateExpression="REMOVE #it.#sku",
            ExpressionAttributeNames={"#it": "items", "#sku": sku}
        )
    else:
        table.update_item(
            Key={"userId": userId},
            UpdateExpression="SET #it.#sku = :q",
            ExpressionAttributeNames={"#it": "items", "#sku": sku},
            ExpressionAttributeValues={":q": body.qty}
        )
    return {"userId": userId, "sku": sku, "qty": body.qty}

@app.delete("/cart/sessions/{userId}")
async def clear_cart(userId: str):
    table.delete_item(Key={"userId": userId})
    return {"cleared": True}
