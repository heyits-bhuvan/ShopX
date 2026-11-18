const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || path.join(__dirname, "shopx.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
 description TEXT DEFAULT '', price REAL NOT NULL CHECK(price >= 0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
 image TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cart_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0), UNIQUE(user_id, product_id),
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS wishlist (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
 UNIQUE(user_id, product_id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, total REAL NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending', address TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
 product_name TEXT NOT NULL, price REAL NOT NULL, quantity INTEGER NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id)
);
`);
const count = db.prepare("SELECT COUNT(*) n FROM products").get().n;
if (!count) {
 const insert = db.prepare("INSERT INTO products(name,category,description,price,stock,image) VALUES(?,?,?,?,?,?)");
 [
 ["Studio Wireless Headphones","Audio","Comfortable wireless headphones with rich sound.",3499,18,"🎧"],
 ["Everyday Digital Camera","Electronics","Compact camera for everyday photography.",12999,7,"📷"],
 ["Minimalist Wristwatch","Accessories","A clean everyday watch with a durable strap.",2299,12,"⌚"],
 ["Ceramic Morning Mug","Home","A ceramic mug for your morning coffee.",649,25,"☕"],
 ["Classic Running Shoes","Fashion","Lightweight shoes for daily training.",2799,14,"👟"],
 ["Portable Bluetooth Speaker","Audio","Portable speaker with clear audio.",1899,20,"🔊"],
 ["Smart Desk Lamp","Home","Adjustable desk lamp with warm lighting.",1499,9,"💡"],
 ["Mechanical Keyboard","Electronics","Tactile keyboard for work and gaming.",4299,11,"⌨️"],
 ["Canvas Backpack","Fashion","Everyday backpack with roomy compartments.",1599,16,"🎒"]
 ].forEach(p=>insert.run(...p));
}
function seedUser(name,email,password,role){
 if(!db.prepare("SELECT id FROM users WHERE email=?").get(email))
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)").run(name,email,bcrypt.hashSync(password,10),role);
}
seedUser("ShopX Admin","admin@shopx.test","Admin123!","admin");
seedUser("Demo Customer","customer@shopx.test","Customer123!","customer");

app.use(express.json());
app.use(session({
 secret:process.env.SESSION_SECRET || "change-this-shopx-session-secret",
 resave:false,saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*8}
}));
app.use(express.static(__dirname));
const safeUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role});
const requireAuth=(req,res,next)=>req.session.user?next():res.status(401).json({error:"Please log in to continue."});
const requireAdmin=(req,res,next)=>req.session.user?.role==="admin"?next():res.status(403).json({error:"Admin access required."});

app.get("/api/health",(req,res)=>res.json({status:"ok",app:"ShopX",database:"connected"}));
app.get("/api/auth/me",(req,res)=>res.json({user:req.session.user||null}));
app.post("/api/auth/register",(req,res)=>{
 const {name,email,password}=req.body||{};
 if(!name?.trim()||!email?.trim()||!password) return res.status(400).json({error:"Name, email and password are required."});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email address."});
 if(password.length<8) return res.status(400).json({error:"Password must be at least 8 characters."});
 try{
  const info=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'customer')").run(name.trim(),email.toLowerCase(),bcrypt.hashSync(password,10));
  const user=safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid));req.session.user=user;res.status(201).json({user});
 }catch(e){res.status(409).json({error:"An account with this email already exists."});}
});
app.post("/api/auth/login",(req,res)=>{
 const {email,password}=req.body||{};
 if(!email||!password)return res.status(400).json({error:"Email and password are required."});
 const u=db.prepare("SELECT * FROM users WHERE email=?").get(email.toLowerCase());
 if(!u||!bcrypt.compareSync(password,u.password_hash))return res.status(401).json({error:"Invalid email or password."});
 req.session.user=safeUser(u);res.json({user:req.session.user});
});
app.post("/api/auth/logout",(req,res)=>req.session.destroy(()=>res.json({message:"Logged out successfully."})));

app.get("/api/products",(req,res)=>{
 const {search="",category="",sort="popular",min="",max=""}=req.query;
 let sql="SELECT * FROM products WHERE active=1",args=[];
 if(search){sql+=" AND (name LIKE ? OR description LIKE ?)";args.push(`%${search}%`,`%${search}%`);}
 if(category){sql+=" AND category=?";args.push(category);}
 if(min!==""){sql+=" AND price>=?";args.push(Number(min));}
 if(max!==""){sql+=" AND price<=?";args.push(Number(max));}
 if(sort==="price-low")sql+=" ORDER BY price ASC";
 else if(sort==="price-high")sql+=" ORDER BY price DESC";
 else sql+=" ORDER BY id DESC";
 res.json(db.prepare(sql).all(...args));
});
app.get("/api/products/:id",(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(req.params.id);
 p?res.json(p):res.status(404).json({error:"Product not found."});
});
app.post("/api/admin/products",requireAuth,requireAdmin,(req,res)=>{
 const {name,category,description="",price,stock,image="📦"}=req.body||{};
 if(!name?.trim()||!category?.trim()||!Number.isFinite(Number(price))||Number(price)<0||!Number.isInteger(Number(stock))||Number(stock)<0)
 return res.status(400).json({error:"Enter a product name, category, valid price and non-negative whole-number stock."});
 const info=db.prepare("INSERT INTO products(name,category,description,price,stock,image) VALUES(?,?,?,?,?,?)").run(name.trim(),category.trim(),description,Number(price),Number(stock),image);
 res.status(201).json(db.prepare("SELECT * FROM products WHERE id=?").get(info.lastInsertRowid));
});
app.put("/api/admin/products/:id",requireAuth,requireAdmin,(req,res)=>{
 const {name,category,description="",price,stock,image="📦"}=req.body||{};
 if(!name?.trim()||!category?.trim()||!Number.isFinite(Number(price))||Number(price)<0||!Number.isInteger(Number(stock))||Number(stock)<0)
 return res.status(400).json({error:"Please enter valid product details."});
 const info=db.prepare("UPDATE products SET name=?,category=?,description=?,price=?,stock=?,image=? WHERE id=?").run(name.trim(),category.trim(),description,Number(price),Number(stock),image,req.params.id);
 info.changes?res.json(db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id)):res.status(404).json({error:"Product not found."});
});
app.delete("/api/admin/products/:id",requireAuth,requireAdmin,(req,res)=>{
 const info=db.prepare("UPDATE products SET active=0 WHERE id=?").run(req.params.id);
 info.changes?res.json({message:"Product deleted successfully."}):res.status(404).json({error:"Product not found."});
});
app.get("/api/cart",requireAuth,(req,res)=>res.json(db.prepare(`SELECT c.quantity,p.* FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? AND p.active=1`).all(req.session.user.id)));
app.post("/api/cart",requireAuth,(req,res)=>{
 const {productId,quantity=1}=req.body||{},p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(productId);
 if(!p)return res.status(404).json({error:"Product not found."});
 if(!Number.isInteger(Number(quantity))||Number(quantity)<1)return res.status(400).json({error:"Quantity must be at least 1."});
 const existing=db.prepare("SELECT quantity FROM cart_items WHERE user_id=? AND product_id=?").get(req.session.user.id,productId);
 const next=(existing?.quantity||0)+Number(quantity);
 if(next>p.stock)return res.status(400).json({error:"Requested quantity exceeds available stock."});
 db.prepare("INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity").run(req.session.user.id,productId,next);
 res.json({message:"Product added to cart."});
});
app.put("/api/cart/:productId",(req,res)=>{
 if(!req.session.user)return res.status(401).json({error:"Please log in to continue."});
 const q=Number(req.body.quantity),p=db.prepare("SELECT stock FROM products WHERE id=?").get(req.params.productId);
 if(!Number.isInteger(q)||q<1)return res.status(400).json({error:"Quantity must be at least 1."});
 if(!p||q>p.stock)return res.status(400).json({error:"Requested quantity exceeds available stock."});
 db.prepare("UPDATE cart_items SET quantity=? WHERE user_id=? AND product_id=?").run(q,req.session.user.id,req.params.productId);res.json({message:"Cart updated."});
});
app.delete("/api/cart/:productId",requireAuth,(req,res)=>{db.prepare("DELETE FROM cart_items WHERE user_id=? AND product_id=?").run(req.session.user.id,req.params.productId);res.json({message:"Item removed from cart."});});
app.get("/api/wishlist",requireAuth,(req,res)=>res.json(db.prepare("SELECT p.* FROM wishlist w JOIN products p ON p.id=w.product_id WHERE w.user_id=? AND p.active=1").all(req.session.user.id)));
app.post("/api/wishlist",requireAuth,(req,res)=>{
 const p=db.prepare("SELECT id FROM products WHERE id=? AND active=1").get(req.body.productId);
 if(!p)return res.status(404).json({error:"Product not found."});
 db.prepare("INSERT OR IGNORE INTO wishlist(user_id,product_id) VALUES(?,?)").run(req.session.user.id,p.id);res.json({message:"Added to wishlist."});
});
app.delete("/api/wishlist/:productId",requireAuth,(req,res)=>{db.prepare("DELETE FROM wishlist WHERE user_id=? AND product_id=?").run(req.session.user.id,req.params.productId);res.json({message:"Removed from wishlist."});});
app.post("/api/orders",requireAuth,(req,res)=>{
 const {address}=req.body||{};if(!address?.trim())return res.status(400).json({error:"Shipping address is required."});
 const items=db.prepare("SELECT c.quantity,p.* FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=?").all(req.session.user.id);
 if(!items.length)return res.status(400).json({error:"Your cart is empty."});
 for(const i of items)if(i.quantity>i.stock)return res.status(400).json({error:`Insufficient stock for ${i.name}.`});
 const total=items.reduce((s,i)=>s+i.price*i.quantity,0);
 const create=db.transaction(()=>{
  const orderId=db.prepare("INSERT INTO orders(user_id,total,address) VALUES(?,?,?)").run(req.session.user.id,total,address.trim()).lastInsertRowid;
  const add=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,price,quantity) VALUES(?,?,?,?,?)");
  const stock=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
  items.forEach(i=>{add.run(orderId,i.id,i.name,i.price,i.quantity);stock.run(i.quantity,i.id);});
  db.prepare("DELETE FROM cart_items WHERE user_id=?").run(req.session.user.id);
  return orderId;
 });
 const id=create();res.status(201).json({message:"Order placed successfully.",orderId:id,total});
});
app.get("/api/orders",requireAuth,(req,res)=>{
 const orders=db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC").all(req.session.user.id);
 res.json(orders.map(o=>({...o,items:db.prepare("SELECT * FROM order_items WHERE order_id=?").all(o.id)})));
});
app.get("/api/admin/orders",requireAuth,requireAdmin,(req,res)=>res.json(db.prepare("SELECT o.*,u.name customer_name,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC").all()));
app.patch("/api/admin/orders/:id",requireAuth,requireAdmin,(req,res)=>{
 const allowed=["Pending","Confirmed","Shipped","Delivered","Cancelled"],status=req.body.status;
 if(!allowed.includes(status))return res.status(400).json({error:"Invalid order status."});
 const info=db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,req.params.id);
 info.changes?res.json({message:"Order status updated."}):res.status(404).json({error:"Order not found."});
});
app.post("/api/test/reset",requireAuth,requireAdmin,(req,res)=>{
 db.prepare("DELETE FROM order_items").run();db.prepare("DELETE FROM orders").run();db.prepare("DELETE FROM cart_items").run();db.prepare("DELETE FROM wishlist").run();
 db.prepare("UPDATE products SET stock=18 WHERE name='Studio Wireless Headphones'").run();
 res.json({message:"Test data reset completed."});
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>console.log(`ShopX running on http://localhost:${PORT}`));
