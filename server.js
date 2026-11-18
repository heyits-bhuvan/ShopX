const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();

// Render reverse proxy ke peeche app chalti hai.
// Session cookies ke liye zaroori hai.
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

const db = new Database(
  process.env.DB_PATH ||
    path.join(__dirname, "shopx.sqlite")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL NOT NULL CHECK(price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    image TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    UNIQUE(user_id, product_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    UNIQUE(user_id, product_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    address TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );
`);

/* -----------------------------
   Default products
----------------------------- */

const productCount = db
  .prepare("SELECT COUNT(*) AS count FROM products")
  .get().count;

if (productCount === 0) {
  const insertProduct = db.prepare(`
    INSERT INTO products
    (name, category, description, price, stock, image)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const defaultProducts = [
    [
      "Studio Wireless Headphones",
      "Audio",
      "Comfortable wireless headphones with rich sound.",
      3499,
      18,
      "🎧"
    ],
    [
      "Everyday Digital Camera",
      "Electronics",
      "Compact camera for everyday photography.",
      12999,
      7,
      "📷"
    ],
    [
      "Minimalist Wristwatch",
      "Accessories",
      "A clean everyday watch with a durable strap.",
      2299,
      12,
      "⌚"
    ],
    [
      "Ceramic Morning Mug",
      "Home",
      "A ceramic mug for your morning coffee.",
      649,
      25,
      "☕"
    ],
    [
      "Classic Running Shoes",
      "Fashion",
      "Lightweight shoes for daily training.",
      2799,
      14,
      "👟"
    ],
    [
      "Portable Bluetooth Speaker",
      "Audio",
      "Portable speaker with clear audio.",
      1899,
      20,
      "🔊"
    ],
    [
      "Smart Desk Lamp",
      "Home",
      "Adjustable desk lamp with warm lighting.",
      1499,
      9,
      "💡"
    ],
    [
      "Mechanical Keyboard",
      "Electronics",
      "Tactile keyboard for work and gaming.",
      4299,
      11,
      "⌨️"
    ],
    [
      "Canvas Backpack",
      "Fashion",
      "Everyday backpack with roomy compartments.",
      1599,
      16,
      "🎒"
    ]
  ];

  defaultProducts.forEach(product => {
    insertProduct.run(...product);
  });
}

/* -----------------------------
   Default users
----------------------------- */

function seedUser(name, email, password, role) {
  const cleanEmail = email.trim().toLowerCase();

  const existingUser = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(cleanEmail);

  if (!existingUser) {
    db.prepare(`
      INSERT INTO users
      (name, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(
      name,
      cleanEmail,
      bcrypt.hashSync(password, 10),
      role
    );
  }
}

seedUser(
  "ShopX Admin",
  "admin@shopx.test",
  "Admin123!",
  "admin"
);

seedUser(
  "Demo Customer",
  "customer@shopx.test",
  "Customer123!",
  "customer"
);

/* -----------------------------
   Middleware
----------------------------- */

app.use(express.json());

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "change-this-shopx-session-secret",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(express.static(__dirname));

/* -----------------------------
   Helpers
----------------------------- */

function safeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

function createUserSession(
  req,
  res,
  user,
  statusCode = 200
) {
  req.session.regenerate(error => {
    if (error) {
      console.error(
        "Session regenerate error:",
        error
      );

      return res.status(500).json({
        error:
          "Account was created, but the session could not be started."
      });
    }

    req.session.user = user;

    req.session.save(saveError => {
      if (saveError) {
        console.error(
          "Session save error:",
          saveError
        );

        return res.status(500).json({
          error:
            "Account was created, but the login session could not be saved."
        });
      }

      return res.status(statusCode).json({
        user
      });
    });
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  return res.status(401).json({
    error: "Please log in to continue."
  });
}

function requireAdmin(req, res, next) {
  if (
    req.session &&
    req.session.user &&
    req.session.user.role === "admin"
  ) {
    return next();
  }

  return res.status(403).json({
    error: "Admin access required."
  });
}

/* -----------------------------
   Health and authentication
----------------------------- */

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "ShopX",
    database: "connected"
  });
});

app.get("/api/auth/me", (req, res) => {
  res.json({
    user: req.session?.user || null
  });
});

app.post("/api/auth/register", (req, res) => {
  const {
    name,
    email,
    password
  } = req.body || {};

  if (
    !name ||
    !name.trim() ||
    !email ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({
      error:
        "Name, email and password are required."
    });
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  ) {
    return res.status(400).json({
      error: "Enter a valid email address."
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error:
        "Password must be at least 8 characters."
    });
  }

  try {
    const result = db
      .prepare(`
        INSERT INTO users
        (name, email, password_hash, role)
        VALUES (?, ?, ?, 'customer')
      `)
      .run(
        cleanName,
        cleanEmail,
        bcrypt.hashSync(password, 10)
      );

    const userRow = db
      .prepare(
        "SELECT * FROM users WHERE id = ?"
      )
      .get(result.lastInsertRowid);

    const user = safeUser(userRow);

    return createUserSession(
      req,
      res,
      user,
      201
    );
  } catch (error) {
    console.error("Register error:", error);

    if (
      String(error.message).includes("UNIQUE")
    ) {
      return res.status(409).json({
        error:
          "An account with this email already exists."
      });
    }

    return res.status(500).json({
      error: "Could not create the account."
    });
  }
});

app.post("/api/auth/login", (req, res) => {
  const {
    email,
    password
  } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required."
    });
  }

  const cleanEmail = email.trim().toLowerCase();

  const userRow = db
    .prepare(
      "SELECT * FROM users WHERE email = ?"
    )
    .get(cleanEmail);

  if (
    !userRow ||
    !bcrypt.compareSync(
      password,
      userRow.password_hash
    )
  ) {
    return res.status(401).json({
      error: "Invalid email or password."
    });
  }

  const user = safeUser(userRow);

  return createUserSession(
    req,
    res,
    user,
    200
  );
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      console.error("Logout error:", error);

      return res.status(500).json({
        error: "Could not log out."
      });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    return res.json({
      message: "Logged out successfully."
    });
  });
});

/* -----------------------------
   Products
----------------------------- */

app.get("/api/products", (req, res) => {
  const {
    search = "",
    category = "",
    sort = "popular",
    min = "",
    max = ""
  } = req.query;

  let sql = `
    SELECT *
    FROM products
    WHERE active = 1
  `;

  const args = [];

  if (search) {
    sql += `
      AND (
        name LIKE ?
        OR description LIKE ?
      )
    `;

    args.push(
      `%${search}%`,
      `%${search}%`
    );
  }

  if (category) {
    sql += " AND category = ?";
    args.push(category);
  }

  if (min !== "") {
    sql += " AND price >= ?";
    args.push(Number(min));
  }

  if (max !== "") {
    sql += " AND price <= ?";
    args.push(Number(max));
  }

  if (sort === "price-low") {
    sql += " ORDER BY price ASC";
  } else if (sort === "price-high") {
    sql += " ORDER BY price DESC";
  } else {
    sql += " ORDER BY id DESC";
  }

  return res.json(
    db.prepare(sql).all(...args)
  );
});

app.get("/api/products/:id", (req, res) => {
  const product = db
    .prepare(`
      SELECT *
      FROM products
      WHERE id = ?
      AND active = 1
    `)
    .get(req.params.id);

  if (!product) {
    return res.status(404).json({
      error: "Product not found."
    });
  }

  return res.json(product);
});

/* -----------------------------
   Admin products
----------------------------- */

app.post(
  "/api/admin/products",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const {
      name,
      category,
      description = "",
      price,
      stock,
      image = "📦"
    } = req.body || {};

    if (
      !name ||
      !name.trim() ||
      !category ||
      !category.trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0 ||
      !Number.isInteger(Number(stock)) ||
      Number(stock) < 0
    ) {
      return res.status(400).json({
        error:
          "Enter a product name, category, valid price and non-negative whole-number stock."
      });
    }

    const result = db
      .prepare(`
        INSERT INTO products
        (name, category, description, price, stock, image)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        name.trim(),
        category.trim(),
        description,
        Number(price),
        Number(stock),
        image
      );

    const product = db
      .prepare(
        "SELECT * FROM products WHERE id = ?"
      )
      .get(result.lastInsertRowid);

    return res.status(201).json(product);
  }
);

app.put(
  "/api/admin/products/:id",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const {
      name,
      category,
      description = "",
      price,
      stock,
      image = "📦"
    } = req.body || {};

    if (
      !name ||
      !name.trim() ||
      !category ||
      !category.trim() ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0 ||
      !Number.isInteger(Number(stock)) ||
      Number(stock) < 0
    ) {
      return res.status(400).json({
        error:
          "Please enter valid product details."
      });
    }

    const result = db
      .prepare(`
        UPDATE products
        SET
          name = ?,
          category = ?,
          description = ?,
          price = ?,
          stock = ?,
          image = ?
        WHERE id = ?
      `)
      .run(
        name.trim(),
        category.trim(),
        description,
        Number(price),
        Number(stock),
        image,
        req.params.id
      );

    if (!result.changes) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    const product = db
      .prepare(
        "SELECT * FROM products WHERE id = ?"
      )
      .get(req.params.id);

    return res.json(product);
  }
);

app.delete(
  "/api/admin/products/:id",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const result = db
      .prepare(`
        UPDATE products
        SET active = 0
        WHERE id = ?
      `)
      .run(req.params.id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    return res.json({
      message: "Product deleted successfully."
    });
  }
);

/* -----------------------------
   Cart
----------------------------- */

app.get(
  "/api/cart",
  requireAuth,
  (req, res) => {
    const items = db
      .prepare(`
        SELECT
          c.quantity,
          p.*
        FROM cart_items c
        JOIN products p
          ON p.id = c.product_id
        WHERE c.user_id = ?
        AND p.active = 1
      `)
      .all(req.session.user.id);

    return res.json(items);
  }
);

app.post(
  "/api/cart",
  requireAuth,
  (req, res) => {
    const {
      productId,
      quantity = 1
    } = req.body || {};

    const product = db
      .prepare(`
        SELECT *
        FROM products
        WHERE id = ?
        AND active = 1
      `)
      .get(productId);

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    if (
      !Number.isInteger(Number(quantity)) ||
      Number(quantity) < 1
    ) {
      return res.status(400).json({
        error: "Quantity must be at least 1."
      });
    }

    const existing = db
      .prepare(`
        SELECT quantity
        FROM cart_items
        WHERE user_id = ?
        AND product_id = ?
      `)
      .get(
        req.session.user.id,
        productId
      );

    const nextQuantity =
      Number(existing?.quantity || 0) +
      Number(quantity);

    if (nextQuantity > product.stock) {
      return res.status(400).json({
        error:
          "Requested quantity exceeds available stock."
      });
    }

    db.prepare(`
      INSERT INTO cart_items
      (user_id, product_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, product_id)
      DO UPDATE SET quantity = excluded.quantity
    `).run(
      req.session.user.id,
      productId,
      nextQuantity
    );

    return res.json({
      message: "Product added to cart."
    });
  }
);

app.put(
  "/api/cart/:productId",
  requireAuth,
  (req, res) => {
    const quantity = Number(
      req.body?.quantity
    );

    const product = db
      .prepare(
        "SELECT stock FROM products WHERE id = ?"
      )
      .get(req.params.productId);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return res.status(400).json({
        error: "Quantity must be at least 1."
      });
    }

    if (
      !product ||
      quantity > product.stock
    ) {
      return res.status(400).json({
        error:
          "Requested quantity exceeds available stock."
      });
    }

    db.prepare(`
      UPDATE cart_items
      SET quantity = ?
      WHERE user_id = ?
      AND product_id = ?
    `).run(
      quantity,
      req.session.user.id,
      req.params.productId
    );

    return res.json({
      message: "Cart updated."
    });
  }
);

app.delete(
  "/api/cart/:productId",
  requireAuth,
  (req, res) => {
    db.prepare(`
      DELETE FROM cart_items
      WHERE user_id = ?
      AND product_id = ?
    `).run(
      req.session.user.id,
      req.params.productId
    );

    return res.json({
      message: "Item removed from cart."
    });
  }
);

/* -----------------------------
   Wishlist
----------------------------- */

app.get(
  "/api/wishlist",
  requireAuth,
  (req, res) => {
    const items = db
      .prepare(`
        SELECT p.*
        FROM wishlist w
        JOIN products p
          ON p.id = w.product_id
        WHERE w.user_id = ?
        AND p.active = 1
      `)
      .all(req.session.user.id);

    return res.json(items);
  }
);

app.post(
  "/api/wishlist",
  requireAuth,
  (req, res) => {
    const product = db
      .prepare(`
        SELECT id
        FROM products
        WHERE id = ?
        AND active = 1
      `)
      .get(req.body?.productId);

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    db.prepare(`
      INSERT OR IGNORE INTO wishlist
      (user_id, product_id)
      VALUES (?, ?)
    `).run(
      req.session.user.id,
      product.id
    );

    return res.json({
      message: "Added to wishlist."
    });
  }
);

app.delete(
  "/api/wishlist/:productId",
  requireAuth,
  (req, res) => {
    db.prepare(`
      DELETE FROM wishlist
      WHERE user_id = ?
      AND product_id = ?
    `).run(
      req.session.user.id,
      req.params.productId
    );

    return res.json({
      message: "Removed from wishlist."
    });
  }
);

/* -----------------------------
   Orders
----------------------------- */

app.post(
  "/api/orders",
  requireAuth,
  (req, res) => {
    const address = req.body?.address;

    if (!address || !address.trim()) {
      return res.status(400).json({
        error: "Shipping address is required."
      });
    }

    const items = db
      .prepare(`
        SELECT
          c.quantity,
          p.*
        FROM cart_items c
        JOIN products p
          ON p.id = c.product_id
        WHERE c.user_id = ?
        AND p.active = 1
      `)
      .all(req.session.user.id);

    if (!items.length) {
      return res.status(400).json({
        error: "Your cart is empty."
      });
    }

    for (const item of items) {
      if (item.quantity > item.stock) {
        return res.status(400).json({
          error:
            `Insufficient stock for ${item.name}.`
        });
      }
    }

    const total = items.reduce(
      (sum, item) =>
        sum + item.price * item.quantity,
      0
    );

    const createOrder = db.transaction(() => {
      const orderResult = db
        .prepare(`
          INSERT INTO orders
          (user_id, total, address)
          VALUES (?, ?, ?)
        `)
        .run(
          req.session.user.id,
          total,
          address.trim()
        );

      const orderId =
        orderResult.lastInsertRowid;

      const addOrderItem = db.prepare(`
        INSERT INTO order_items
        (order_id, product_id, product_name, price, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);

      const decreaseStock = db.prepare(`
        UPDATE products
        SET stock = stock - ?
        WHERE id = ?
      `);

      items.forEach(item => {
        addOrderItem.run(
          orderId,
          item.id,
          item.name,
          item.price,
          item.quantity
        );

        decreaseStock.run(
          item.quantity,
          item.id
        );
      });

      db.prepare(`
        DELETE FROM cart_items
        WHERE user_id = ?
      `).run(req.session.user.id);

      return orderId;
    });

    const orderId = createOrder();

    return res.status(201).json({
      message: "Order placed successfully.",
      orderId,
      total
    });
  }
);

app.get(
  "/api/orders",
  requireAuth,
  (req, res) => {
    const orders = db
      .prepare(`
        SELECT *
        FROM orders
        WHERE user_id = ?
        ORDER BY id DESC
      `)
      .all(req.session.user.id);

    const result = orders.map(order => ({
      ...order,
      items: db
        .prepare(`
          SELECT *
          FROM order_items
          WHERE order_id = ?
        `)
        .all(order.id)
    }));

    return res.json(result);
  }
);

/* -----------------------------
   Admin orders
----------------------------- */

app.get(
  "/api/admin/orders",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const orders = db
      .prepare(`
        SELECT
          o.*,
          u.name AS customer_name,
          u.email
        FROM orders o
        JOIN users u
          ON u.id = o.user_id
        ORDER BY o.id DESC
      `)
      .all();

    return res.json(orders);
  }
);

app.patch(
  "/api/admin/orders/:id",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const allowedStatuses = [
      "Pending",
      "Confirmed",
      "Shipped",
      "Delivered",
      "Cancelled"
    ];

    const status = req.body?.status;

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid order status."
      });
    }

    const result = db
      .prepare(`
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `)
      .run(
        status,
        req.params.id
      );

    if (!result.changes) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    return res.json({
      message: "Order status updated."
    });
  }
);

/* -----------------------------
   Test reset
----------------------------- */

app.post(
  "/api/test/reset",
  requireAuth,
  requireAdmin,
  (req, res) => {
    db.prepare(
      "DELETE FROM order_items"
    ).run();

    db.prepare(
      "DELETE FROM orders"
    ).run();

    db.prepare(
      "DELETE FROM cart_items"
    ).run();

    db.prepare(
      "DELETE FROM wishlist"
    ).run();

    db.prepare(`
      UPDATE products
      SET stock = 18
      WHERE name = 'Studio Wireless Headphones'
    `).run();

    return res.json({
      message: "Test data reset completed."
    });
  }
);

/* -----------------------------
   Frontend fallback
----------------------------- */

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API route not found."
    });
  }

  return res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* -----------------------------
   Start server
----------------------------- */

app.listen(PORT, () => {
  console.log(
    `ShopX running on port ${PORT}`
  );
});
