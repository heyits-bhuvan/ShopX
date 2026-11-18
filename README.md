# ShopX — Full-stack E-commerce Practice App

A runnable Node.js + Express + SQLite application designed for manual testing and Playwright automation practice.

## Run locally
1. Install Node.js 20 or newer.
2. Extract this ZIP and open a terminal in the project folder.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`

## Demo accounts
- Customer: `customer@shopx.test` / `Customer123!`
- Admin: `admin@shopx.test` / `Admin123!`

Change demo passwords and `SESSION_SECRET` before public deployment.

## Included functionality
- Customer registration, login and logout (server-side sessions)
- Product listing, search, category filtering and sorting
- Cart, wishlist and checkout with simulated payment
- Order history and stock decrement
- Admin product create/update/delete
- Admin order listing and status update API
- SQLite persistence
- API health endpoint and admin-only test reset endpoint

## API quick reference
- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/products`, `GET /api/products/:id`
- `GET /api/cart`, `POST /api/cart`, `PUT /api/cart/:productId`, `DELETE /api/cart/:productId`
- `GET /api/wishlist`, `POST /api/wishlist`, `DELETE /api/wishlist/:productId`
- `POST /api/orders`, `GET /api/orders`
- Admin: `POST/PUT/DELETE /api/admin/products`, `GET /api/admin/orders`, `PATCH /api/admin/orders/:id`
- `POST /api/test/reset` (admin only)

## Playwright locator strategy
Use accessible labels, button names, and stable `data-testid` attributes such as:
`product-search`, `category-filter`, `add-to-cart`, `login-email`, `login-password`,
`login-submit`, `product-name`, `product-price`, `product-stock`, `save-product`,
`shipping-address`, `place-order`.

## Deploy publicly
This project is ready to run on a Node hosting service such as Render or Railway. For a public deployment:
- Set `NODE_ENV=production`
- Set a strong `SESSION_SECRET`
- Set `DB_PATH` to a persistent disk path (for example `/var/data/shopx.sqlite`)
- Attach a persistent disk to the service so SQLite data survives redeploys.
- Never publish real customer data or use real payment details. Payments here are simulated only.
