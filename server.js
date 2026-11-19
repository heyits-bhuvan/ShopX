const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const publicFolder = path.join(__dirname, "public");
const staticFolder = fs.existsSync(
  path.join(publicFolder, "index.html")
)
  ? publicFolder
  : __dirname;

app.use(express.static(staticFolder));

const db = new sqlite3.Database(
  path.join(__dirname, "shopx.sqlite")
);

const sessions = new Map();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
      } else {
        resolve({
          id: this.lastID,
          changes: this.changes
        });
      }
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
      } else {
        resolve(row);
      }
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function setSession(res, user) {
  const token = createToken();

  sessions.set(token, {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  });

  res.cookie("shopx_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  });
}

function clearSession(req, res) {
  const token = req.cookies.shopx_session;

  if (token) {
    sessions.delete(token);
  }

  res.clearCookie("shopx_session");
}

function currentUser(req) {
  const token = req.cookies.shopx_session;

  if (!token) {
    return null;
  }

  return sessions.get(token) || null;
}

function requireLogin(req, res, next) {
  const user = currentUser(req);

  if (!user) {
    return res.status(401).json({
      error: "Please login first."
    });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);

  if (!user) {
    return res.status(401).json({
      error: "Please login first."
    });
  }

  if (user.role !== "admin") {
    return res.status(403).json({
      error: "Admin access required."
    });
  }

  req.user = user;
  next();
}

function asyncRoute(handler) {
  return function (req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function initializeDatabase() {
  await exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      brand TEXT DEFAULT '',
      description TEXT DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      image TEXT DEFAULT '📦',
      rating REAL NOT NULL DEFAULT 4.2,
      popularity INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, product_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      UNIQUE(user_id, product_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Placed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      discount_type TEXT NOT NULL DEFAULT 'percentage',
      discount_value REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const adminPassword = await bcrypt.hash(
    "Admin123!",
    10
  );

  await run(
    `
      INSERT OR IGNORE INTO users
      (name, email, password, role)
      VALUES (?, ?, ?, 'admin')
    `,
    [
      "ShopX Admin",
      "admin@shopx.test",
      adminPassword
    ]
  );

  const customerPassword = await bcrypt.hash(
    "Customer123!",
    10
  );

  await run(
    `
      INSERT OR IGNORE INTO users
      (name, email, password, role)
      VALUES (?, ?, ?, 'customer')
    `,
    [
      "Demo Customer",
      "customer@shopx.test",
      customerPassword
    ]
  );

  const productCount = await get(
    "SELECT COUNT(*) AS count FROM products"
  );

  if (productCount.count === 0) {
    const demoProducts = [
      [
        "Wireless Headphones",
        "Audio",
        "SoundMax",
        "Comfortable wireless headphones with clear sound.",
        1499,
        25,
        "🎧",
        4.5,
        90
      ],
      [
        "Smartphone Stand",
        "Accessories",
        "DeskPro",
        "Adjustable stand for phones and tablets.",
        399,
        40,
        "📱",
        4.2,
        70
      ],
      [
        "Everyday Backpack",
        "Fashion",
        "UrbanCarry",
        "Lightweight backpack for work, college and travel.",
        899,
        18,
        "🎒",
        4.4,
        85
      ],
      [
        "LED Desk Lamp",
        "Home",
        "BrightHome",
        "Modern desk lamp with adjustable brightness.",
        699,
        12,
        "💡",
        4.3,
        62
      ],
      [
        "Bluetooth Speaker",
        "Audio",
        "SoundMax",
        "Portable speaker with powerful wireless sound.",
        1199,
        8,
        "🔊",
        4.1,
        78
      ],
      [
        "Running Shoes",
        "Fashion",
        "MoveFit",
        "Comfortable lightweight shoes for everyday use.",
        1799,
        15,
        "👟",
        4.6,
        92
      ]
    ];

    for (const product of demoProducts) {
      await run(
        `
          INSERT INTO products
          (
            name,
            category,
            brand,
            description,
            price,
            stock,
            image,
            rating,
            popularity
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        product
      );
    }
  }
}

/* ---------------- AUTH ---------------- */

app.get(
  "/api/auth/me",
  asyncRoute(async (req, res) => {
    res.json({
      user: currentUser(req)
    });
  })
);

app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(
      req.body.password || ""
    );

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Name, email and password are required."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters."
      });
    }

    const existing = await get(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing) {
      return res.status(409).json({
        error: "An account with this email already exists."
      });
    }

    const passwordHash = await bcrypt.hash(
      password,
      10
    );

    const result = await run(
      `
        INSERT INTO users
        (name, email, password, role)
        VALUES (?, ?, ?, 'customer')
      `,
      [name, email, passwordHash]
    );

    const user = {
      id: result.id,
      name,
      email,
      role: "customer"
    };

    setSession(res, user);

    res.status(201).json({
      user
    });
  })
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(
      req.body.password || ""
    );

    const user = await get(
      `
        SELECT id, name, email, password, role
        FROM users
        WHERE email = ?
      `,
      [email]
    );

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const valid = await bcrypt.compare(
      password,
      user.password
    );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    setSession(res, safeUser);

    res.json({
      user: safeUser
    });
  })
);

app.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    clearSession(req, res);

    res.json({
      success: true
    });
  })
);

/* ---------------- PRODUCTS ---------------- */

app.get(
  "/api/products",
  asyncRoute(async (req, res) => {
    const search = String(
      req.query.search || ""
    ).trim();

    const category = String(
      req.query.category || ""
    ).trim();

    const sort = String(
      req.query.sort || "popular"
    );

    let sql = `
      SELECT
        id,
        name,
        category,
        brand,
        description,
        price,
        stock,
        image,
        rating,
        popularity,
        created_at
      FROM products
      WHERE 1 = 1
    `;

    const params = [];

    if (search) {
      sql += `
        AND (
          name LIKE ?
          OR description LIKE ?
          OR category LIKE ?
          OR brand LIKE ?
        )
      `;

      const keyword = `%${search}%`;

      params.push(
        keyword,
        keyword,
        keyword,
        keyword
      );
    }

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    if (sort === "price-low") {
      sql += " ORDER BY price ASC";
    } else if (sort === "price-high") {
      sql += " ORDER BY price DESC";
    } else {
      sql += `
        ORDER BY popularity DESC, rating DESC, id DESC
      `;
    }

    const products = await all(sql, params);

    res.json(products);
  })
);

app.get(
  "/api/products/:id",
  asyncRoute(async (req, res) => {
    const product = await get(
      `
        SELECT *
        FROM products
        WHERE id = ?
      `,
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    res.json(product);
  })
);

/* ---------------- CART ---------------- */

app.get(
  "/api/cart",
  requireLogin,
  asyncRoute(async (req, res) => {
    const items = await all(
      `
        SELECT
          p.id,
          p.name,
          p.category,
          p.brand,
          p.description,
          p.price,
          p.stock,
          p.image,
          c.quantity
        FROM cart_items c
        JOIN products p
          ON p.id = c.product_id
        WHERE c.user_id = ?
        ORDER BY c.id DESC
      `,
      [req.user.id]
    );

    res.json(items);
  })
);

app.post(
  "/api/cart",
  requireLogin,
  asyncRoute(async (req, res) => {
    const productId = Number(
      req.body.productId
    );

    const product = await get(
      "SELECT * FROM products WHERE id = ?",
      [productId]
    );

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    if (product.stock < 1) {
      return res.status(400).json({
        error: "This product is out of stock."
      });
    }

    const existing = await get(
      `
        SELECT *
        FROM cart_items
        WHERE user_id = ? AND product_id = ?
      `,
      [req.user.id, productId]
    );

    if (existing) {
      const newQuantity =
        existing.quantity + 1;

      if (newQuantity > product.stock) {
        return res.status(400).json({
          error: "Not enough stock available."
        });
      }

      await run(
        `
          UPDATE cart_items
          SET quantity = ?
          WHERE id = ?
        `,
        [newQuantity, existing.id]
      );
    } else {
      await run(
        `
          INSERT INTO cart_items
          (user_id, product_id, quantity)
          VALUES (?, ?, 1)
        `,
        [req.user.id, productId]
      );
    }

    await run(
      `
        UPDATE products
        SET popularity = popularity + 1
        WHERE id = ?
      `,
      [productId]
    );

    res.status(201).json({
      success: true
    });
  })
);

app.put(
  "/api/cart/:id",
  requireLogin,
  asyncRoute(async (req, res) => {
    const productId = Number(
      req.params.id
    );

    const quantity = Number(
      req.body.quantity
    );

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({
        error: "Quantity must be at least 1."
      });
    }

    const product = await get(
      "SELECT stock FROM products WHERE id = ?",
      [productId]
    );

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    if (quantity > product.stock) {
      return res.status(400).json({
        error: "Requested quantity is not available."
      });
    }

    const result = await run(
      `
        UPDATE cart_items
        SET quantity = ?
        WHERE user_id = ? AND product_id = ?
      `,
      [
        quantity,
        req.user.id,
        productId
      ]
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Cart item not found."
      });
    }

    res.json({
      success: true
    });
  })
);

app.delete(
  "/api/cart/:id",
  requireLogin,
  asyncRoute(async (req, res) => {
    await run(
      `
        DELETE FROM cart_items
        WHERE user_id = ? AND product_id = ?
      `,
      [
        req.user.id,
        req.params.id
      ]
    );

    res.json({
      success: true
    });
  })
);

/* ---------------- WISHLIST ---------------- */

app.get(
  "/api/wishlist",
  requireLogin,
  asyncRoute(async (req, res) => {
    const items = await all(
      `
        SELECT
          p.id,
          p.name,
          p.category,
          p.brand,
          p.description,
          p.price,
          p.stock,
          p.image,
          p.rating
        FROM wishlist w
        JOIN products p
          ON p.id = w.product_id
        WHERE w.user_id = ?
        ORDER BY w.id DESC
      `,
      [req.user.id]
    );

    res.json(items);
  })
);

app.post(
  "/api/wishlist",
  requireLogin,
  asyncRoute(async (req, res) => {
    const productId = Number(
      req.body.productId
    );

    const product = await get(
      "SELECT id FROM products WHERE id = ?",
      [productId]
    );

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    await run(
      `
        INSERT OR IGNORE INTO wishlist
        (user_id, product_id)
        VALUES (?, ?)
      `,
      [
        req.user.id,
        productId
      ]
    );

    res.status(201).json({
      success: true
    });
  })
);

app.delete(
  "/api/wishlist/:id",
  requireLogin,
  asyncRoute(async (req, res) => {
    await run(
      `
        DELETE FROM wishlist
        WHERE user_id = ? AND product_id = ?
      `,
      [
        req.user.id,
        req.params.id
      ]
    );

    res.json({
      success: true
    });
  })
);

/* ---------------- ORDERS ---------------- */

app.get(
  "/api/orders",
  requireLogin,
  asyncRoute(async (req, res) => {
    const orders = await all(
      `
        SELECT
          id,
          address,
          total,
          status,
          created_at
        FROM orders
        WHERE user_id = ?
        ORDER BY id DESC
      `,
      [req.user.id]
    );

    for (const order of orders) {
      order.items = await all(
        `
          SELECT
            product_id,
            product_name,
            price,
            quantity
          FROM order_items
          WHERE order_id = ?
        `,
        [order.id]
      );
    }

    res.json(orders);
  })
);

app.post(
  "/api/orders",
  requireLogin,
  asyncRoute(async (req, res) => {
    const address = String(
      req.body.address || ""
    ).trim();

    if (address.length < 10) {
      return res.status(400).json({
        error: "Please enter a complete shipping address."
      });
    }

    const cart = await all(
      `
        SELECT
          c.product_id,
          c.quantity,
          p.name,
          p.price,
          p.stock
        FROM cart_items c
        JOIN products p
          ON p.id = c.product_id
        WHERE c.user_id = ?
      `,
      [req.user.id]
    );

    if (!cart.length) {
      return res.status(400).json({
        error: "Your cart is empty."
      });
    }

    for (const item of cart) {
      if (item.quantity > item.stock) {
        return res.status(400).json({
          error:
            item.name +
            " does not have enough stock."
        });
      }
    }

    const total = cart.reduce(
      (sum, item) =>
        sum + item.price * item.quantity,
      0
    );

    await run("BEGIN TRANSACTION");

    try {
      const order = await run(
        `
          INSERT INTO orders
          (user_id, address, total, status)
          VALUES (?, ?, ?, 'Placed')
        `,
        [
          req.user.id,
          address,
          total
        ]
      );

      for (const item of cart) {
        await run(
          `
            INSERT INTO order_items
            (
              order_id,
              product_id,
              product_name,
              price,
              quantity
            )
            VALUES (?, ?, ?, ?, ?)
          `,
          [
            order.id,
            item.product_id,
            item.name,
            item.price,
            item.quantity
          ]
        );

        await run(
          `
            UPDATE products
            SET stock = stock - ?
            WHERE id = ?
          `,
          [
            item.quantity,
            item.product_id
          ]
        );
      }

      await run(
        `
          DELETE FROM cart_items
          WHERE user_id = ?
        `,
        [req.user.id]
      );

      await run("COMMIT");

      res.status(201).json({
        success: true,
        orderId: order.id,
        total
      });
    } catch (error) {
      await run("ROLLBACK");
      throw error;
    }
  })
);

/* ---------------- ADMIN PRODUCTS ---------------- */

app.post(
  "/api/admin/products",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const {
      name,
      category,
      brand = "",
      description = "",
      price,
      stock,
      image = "📦"
    } = req.body;

    if (
      !name ||
      !category ||
      price === undefined ||
      stock === undefined
    ) {
      return res.status(400).json({
        error: "Name, category, price and stock are required."
      });
    }

    const result = await run(
      `
        INSERT INTO products
        (
          name,
          category,
          brand,
          description,
          price,
          stock,
          image
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        name,
        category,
        brand,
        description,
        Number(price),
        Number(stock),
        image
      ]
    );

    res.status(201).json({
      success: true,
      productId: result.id
    });
  })
);

app.put(
  "/api/admin/products/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const {
      name,
      category,
      brand = "",
      description = "",
      price,
      stock,
      image = "📦"
    } = req.body;

    const result = await run(
      `
        UPDATE products
        SET
          name = ?,
          category = ?,
          brand = ?,
          description = ?,
          price = ?,
          stock = ?,
          image = ?
        WHERE id = ?
      `,
      [
        name,
        category,
        brand,
        description,
        Number(price),
        Number(stock),
        image,
        req.params.id
      ]
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    res.json({
      success: true
    });
  })
);

app.delete(
  "/api/admin/products/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const result = await run(
      `
        DELETE FROM products
        WHERE id = ?
      `,
      [req.params.id]
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    res.json({
      success: true
    });
  })
);

/* ---------------- ADMIN DASHBOARD ---------------- */

app.get(
  "/api/admin/dashboard",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const users = await get(
      `
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'customer'
      `
    );

    const products = await get(
      "SELECT COUNT(*) AS count FROM products"
    );

    const orders = await get(
      "SELECT COUNT(*) AS count FROM orders"
    );

    const revenue = await get(
      "SELECT COALESCE(SUM(total), 0) AS total FROM orders"
    );

    const lowStock = await all(
      `
        SELECT *
        FROM products
        WHERE stock <= 5
        ORDER BY stock ASC
      `
    );

    res.json({
      totalUsers: users.count,
      totalProducts: products.count,
      totalOrders: orders.count,
      totalRevenue: revenue.total,
      lowStock
    });
  })
);

app.get(
  "/api/admin/low-stock",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const limit = Number(
      req.query.limit || 5
    );

    const products = await all(
      `
        SELECT *
        FROM products
        WHERE stock <= ?
        ORDER BY stock ASC
      `,
      [limit]
    );

    res.json(products);
  })
);

app.get(
  "/api/admin/customers",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const customers = await all(
      `
        SELECT
          u.id,
          u.name,
          u.email,
          u.role,
          u.created_at,
          COUNT(o.id) AS orders_count,
          COALESCE(SUM(o.total), 0) AS total_spent
        FROM users u
        LEFT JOIN orders o
          ON o.user_id = u.id
        WHERE u.role = 'customer'
        GROUP BY u.id
        ORDER BY u.id DESC
      `
    );

    res.json(customers);
  })
);

app.get(
  "/api/admin/orders",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const orders = await all(
      `
        SELECT
          o.id,
          o.user_id,
          o.address,
          o.total,
          o.status,
          o.created_at,
          u.name AS customer_name,
          u.email AS customer_email
        FROM orders o
        JOIN users u
          ON u.id = o.user_id
        ORDER BY o.id DESC
      `
    );

    for (const order of orders) {
      order.items = await all(
        `
          SELECT
            product_name,
            price,
            quantity
          FROM order_items
          WHERE order_id = ?
        `,
        [order.id]
      );
    }

    res.json(orders);
  })
);

app.put(
  "/api/admin/orders/:id/status",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const allowedStatuses = [
      "Placed",
      "Packed",
      "Shipped",
      "Delivered",
      "Cancelled",
      "Returned"
    ];

    const status = String(
      req.body.status || ""
    );

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid order status."
      });
    }

    const result = await run(
      `
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `,
      [
        status,
        req.params.id
      ]
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    res.json({
      success: true
    });
  })
);

/* ---------------- CATEGORIES AND BRANDS ---------------- */

app.get(
  "/api/admin/categories",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const categories = await all(
      `
        SELECT
          category AS name,
          COUNT(*) AS product_count
        FROM products
        GROUP BY category
        ORDER BY category
      `
    );

    res.json(categories);
  })
);

app.get(
  "/api/admin/brands",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const brands = await all(
      `
        SELECT
          brand AS name,
          COUNT(*) AS product_count
        FROM products
        WHERE brand IS NOT NULL
          AND brand != ''
        GROUP BY brand
        ORDER BY brand
      `
    );

    res.json(brands);
  })
);

/* ---------------- COUPONS ---------------- */

app.get(
  "/api/admin/coupons",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const coupons = await all(
      `
        SELECT *
        FROM coupons
        ORDER BY id DESC
      `
    );

    res.json(coupons);
  })
);

app.post(
  "/api/admin/coupons",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const code = String(
      req.body.code || ""
    )
      .trim()
      .toUpperCase();

    const description = String(
      req.body.description || ""
    );

    const discountType =
      req.body.discountType === "flat"
        ? "flat"
        : "percentage";

    const discountValue = Number(
      req.body.discountValue || 0
    );

    const expiresAt = String(
      req.body.expiresAt || ""
    );

    if (!code || discountValue <= 0) {
      return res.status(400).json({
        error: "Coupon code and discount are required."
      });
    }

    const result = await run(
      `
        INSERT INTO coupons
        (
          code,
          description,
          discount_type,
          discount_value,
          active,
          expires_at
        )
        VALUES (?, ?, ?, ?, 1, ?)
      `,
      [
        code,
        description,
        discountType,
        discountValue,
        expiresAt
      ]
    );

    res.status(201).json({
      success: true,
      couponId: result.id
    });
  })
);

app.put(
  "/api/admin/coupons/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const active = req.body.active ? 1 : 0;

    const result = await run(
      `
        UPDATE coupons
        SET active = ?
        WHERE id = ?
      `,
      [
        active,
        req.params.id
      ]
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Coupon not found."
      });
    }

    res.json({
      success: true
    });
  })
);

app.delete(
  "/api/admin/coupons/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await run(
      `
        DELETE FROM coupons
        WHERE id = ?
      `,
      [req.params.id]
    );

    res.json({
      success: true
    });
  })
);

/* ---------------- REVIEWS ---------------- */

app.get(
  "/api/admin/reviews",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const reviews = await all(
      `
        SELECT
          r.id,
          r.rating,
          r.comment,
          r.status,
          r.created_at,
          p.name AS product_name,
          u.name AS customer_name,
          u.email AS customer_email
        FROM reviews r
        JOIN products p
          ON p.id = r.product_id
        JOIN users u
          ON u.id = r.user_id
        ORDER BY r.id DESC
      `
    );

    res.json(reviews);
  })
);

app.put(
  "/api/admin/reviews/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const allowedStatuses = [
      "pending",
      "approved",
      "rejected"
    ];

    const status = String(
      req.body.status || ""
    );

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid review status."
      });
    }

    const result = await run(
      `
        UPDATE reviews
        SET status = ?
        WHERE id = ?
      `,
      [
        status,
        req.params.id
      ]
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Review not found."
      });
    }

    res.json({
      success: true
    });
  })
);

/* ---------------- CUSTOMER REVIEWS ---------------- */

app.get(
  "/api/products/:id/reviews",
  asyncRoute(async (req, res) => {
    const reviews = await all(
      `
        SELECT
          r.id,
          r.rating,
          r.comment,
          r.created_at,
          u.name AS customer_name
        FROM reviews r
        JOIN users u
          ON u.id = r.user_id
        WHERE r.product_id = ?
          AND r.status = 'approved'
        ORDER BY r.id DESC
      `,
      [req.params.id]
    );

    res.json(reviews);
  })
);

app.post(
  "/api/products/:id/reviews",
  requireLogin,
  asyncRoute(async (req, res) => {
    const rating = Number(
      req.body.rating
    );

    const comment = String(
      req.body.comment || ""
    ).trim();

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return res.status(400).json({
        error: "Rating must be between 1 and 5."
      });
    }

    const product = await get(
      "SELECT id FROM products WHERE id = ?",
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    await run(
      `
        INSERT INTO reviews
        (
          product_id,
          user_id,
          rating,
          comment,
          status
        )
        VALUES (?, ?, ?, ?, 'pending')
      `,
      [
        req.params.id,
        req.user.id,
        rating,
        comment
      ]
    );

    res.status(201).json({
      success: true,
      message: "Review submitted for moderation."
    });
  })
);

/* ---------------- FALLBACK ---------------- */

app.get("*", (req, res) => {
  const indexPath = path.join(
    staticFolder,
    "index.html"
  );

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  res.status(404).send("ShopX frontend not found.");
});

/* ---------------- ERROR HANDLER ---------------- */

app.use((error, req, res, next) => {
  console.error(error);

  if (
    error.code === "SQLITE_CONSTRAINT" ||
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  ) {
    return res.status(409).json({
      error: "This record already exists."
    });
  }

  res.status(500).json({
    error: "Server error. Please try again."
  });
});

/* ---------------- START SERVER ---------------- */

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `ShopX server running on port ${PORT}`
      );

      console.log(
        "Admin: admin@shopx.test / Admin123!"
      );

      console.log(
        "Customer: customer@shopx.test / Customer123!"
      );
    });
  })
  .catch(error => {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  });

package.json mein ye dependencies honi chahiye:

{
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.7",
    "express": "^4.21.2",
    "sqlite3": "^5.1.7"
  }
}
