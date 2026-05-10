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
