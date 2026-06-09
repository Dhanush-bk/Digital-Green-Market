from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from datetime import datetime, timedelta, timezone
import json
import mimetypes
import os
import random
import string
import time


ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
DB_FILE = DATA_DIR / "db.json"
SEED_FILE = DATA_DIR / "seed.json"
PUBLIC_DIR = ROOT / "public"
PORT = int(os.environ.get("PORT", "3000"))
MAX_BODY_SIZE = 8_000_000


def ensure_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DB_FILE.exists():
        DB_FILE.write_text(SEED_FILE.read_text(encoding="utf-8"), encoding="utf-8")


def read_db():
    ensure_db()
    db = json.loads(DB_FILE.read_text(encoding="utf-8"))
    changed = normalize_db(db)
    changed = close_expired_auctions(db) or changed
    if not any(product.get("status") == "Active" for product in db["products"]):
        ensure_demo_auctions(db)
        changed = True
    if changed:
        write_db(db)
    return db


def write_db(db):
    DB_FILE.write_text(json.dumps(db, indent=2), encoding="utf-8")


def normalize_db(db):
    changed = False
    for key in ["farmers", "buyers", "products", "bids", "confirmations", "pendingOtps"]:
        if key not in db:
            db[key] = []
            changed = True

    for role_key in ["farmers", "buyers"]:
        for user in db[role_key]:
            if "verified" not in user:
                user["verified"] = True
                changed = True

    for product in db["products"]:
        if "startingBid" not in product:
            product["startingBid"] = to_number(product.get("price"))
            changed = True
        if "endsAt" not in product:
            product["endsAt"] = (parse_time(product.get("createdAt")) + timedelta(hours=2)).isoformat().replace("+00:00", "Z")
            changed = True
        if product.get("status") == "Available":
            product["status"] = "Active"
            changed = True
        if product.get("status") == "Sold":
            product["status"] = "Confirmed"
            changed = True
        if len(str(product.get("image", ""))) > 350_000:
            product["image"] = ""
            changed = True
    if not any(product.get("status") == "Active" for product in db["products"]):
        ensure_demo_auctions(db)
        changed = True
    return changed


def ensure_demo_auctions(db):
    farmer = db["farmers"][0] if db["farmers"] else {
        "id": "farmer_demo",
        "name": "Demo Farmer",
        "username": "demo-farmer",
        "contact": "+91 90000 00001",
        "location": "Mandya, Karnataka",
        "verified": True,
    }
    buyer = db["buyers"][0] if db["buyers"] else {
        "id": "consumer_demo",
        "name": "Demo Consumer",
        "username": "demo-consumer",
        "contact": "+91 90000 00002",
        "location": "Bengaluru, Karnataka",
        "verified": True,
    }
    if not db["farmers"]:
        db["farmers"].append(farmer)
    if not db["buyers"]:
        db["buyers"].append(buyer)
    product = {
        "id": make_id("crop"),
        "farmerId": farmer["id"],
        "name": "Live Tomato Lot",
        "category": "Vegetables",
        "quantity": "250 kg",
        "startingBid": 8000,
        "description": "Demo live auction inserted because no active auctions were available.",
        "image": "",
        "status": "Active",
        "createdAt": now_iso(),
        "endsAt": (now() + timedelta(hours=24)).isoformat().replace("+00:00", "Z"),
    }
    db["products"].insert(0, product)
    db["bids"].insert(0, {
        "id": make_id("bid"),
        "productId": product["id"],
        "buyerId": buyer["id"],
        "amount": 8500,
        "message": "Demo opening consumer bid.",
        "createdAt": now_iso(),
    })


def clean_text(value):
    return str(value or "").strip()


def make_id(prefix):
    stamp = base36(int(time.time() * 1000))
    suffix = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    return f"{prefix}_{stamp}_{suffix}"


def base36(number):
    alphabet = string.digits + string.ascii_lowercase
    if number == 0:
        return "0"
    result = ""
    while number:
        number, remainder = divmod(number, 36)
        result = alphabet[remainder] + result
    return result


def now():
    return datetime.now(timezone.utc)


def now_iso():
    return now().isoformat().replace("+00:00", "Z")


def parse_time(value):
    try:
        return datetime.fromisoformat(clean_text(value).replace("Z", "+00:00"))
    except ValueError:
        return now()


def find_by_id(items, item_id):
    return next((item for item in items if item.get("id") == item_id), None)


def to_number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def user_key(role):
    return "buyers" if role in ["buyer", "consumer"] else "farmers"


def role_name(role):
    return "consumer" if role in ["buyer", "consumer"] else "farmer"


def product_bids(product_id, db):
    bids = [bid for bid in db["bids"] if bid.get("productId") == product_id]
    bids.sort(key=lambda bid: (to_number(bid.get("amount")), bid.get("createdAt", "")), reverse=True)
    return bids


def winning_bid(product, db):
    bids = product_bids(product["id"], db)
    return bids[0] if bids else None


def close_expired_auctions(db):
    changed = False
    for product in db.get("products", []):
        if product.get("status") != "Active":
            continue
        if parse_time(product.get("endsAt")) <= now():
            product["status"] = "Closed" if winning_bid(product, db) else "Unsold"
            product["closedAt"] = now_iso()
            changed = True
    return changed


def enrich_product(product, db):
    farmer = find_by_id(db["farmers"], product.get("farmerId"))
    bids = []
    for bid in product_bids(product["id"], db):
        buyer = find_by_id(db["buyers"], bid.get("buyerId"))
        bids.append({**bid, "buyer": buyer})
    top_bid = bids[0] if bids else None
    current_bid = to_number(top_bid.get("amount")) if top_bid else to_number(product.get("startingBid"))
    confirmation = next((item for item in db["confirmations"] if item.get("productId") == product.get("id")), None)
    return {
        **product,
        "farmer": farmer,
        "bids": bids,
        "currentBid": current_bid,
        "winningBid": top_bid,
        "confirmation": confirmation,
    }


class HarvestHandler(BaseHTTPRequestHandler):
    server_version = "HarvestLinkAuctionPython/2.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            db = read_db()
            self.send_json(200, {
                "serverTime": now_iso(),
                "farmers": db["farmers"],
                "buyers": db["buyers"],
                "products": [enrich_product(product, db) for product in db["products"]],
                "bids": db["bids"],
                "confirmations": db["confirmations"],
            })
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/request-otp":
                self.request_otp()
            elif parsed.path == "/api/verify-otp":
                self.verify_otp()
            elif parsed.path == "/api/products":
                self.create_product()
            elif parsed.path == "/api/bids":
                self.create_bid()
            elif parsed.path.startswith("/api/products/") and parsed.path.endswith("/confirm"):
                self.confirm_sale(parsed.path)
            else:
                self.send_json(404, {"error": "Not found"})
        except Exception as error:
            self.send_json(500, {"error": str(error) or "Something went wrong."})

    def request_otp(self):
        db = read_db()
        body = self.read_body()
        role = role_name(body.get("role"))
        username = clean_text(body.get("username")).lower()
        contact = clean_text(body.get("contact"))
        if not username or not contact:
            self.send_json(400, {"error": "Username and contact are required."})
            return

        otp = "".join(random.choice(string.digits) for _ in range(6))
        db["pendingOtps"] = [item for item in db["pendingOtps"] if not (item.get("username") == username and item.get("role") == role)]
        db["pendingOtps"].append({
            "role": role,
            "username": username,
            "otp": otp,
            "expiresAt": (now() + timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
            "profile": {
                "name": clean_text(body.get("name")) or username,
                "contact": contact,
                "location": clean_text(body.get("location")),
            },
        })
        write_db(db)
        self.send_json(200, {"ok": True, "demoOtp": otp, "message": "OTP generated for demo verification."})

    def verify_otp(self):
        db = read_db()
        body = self.read_body()
        role = role_name(body.get("role"))
        username = clean_text(body.get("username")).lower()
        otp = clean_text(body.get("otp"))
        pending = next((item for item in db["pendingOtps"] if item.get("username") == username and item.get("role") == role), None)
        if not pending or pending.get("otp") != otp:
            self.send_json(400, {"error": "Invalid OTP. Use the demo OTP shown after sign in."})
            return
        if parse_time(pending.get("expiresAt")) < now():
            self.send_json(400, {"error": "OTP expired. Request a new OTP."})
            return

        key = user_key(role)
        profile = pending["profile"]
        user = next((item for item in db[key] if item.get("username", "").lower() == username), None)
        if user:
            user.update(profile)
            user["verified"] = True
        else:
            user = {
                "id": make_id(role),
                "username": username,
                "verified": True,
                **profile,
            }
            db[key].append(user)
        db["pendingOtps"] = [item for item in db["pendingOtps"] if item is not pending]
        write_db(db)
        self.send_json(200, {"role": role, "user": user})

    def create_product(self):
        db = read_db()
        body = self.read_body()
        farmer = find_by_id(db["farmers"], body.get("farmerId"))
        if not farmer or not farmer.get("verified"):
            self.send_json(400, {"error": "Verified farmer account was not found."})
            return

        starting_bid = to_number(body.get("startingBid"))
        duration_minutes = max(1, int(to_number(body.get("durationMinutes")) or 1440))
        product = {
            "id": make_id("crop"),
            "farmerId": farmer["id"],
            "name": clean_text(body.get("name")),
            "category": clean_text(body.get("category")) or "General",
            "quantity": clean_text(body.get("quantity")),
            "startingBid": starting_bid,
            "description": clean_text(body.get("description")),
            "image": clean_text(body.get("image")),
            "status": "Active",
            "createdAt": now_iso(),
            "endsAt": (now() + timedelta(minutes=duration_minutes)).isoformat().replace("+00:00", "Z"),
        }
        if not product["name"] or not product["quantity"] or starting_bid <= 0:
            self.send_json(400, {"error": "Crop name, quantity, and valid first bid are required."})
            return
        db["products"].insert(0, product)
        write_db(db)
        self.send_json(201, enrich_product(product, db))

    def create_bid(self):
        db = read_db()
        body = self.read_body()
        product = find_by_id(db["products"], body.get("productId"))
        buyer = find_by_id(db["buyers"], body.get("buyerId"))
        if not product or not buyer or not buyer.get("verified"):
            self.send_json(400, {"error": "Active crop or verified consumer account was not found."})
            return
        close_expired_auctions(db)
        if product.get("status") != "Active":
            write_db(db)
            self.send_json(409, {"error": "Bidding is closed for this crop."})
            return

        amount = to_number(body.get("amount"))
        current_bid = to_number(enrich_product(product, db).get("currentBid"))
        if amount <= current_bid:
            self.send_json(400, {"error": f"Bid must be higher than current bid of {current_bid:g}."})
            return
        bid = {
            "id": make_id("bid"),
            "productId": product["id"],
            "buyerId": buyer["id"],
            "amount": amount,
            "message": clean_text(body.get("message")),
            "createdAt": now_iso(),
        }
        db["bids"].insert(0, bid)
        write_db(db)
        self.send_json(201, {**bid, "buyer": buyer})

    def confirm_sale(self, path):
        db = read_db()
        product_id = path.split("/")[3]
        product = find_by_id(db["products"], product_id)
        if not product:
            self.send_json(404, {"error": "Crop was not found."})
            return
        close_expired_auctions(db)
        top_bid = winning_bid(product, db)
        if product.get("status") not in ["Closed", "Confirmed"] or not top_bid:
            write_db(db)
            self.send_json(400, {"error": "Auction must be closed with a winning bid before confirmation."})
            return
        existing = next((item for item in db["confirmations"] if item.get("productId") == product_id), None)
        buyer = find_by_id(db["buyers"], top_bid["buyerId"])
        confirmation = existing or {
            "id": make_id("confirmation"),
            "productId": product_id,
            "farmerId": product["farmerId"],
            "buyerId": top_bid["buyerId"],
            "amount": top_bid["amount"],
            "status": "Confirmed by farmer",
            "createdAt": now_iso(),
        }
        if not existing:
            db["confirmations"].insert(0, confirmation)
        product["status"] = "Confirmed"
        write_db(db)
        self.send_json(200, {**confirmation, "buyer": buyer})

    def serve_static(self, request_path):
        safe_path = Path(unquote(request_path.lstrip("/")))
        file_path = (PUBLIC_DIR / (safe_path or Path("index.html"))).resolve()
        public_root = PUBLIC_DIR.resolve()
        if not str(file_path).startswith(str(public_root)):
            self.send_json(404, {"error": "Not found"})
            return
        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.exists():
            file_path = PUBLIC_DIR / "index.html"
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        if file_path.suffix == ".js":
            content_type = "text/javascript"
        if file_path.suffix in [".html", ".css", ".js", ".json"]:
            content_type += "; charset=utf-8"
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY_SIZE:
            raise ValueError("Request body is too large")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8")) if raw else {}

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    ensure_db()
    mimetypes.add_type("text/javascript", ".js")
    server = ThreadingHTTPServer(("", PORT), HarvestHandler)
    print(f"Harvest Link crop bidding app running at http://localhost:{PORT}")
    server.serve_forever()
