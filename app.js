(() => {
  function initApp() {
    const $ = id => document.getElementById(id);

    let currentUser = null;
    let products = [];
    let authMode = "login";

    const money = value =>
      "₹" +
      Number(value || 0).toLocaleString("en-IN", {
        maximumFractionDigits: 2
      });

    function esc(value) {
      return String(value ?? "").replace(
        /[&<>"']/g,
        character =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
          })[character]
      );
    }

    function setText(id, value) {
      const element = $(id);
      if (element) {
        element.textContent = value;
      }
    }

    function show(id) {
      const element = $(id);
      if (element) {
        element.classList.remove("hidden");
      }
    }

    function hide(id) {
      const element = $(id);
      if (element) {
        element.classList.add("hidden");
      }
    }

    function toggleHidden(id, condition) {
      const element = $(id);
      if (element) {
        element.classList.toggle("hidden", condition);
      }
    }

    function notice(message, isError = false) {
      const noticeElement = $("notice");

      if (noticeElement) {
        noticeElement.textContent = message;
        noticeElement.className = isError ? "error" : "";
      }

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }

    async function api(url, options = {}) {
      const requestOptions = {
        ...options,
        credentials: "same-origin",
        headers: {
          ...(options.headers || {})
        }
      };

      if (
        requestOptions.body &&
        !requestOptions.headers["Content-Type"]
      ) {
        requestOptions.headers["Content-Type"] =
          "application/json";
      }

      const response = await fetch(
        "/api" + url,
        requestOptions
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong."
        );
      }

      return data;
    }

    function applyUser(user) {
      currentUser = user || null;

      setText(
        "user-label",
        currentUser?.name || "Guest"
      );

      setText(
        "auth-button",
        currentUser ? "Logout" : "Login"
      );

      const adminNavigation = $("nav-admin");

      if (adminNavigation) {
        adminNavigation.style.display =
          currentUser?.role === "admin"
            ? "inline-block"
            : "none";
      }
    }

    async function refreshUser() {
      try {
        const data = await api("/auth/me");

        applyUser(data.user || null);

        await updateCartCount();

        return currentUser;
      } catch (error) {
        console.error(
          "Could not refresh user:",
          error
        );

        applyUser(null);

        const cartCount = $("cart-count");

        if (cartCount) {
          cartCount.textContent = "0";
        }

        return null;
      }
    }

    async function updateCartCount() {
      const cartCount = $("cart-count");

      if (!cartCount) {
        return;
      }

      if (!currentUser) {
        cartCount.textContent = "0";
        return;
      }

      try {
        const items = await api("/cart");

        cartCount.textContent = items.reduce(
          (sum, item) =>
            sum + Number(item.quantity || 0),
          0
        );
      } catch (error) {
        cartCount.textContent = "0";
      }
    }

    function view(name) {
      document
        .querySelectorAll(".view")
        .forEach(element => {
          element.classList.add("hidden");
        });

      const target = $(name + "-view");

      if (!target) {
        console.warn(
          "View not found:",
          name + "-view"
        );
        return;
      }

      target.classList.remove("hidden");

      if (name === "shop") {
        loadProducts();
      }

      if (name === "cart") {
        loadCart();
      }

      if (name === "wishlist") {
        loadWishlist();
      }

      if (name === "orders") {
        loadOrders();
      }

      if (name === "admin") {
        loadInventory();
      }
    }

    async function loadProducts() {
      try {
        const search = $("search")?.value || "";
        const category = $("category")?.value || "";
        const sort = $("sort")?.value || "popular";

        const query = new URLSearchParams({
          search,
          category,
          sort
        });

        products = await api(
          "/products?" + query.toString()
        );

        setText(
          "result-count",
          products.length + " products"
        );

        const allProducts = await api(
          "/products"
        );

        const categories = [
          ...new Set(
            allProducts
              .map(product => product.category)
              .filter(Boolean)
          )
        ];

        const categoryElement = $("category");

        if (categoryElement) {
          const oldCategory =
            categoryElement.value;

          categoryElement.innerHTML =
            '<option value="">All categories</option>' +
            categories
              .map(
                category =>
                  `<option value="${esc(
                    category
                  )}">${esc(
                    category
                  )}</option>`
              )
              .join("");

          categoryElement.value = oldCategory;
        }

        const productsElement = $("products");

        if (productsElement) {
          productsElement.innerHTML =
            products.map(card).join("") ||
            "<p>No products found. Try another search.</p>";
        }
      } catch (error) {
        notice(error.message, true);
      }
    }

    function card(product) {
      return `
        <article
          class="product"
          data-testid="product-card"
          data-product-id="${product.id}"
        >
          <div class="product-art">
            ${esc(product.image || "📦")}
          </div>

          <div class="product-body">
            <span class="tag">
              ${esc(product.category)}
            </span>

            <h3>
              ${esc(product.name)}
            </h3>

            <p class="desc">
              ${esc(product.description)}
            </p>

            <div class="price">
              ${money(product.price)}
            </div>

            <p class="desc">
              ${
                product.stock > 0
                  ? product.stock + " in stock"
                  : "Out of stock"
              }
            </p>

            <div class="actions">
              <button
                data-action="add"
                data-id="${product.id}"
                ${
                  product.stock < 1
                    ? "disabled"
                    : ""
                }
                data-testid="add-to-cart"
              >
                Add to cart
              </button>

              <button
                class="wish"
                data-action="wish"
                data-id="${product.id}"
                aria-label="Add to wishlist"
                data-testid="add-to-wishlist"
              >
                ♡
              </button>
            </div>
          </div>
        </article>
      `;
    }

    async function loadCart() {
      const cartItems = $("cart-items");
      const checkoutBox = $("checkout-box");

      if (!cartItems) {
        return;
      }

      if (!currentUser) {
        cartItems.innerHTML =
          "<p>Please log in to view your cart.</p>";

        if (checkoutBox) {
          checkoutBox.classList.add("hidden");
        }

        return;
      }

      try {
        const items = await api("/cart");

        if (!items.length) {
          cartItems.innerHTML =
            "<p>Your cart is empty.</p>";
        } else {
          cartItems.innerHTML = items
            .map(
              item => `
                <div
                  class="cart-row"
                  data-testid="cart-item"
                >
                  <div>
                    <b>${esc(item.name)}</b>
                    <p>
                      ${money(item.price)} each
                    </p>
                  </div>

                  <input
                    type="number"
                    min="1"
                    max="${item.stock}"
                    value="${item.quantity}"
                    data-qty="${item.id}"
                    aria-label="Quantity for ${esc(
                      item.name
                    )}"
                  >

                  <b>
                    ${money(
                      item.price *
                        item.quantity
                    )}
                  </b>

                  <button
                    data-action="remove-cart"
                    data-id="${item.id}"
                  >
                    Remove
                  </button>
                </div>
              `
            )
            .join("");
        }

        if (checkoutBox) {
          checkoutBox.classList.toggle(
            "hidden",
            !items.length
          );
        }

        const total = items.reduce(
          (sum, item) =>
            sum +
            item.price *
              item.quantity,
          0
        );

        setText(
          "cart-total",
          "Total: " + money(total)
        );
      } catch (error) {
        notice(error.message, true);
      }
    }

    async function loadWishlist() {
      const wishlistItems =
        $("wishlist-items");

      if (!wishlistItems) {
        return;
      }

      if (!currentUser) {
        wishlistItems.innerHTML =
          "<p>Please log in to view your wishlist.</p>";
        return;
      }

      try {
        const items = await api(
          "/wishlist"
        );

        wishlistItems.innerHTML =
          items.map(card).join("") ||
          "<p>Your wishlist is empty.</p>";
      } catch (error) {
        notice(error.message, true);
      }
    }

    async function loadOrders() {
      const ordersList =
        $("orders-list");

      if (!ordersList) {
        return;
      }

      if (!currentUser) {
        ordersList.innerHTML =
          "<p>Please log in to view orders.</p>";
        return;
      }

      try {
        const orders = await api(
          "/orders"
        );

        ordersList.innerHTML =
          orders
            .map(
              order => `
                <div class="panel">
                  <b>
                    Order #${order.id}
                  </b>
                  · ${esc(order.status)}

                  <p>
                    ${new Date(
                      order.created_at + "Z"
                    ).toLocaleString()}
                    · ${money(order.total)}
                  </p>

                  <small>
                    ${esc(order.address)}
                  </small>

                  <p>
                    ${order.items
                      .map(
                        item =>
                          esc(
                            item.product_name
                          ) +
                          " × " +
                          item.quantity
                      )
                      .join(", ")}
                  </p>
                </div>
              `
            )
            .join("") ||
          "<p>No orders yet.</p>";
      } catch (error) {
        notice(error.message, true);
      }
    }

    async function loadInventory() {
      const inventory = $("inventory");

      if (!inventory) {
        return;
      }

      if (
        !currentUser ||
        currentUser.role !== "admin"
      ) {
        notice(
          "Please log in as admin to access inventory.",
          true
        );

        view("shop");
        return;
      }

      try {
        const items = await api(
          "/products"
        );

        inventory.innerHTML = items
          .map(
            product => `
              <tr>
                <td>
                  ${esc(product.name)}
                </td>

                <td>
                  ${esc(product.category)}
                </td>

                <td>
                  ${money(product.price)}
                </td>

                <td>
                  ${product.stock}
                </td>

                <td>
                  <button
                    data-action="edit"
                    data-id="${product.id}"
                  >
                    Edit
                  </button>

                  <button
                    data-action="delete"
                    data-id="${product.id}"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            `
          )
          .join("");
      } catch (error) {
        notice(error.message, true);
      }
    }

    function openAuth(mode = "login") {
      authMode = mode;

      setText(
        "auth-title",
        mode === "login"
          ? "Login"
          : "Create account"
      );

      const nameWrap =
        $("register-name-wrap");

      if (nameWrap) {
        nameWrap.classList.toggle(
          "hidden",
          mode === "login"
        );
      }

      const passwordInput =
        $("auth-password");

      if (passwordInput) {
        passwordInput.setAttribute(
          "autocomplete",
          mode === "login"
            ? "current-password"
            : "new-password"
        );
      }

      const authForm = $("auth-form");

      if (authForm) {
        const submitButton =
          authForm.querySelector(
            '[type="submit"]'
          );

        if (submitButton) {
          submitButton.textContent =
            mode === "login"
              ? "Login"
              : "Create account";
        }
      }

      const authSwitch =
        $("auth-switch");

      if (authSwitch) {
        authSwitch.innerHTML =
          mode === "login"
            ? 'New here? <a href="#" id="switch-auth">Create an account</a>'
            : 'Already registered? <a href="#" id="switch-auth">Login</a>';
      }

      show("modal");
    }

    const authButton = $("auth-button");

    if (authButton) {
      authButton.onclick = async () => {
        try {
          if (currentUser) {
            await api("/auth/logout", {
              method: "POST"
            });

            applyUser(null);
            await updateCartCount();

            notice(
              "Logged out successfully."
            );
          } else {
            openAuth("login");
          }
        } catch (error) {
          notice(error.message, true);
        }
      };
    }

    const closeModal = $("close-modal");

    if (closeModal) {
      closeModal.onclick = () => {
        hide("modal");
      };
    }

    const authSwitch = $("auth-switch");

    if (authSwitch) {
      authSwitch.onclick = event => {
        if (
          event.target.id ===
          "switch-auth"
        ) {
          event.preventDefault();

          openAuth(
            authMode === "login"
              ? "register"
              : "login"
          );
        }
      };
    }

    const authForm = $("auth-form");

    if (authForm) {
      authForm.onsubmit = async event => {
        event.preventDefault();

        try {
          const email =
            $("auth-email")?.value.trim() ||
            "";

          const password =
            $("auth-password")?.value ||
            "";

          let data;

          if (authMode === "login") {
            data = await api(
              "/auth/login",
              {
                method: "POST",
                body: JSON.stringify({
                  email,
                  password
                })
              }
            );
          } else {
            const name =
              $("auth-name")?.value.trim() ||
              "";

            data = await api(
              "/auth/register",
              {
                method: "POST",
                body: JSON.stringify({
                  name,
                  email,
                  password
                })
              }
            );
          }

          const returnedUser =
            data.user || null;

          applyUser(returnedUser);

          hide("modal");
          authForm.reset();

          const refreshedUser =
            await refreshUser();

          const loggedUser =
            refreshedUser ||
            returnedUser ||
            null;

          if (loggedUser?.name) {
            notice(
              "Welcome, " +
                loggedUser.name +
                "!"
            );
          } else {
            notice(
              authMode === "login"
                ? "Logged in successfully."
                : "Account created successfully."
            );
          }
        } catch (error) {
          notice(error.message, true);
        }
      };
    }

    document.addEventListener(
      "click",
      async event => {
        const target = event.target;

        if (!target || !target.closest) {
          return;
        }

        const navigation =
          target.closest("[data-view]");

        if (navigation) {
          event.preventDefault();

          view(
            navigation.dataset.view
          );

          return;
        }

        const button =
          target.closest("[data-action]");

        if (!button) {
          return;
        }

        const id = Number(
          button.dataset.id
        );

        try {
          if (
            button.dataset.action ===
            "add"
          ) {
            await api(
              "/cart",
              {
                method: "POST",
                body: JSON.stringify({
                  productId: id
                })
              }
            );

            notice(
              "Product added to cart."
            );

            await updateCartCount();
          }

          if (
            button.dataset.action ===
            "wish"
          ) {
            await api(
              "/wishlist",
              {
                method: "POST",
                body: JSON.stringify({
                  productId: id
                })
              }
            );

            notice(
              "Added to wishlist."
            );
          }

          if (
            button.dataset.action ===
            "remove-cart"
          ) {
            await api(
              "/cart/" + id,
              {
                method: "DELETE"
              }
            );

            await loadCart();
            await updateCartCount();
          }

          if (
            button.dataset.action ===
            "edit"
          ) {
            const product =
              await api(
                "/products/" + id
              );

            if ($("product-id")) {
              $("product-id").value =
                product.id;
            }

            if ($("p-name")) {
              $("p-name").value =
                product.name;
            }

            if ($("p-category")) {
              $("p-category").value =
                product.category;
            }

            if ($("p-description")) {
              $("p-description").value =
                product.description;
            }

            if ($("p-price")) {
              $("p-price").value =
                product.price;
            }

            if ($("p-stock")) {
              $("p-stock").value =
                product.stock;
            }

            if ($("p-image")) {
              $("p-image").value =
                product.image;
            }

            setText(
              "form-title",
              "Edit product"
            );

            window.scrollTo({
              top: 300,
              behavior: "smooth"
            });
          }

          if (
            button.dataset.action ===
            "delete"
          ) {
            if (
              confirm(
                "Delete this product?"
              )
            ) {
              await api(
                "/admin/products/" + id,
                {
                  method: "DELETE"
                }
              );

              notice(
                "Product deleted."
              );

              await loadInventory();
            }
          }
        } catch (error) {
          notice(error.message, true);
        }
      }
    );

    [
      "search",
      "category",
      "sort"
    ].forEach(id => {
      const element = $(id);

      if (!element) {
        return;
      }

      element.addEventListener(
        id === "search"
          ? "input"
          : "change",
        loadProducts
      );
    });

    const cartItems = $("cart-items");

    if (cartItems) {
      cartItems.addEventListener(
        "change",
        async event => {
          const productId =
            event.target.dataset.qty;

          if (!productId) {
            return;
          }

          try {
            await api(
              "/cart/" + productId,
              {
                method: "PUT",
                body: JSON.stringify({
                  quantity: Number(
                    event.target.value
                  )
                })
              }
            );

            await loadCart();
            await updateCartCount();
          } catch (error) {
            notice(error.message, true);
            await loadCart();
          }
        }
      );
    }

    const checkout = $("checkout");

    if (checkout) {
      checkout.onclick = async () => {
        try {
          const data = await api(
            "/orders",
            {
              method: "POST",
              body: JSON.stringify({
                address:
                  $("address")?.value || ""
              })
            }
          );

          notice(
            "Order #" +
              data.orderId +
              " placed successfully!"
          );

          if ($("address")) {
            $("address").value = "";
          }

          await updateCartCount();
          await loadCart();
        } catch (error) {
          notice(error.message, true);
        }
      };
    }

    const productForm =
      $("product-form");

    if (productForm) {
      productForm.onsubmit = async event => {
        event.preventDefault();

        const id =
          $("product-id")?.value || "";

        const product = {
          name:
            $("p-name")?.value || "",

          category:
            $("p-category")?.value || "",

          description:
            $("p-description")?.value || "",

          price: Number(
            $("p-price")?.value || 0
          ),

          stock: Number(
            $("p-stock")?.value || 0
          ),

          image:
            $("p-image")?.value || "📦"
        };

        try {
          await api(
            id
              ? "/admin/products/" + id
              : "/admin/products",
            {
              method: id
                ? "PUT"
                : "POST",
              body: JSON.stringify(product)
            }
          );

          notice(
            id
              ? "Product updated."
              : "Product created."
          );

          productForm.reset();

          if ($("product-id")) {
            $("product-id").value = "";
          }

          setText(
            "form-title",
            "Add product"
          );

          await loadInventory();
        } catch (error) {
          notice(error.message, true);
        }
      };
    }

    const cancelEdit =
      $("cancel-edit");

    if (cancelEdit) {
      cancelEdit.onclick = () => {
        productForm?.reset();

        if ($("product-id")) {
          $("product-id").value = "";
        }

        setText(
          "form-title",
          "Add product"
        );
      };
    }

    const brand =
      document.querySelector(".brand");

    if (brand) {
      brand.onclick = event => {
        event.preventDefault();
        view("shop");
      };
    }

    document
      .querySelectorAll("[data-view]")
      .forEach(button => {
        button.addEventListener(
          "keydown",
          event => {
            if (
              event.key === "Enter" ||
              event.key === " "
            ) {
              event.preventDefault();
              view(button.dataset.view);
            }
          }
        );
      });

    (async () => {
      await refreshUser();
      view("shop");
    })();
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initApp
    );
  } else {
    initApp();
  }
})();
