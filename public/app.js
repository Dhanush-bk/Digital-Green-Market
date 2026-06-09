const state = {
  role: "farmer",
  user: null,
  data: null,
  pendingLogin: null,
  query: "",
  filter: "all"
};

const authView = document.querySelector("#authView");
const dashboardView = document.querySelector("#dashboardView");
const loginForm = document.querySelector("#loginForm");
const otpForm = document.querySelector("#otpForm");
const otpHint = document.querySelector("#otpHint");
const loginTitle = document.querySelector("#loginTitle");
const roleTabs = document.querySelectorAll(".role-tab");
const backToLoginButton = document.querySelector("#backToLoginButton");
const logoutButton = document.querySelector("#logoutButton");
const roleLabel = document.querySelector("#roleLabel");
const welcomeTitle = document.querySelector("#welcomeTitle");
const statusStrip = document.querySelector("#statusStrip");
const farmerDashboard = document.querySelector("#farmerDashboard");
const consumerDashboard = document.querySelector("#consumerDashboard");
const cropForm = document.querySelector("#cropForm");
const farmerProducts = document.querySelector("#farmerProducts");
const consumerProducts = document.querySelector("#consumerProducts");
const productSearch = document.querySelector("#productSearch");
const filterButtons = document.querySelectorAll(".chip");
const toast = document.querySelector("#toast");

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function clean(value) {
  return String(value || "").trim();
}

function esc(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function loadState({ quiet = false } = {}) {
  try {
    state.data = await api("/api/state");
    if (state.user) renderDashboard();
  } catch (error) {
    if (!quiet) showToast(error.message);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 3400);
}

function isUserTyping() {
  const active = document.activeElement;
  return active?.matches?.("input, textarea, select");
}

function setRole(role) {
  state.role = role;
  loginTitle.textContent = role === "farmer" ? "Farmer sign in" : "Consumer sign in";
  roleTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.role === role));
}

function initials(text) {
  return clean(text)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "HL";
}

function cropImage(product) {
  const wrapper = document.createElement("div");
  wrapper.className = "product-image";
  if (product.image) {
    const img = document.createElement("img");
    img.src = product.image;
    img.alt = product.name;
    wrapper.append(img);
  } else {
    wrapper.textContent = initials(product.name);
  }
  return wrapper;
}

function productShell(product) {
  const article = document.createElement("article");
  article.className = "product-card";
  article.append(cropImage(product));
  const body = document.createElement("div");
  body.className = "product-body";
  article.append(body);
  return { article, body };
}

function timeLeft(product) {
  const remaining = new Date(product.endsAt).getTime() - Date.now();
  if (remaining <= 0) return "Closed";
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function statusClass(status) {
  if (status === "Active") return "";
  if (status === "Confirmed") return "confirmed";
  return "sold";
}

function renderMetrics() {
  const products = state.data.products;
  const ownProducts = state.role === "farmer"
    ? products.filter((product) => product.farmerId === state.user.id)
    : products;
  const active = ownProducts.filter((product) => product.status === "Active").length;
  const closed = ownProducts.filter((product) => ["Closed", "Confirmed", "Unsold"].includes(product.status)).length;
  const bids = state.role === "farmer"
    ? ownProducts.reduce((count, product) => count + product.bids.length, 0)
    : state.data.bids.filter((bid) => bid.buyerId === state.user.id).length;
  const confirmations = state.role === "farmer"
    ? state.data.confirmations.filter((item) => item.farmerId === state.user.id).length
    : state.data.confirmations.filter((item) => item.buyerId === state.user.id).length;

  const metrics = [
    [ownProducts.length, state.role === "farmer" ? "Your auctions" : "All auctions"],
    [active, "Live now"],
    [bids, state.role === "farmer" ? "Total bids" : "Your bids"],
    [closed + confirmations, "Closed / confirmed"]
  ];

  statusStrip.innerHTML = metrics
    .map(([value, label]) => `
      <div class="metric">
        <strong>${value}</strong>
        <span>${label}</span>
      </div>
    `)
    .join("");
}

function renderDashboard() {
  if (!state.data) return;
  authView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  roleLabel.textContent = state.role === "farmer" ? "Farmer dashboard" : "Consumer dashboard";
  welcomeTitle.textContent = `Welcome, ${state.user.name}`;
  farmerDashboard.classList.toggle("hidden", state.role !== "farmer");
  consumerDashboard.classList.toggle("hidden", state.role !== "consumer");
  renderMetrics();
  if (state.role === "farmer") renderFarmer();
  if (state.role === "consumer") renderConsumer();
}

function auctionSummary(product) {
  return `
    <div class="product-title-row">
      <div>
        <h3>${esc(product.name)}</h3>
        <p class="muted">${esc(product.category)} · ${esc(product.farmer?.location || "Location not set")}</p>
      </div>
      <span class="badge ${statusClass(product.status)}">${esc(product.status)}</span>
    </div>
    <p class="description">${esc(product.description || "No description added.")}</p>
    <div class="details-row">
      <div><strong>${esc(product.quantity)}</strong><span>Quantity</span></div>
      <div><strong>${money(product.startingBid)}</strong><span>First bid</span></div>
      <div><strong>${money(product.currentBid)}</strong><span>Current bid</span></div>
      <div><strong>${timeLeft(product)}</strong><span>Timer</span></div>
    </div>
  `;
}

function renderBidList(product, { showBuyerDetails }) {
  const list = document.createElement("div");
  list.className = "offer-list";
  if (!product.bids.length) {
    list.innerHTML = `<p class="muted">No consumer bids yet.</p>`;
    return list;
  }
  product.bids.slice(0, 5).forEach((bid, index) => {
    const row = document.createElement("div");
    row.className = `offer-row ${index === 0 ? "selected" : ""}`;
    row.innerHTML = `
      <div>
        <strong>${esc(bid.buyer?.name || "Consumer")}</strong>
        <p class="muted">${showBuyerDetails ? `${esc(bid.buyer?.contact || "")} · ${esc(bid.buyer?.location || "")}` : esc(bid.message || "Live bid")}</p>
      </div>
      <div>
        <strong>${money(bid.amount)}</strong>
        <p class="muted">${index === 0 ? "Highest" : "Bid"}</p>
      </div>
    `;
    list.append(row);
  });
  return list;
}

function renderFarmer() {
  const products = state.data.products.filter((product) => product.farmerId === state.user.id);
  farmerProducts.innerHTML = "";
  if (!products.length) {
    farmerProducts.innerHTML = `<p class="muted">Upload your first crop auction to start live bidding.</p>`;
    return;
  }

  products.forEach((product) => {
    const { article, body } = productShell(product);
    body.innerHTML = auctionSummary(product);
    body.append(renderBidList(product, { showBuyerDetails: product.status !== "Active" }));

    if (product.status === "Closed" && product.winningBid) {
      const buyer = product.winningBid.buyer;
      const panel = document.createElement("div");
      panel.className = "confirmation-panel";
      panel.innerHTML = `
        <div>
          <p class="eyebrow">Confirmation request</p>
          <strong>${esc(buyer?.name || "Winning consumer")}</strong>
          <p class="muted">Contact: ${esc(buyer?.contact || "Not available")}</p>
          <p class="muted">Location: ${esc(buyer?.location || "Not available")}</p>
          <p class="muted">Final amount: ${money(product.winningBid.amount)}</p>
        </div>
        <button class="primary-action" type="button">Confirm winner</button>
      `;
      panel.querySelector("button").addEventListener("click", () => confirmSale(product.id));
      body.append(panel);
    }

    if (product.status === "Confirmed" && product.confirmation) {
      const buyer = product.winningBid?.buyer;
      const panel = document.createElement("div");
      panel.className = "payment-summary";
      panel.innerHTML = `
        <div>
          <p class="eyebrow">Sale confirmed</p>
          <strong>${money(product.confirmation.amount)}</strong>
          <p class="muted">${esc(buyer?.name || "Consumer")} · ${esc(buyer?.contact || "Contact not available")}</p>
        </div>
        <span class="badge confirmed">Ready</span>
      `;
      body.append(panel);
    }
    farmerProducts.append(article);
  });
}

function renderConsumer() {
  const query = state.query.toLowerCase();
  const products = state.data.products.filter((product) => {
    const haystack = [product.name, product.category, product.description, product.farmer?.name, product.farmer?.location]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const matchesFilter = state.filter === "all"
      || (state.filter === "active" && product.status === "Active")
      || (state.filter === "closed" && product.status !== "Active");
    return matchesSearch && matchesFilter;
  });

  consumerProducts.innerHTML = "";
  if (!products.length) {
    consumerProducts.innerHTML = `<p class="muted">No crop auctions match your search.</p>`;
    return;
  }

  products.forEach((product) => {
    const { article, body } = productShell(product);
    body.innerHTML = `
      ${auctionSummary(product)}
      <div class="contact-row">
        <div>
          <strong>${esc(product.farmer?.name || "Farmer")}</strong>
          <p class="muted">${esc(product.farmer?.contact || "Contact not available")} · ${esc(product.farmer?.location || "")}</p>
        </div>
      </div>
    `;
    body.append(renderBidList(product, { showBuyerDetails: false }));

    if (product.status === "Active") {
      const bidForm = document.createElement("form");
      bidForm.className = "mini-form";
      bidForm.innerHTML = `
        <input name="amount" type="number" min="${Math.floor(Number(product.currentBid || 0)) + 1}" step="1" placeholder="Bid above ${money(product.currentBid)}" required />
        <textarea name="message" rows="2" placeholder="Optional note for farmer"></textarea>
        <button class="secondary-action" type="submit">Bid until auction closes</button>
      `;
      bidForm.addEventListener("submit", (event) => createBid(event, product.id));
      body.append(bidForm);
    } else if (product.confirmation?.buyerId === state.user.id) {
      const won = document.createElement("div");
      won.className = "payment-summary";
      won.innerHTML = `
        <div>
          <p class="eyebrow">Farmer confirmed your winning bid</p>
          <strong>${money(product.confirmation.amount)}</strong>
          <p class="muted">The farmer has your contact details for confirmation.</p>
        </div>
        <span class="badge confirmed">Confirmed</span>
      `;
      body.append(won);
    }
    consumerProducts.append(article);
  });
}

async function fileToDataUrl(file) {
  if (!file || !file.size) return "";
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function requestOtp(event) {
  event.preventDefault();
  const form = new FormData(loginForm);
  try {
    const payload = {
      role: state.role,
      name: form.get("name"),
      username: form.get("username"),
      contact: form.get("contact"),
      location: form.get("location")
    };
    const result = await api("/api/request-otp", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.pendingLogin = payload;
    otpHint.textContent = `Demo OTP for ${payload.username}: ${result.demoOtp}`;
    loginForm.classList.add("hidden");
    otpForm.classList.remove("hidden");
    otpForm.elements.otp.value = result.demoOtp;
    showToast("OTP generated. Verify to continue.");
  } catch (error) {
    showToast(error.message);
  }
}

async function verifyOtp(event) {
  event.preventDefault();
  if (!state.pendingLogin) return;
  const form = new FormData(otpForm);
  try {
    const payload = await api("/api/verify-otp", {
      method: "POST",
      body: JSON.stringify({
        role: state.role,
        username: state.pendingLogin.username,
        otp: form.get("otp")
      })
    });
    state.user = payload.user;
    state.role = payload.role;
    await loadState();
    showToast(`${state.role === "farmer" ? "Farmer" : "Consumer"} verified successfully`);
  } catch (error) {
    showToast(error.message);
  }
}

async function createProduct(event) {
  event.preventDefault();
  const form = new FormData(cropForm);
  try {
    await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        farmerId: state.user.id,
        name: form.get("name"),
        category: form.get("category"),
        quantity: form.get("quantity"),
        startingBid: form.get("startingBid"),
        durationMinutes: form.get("durationMinutes"),
        description: form.get("description"),
        image: await fileToDataUrl(form.get("image"))
      })
    });
    cropForm.reset();
    await loadState();
    showToast("Crop auction started");
  } catch (error) {
    showToast(error.message);
  }
}

async function createBid(event, productId) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/bids", {
      method: "POST",
      body: JSON.stringify({
        productId,
        buyerId: state.user.id,
        amount: form.get("amount"),
        message: form.get("message")
      })
    });
    await loadState();
    showToast("Live bid placed");
  } catch (error) {
    showToast(error.message);
  }
}

async function confirmSale(productId) {
  try {
    await api(`/api/products/${productId}/confirm`, { method: "POST", body: "{}" });
    await loadState();
    showToast("Winning consumer confirmed");
  } catch (error) {
    showToast(error.message);
  }
}

roleTabs.forEach((tab) => {
  tab.addEventListener("click", () => setRole(tab.dataset.role));
});

backToLoginButton.addEventListener("click", () => {
  otpForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderConsumer();
  });
});

productSearch.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderConsumer();
});

loginForm.addEventListener("submit", requestOtp);
otpForm.addEventListener("submit", verifyOtp);
cropForm.addEventListener("submit", createProduct);
logoutButton.addEventListener("click", () => {
  state.user = null;
  dashboardView.classList.add("hidden");
  authView.classList.remove("hidden");
  otpForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
});

setRole("farmer");
window.setInterval(() => {
  if (!state.user || !state.data) return;
  if (isUserTyping()) return;
  loadState({ quiet: true });
}, 1000);
