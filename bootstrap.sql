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
  ('SKU-003','Mechanical Keyboard',8999,25),
  ('SKU-004','Noise-Cancelling Headphones',14999,40),
  ('SKU-005','Bluetooth Speaker',6499,60),
  ('SKU-006','4K Webcam',7999,35),
  ('SKU-007','27-inch 4K Monitor',24999,18),
  ('SKU-008','Portable SSD Drive',10999,45),
  ('SKU-009','Adjustable Desk Stand',4499,8),
  ('SKU-010','65W USB-C Charger',2999,90);

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
