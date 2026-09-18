"""
backend/app.py — ভবিষ্যতের জন্য ঐচ্ছিক Flask ব্যাকএন্ড (স্কেলেটন)
======================================================================
এই ফাইলটা এখনই দরকার নেই — সাইট এখন সম্পূর্ণ স্ট্যাটিক (HTML/CSS/JS),
GitHub Pages-এ এমনিতেই চলবে, WhatsApp/bKash-Nagad দিয়ে অর্ডার নেওয়া যাবে।

কবে এটা লাগবে (ভবিষ্যতে):
  - অর্ডারগুলো স্বয়ংক্রিয়ভাবে ডাটাবেসে জমা রাখতে চাইলে
  - একটা এডমিন প্যানেল থেকে অর্ডার/অ্যাপ ম্যানেজ করতে চাইলে
  - সরাসরি অনলাইন পেমেন্ট গেটওয়ে (bKash/Nagad/SSLCommerz API,
    ম্যানুয়াল নম্বর না দেখিয়ে) যোগ করতে চাইলে

⚠️ GitHub Pages শুধু স্ট্যাটিক ফাইল হোস্ট করে — Python কোড চালাতে পারে না।
এই ব্যাকএন্ড চালাতে হলে আলাদা কোথাও হোস্ট করতে হবে, যেমনঃ Render.com,
PythonAnywhere, Railway — এগুলোর ফ্রি টায়ার আছে। frontend (এই সাইট)
GitHub Pages-এ, আর এই backend আলাদা জায়গায় — দুটো আলাদা ডোমেইনে থেকেও
একসাথে কাজ করতে পারে (CORS ইতিমধ্যে চালু করা আছে নিচে)।

চালানোর নিয়ম (লোকালি টেস্ট করতে):
  pip install -r requirements.txt
  python app.py
  → http://localhost:5000
"""
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import sqlite3, os, datetime

app = Flask(__name__)
CORS(app)  # frontend অন্য ডোমেইনে থাকলে browser-এর CORS বাধা এড়াতে

DB_PATH = os.path.join(os.path.dirname(__file__), 'orders.db')


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_slug TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            payment_method TEXT,
            transaction_id TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL
        )
    """)
    db.commit()
    db.close()


@app.route('/api/health')
def health():
    return jsonify({"status": "ok"})


@app.route('/api/orders', methods=['POST'])
def create_order():
    """
    frontend-এর js/main.js-এর "manual-order-form" থেকে এই এন্ডপয়েন্টে
    POST করা যাবে (এখন সেটা শুধু WhatsApp-এ পাঠায়; এই ব্যাকএন্ড চালু
    হলে fetch('/api/orders', {method:'POST', body: JSON.stringify(...)})
    দিয়ে এখানেও পাঠানো শুরু করতে পারেন)।
    """
    data = request.get_json(force=True) or {}
    required = ['app_slug', 'customer_name', 'phone']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"এই ফিল্ডগুলো দরকার: {', '.join(missing)}"}), 400

    db = get_db()
    db.execute(
        "INSERT INTO orders (app_slug, customer_name, phone, payment_method, transaction_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            data['app_slug'], data['customer_name'], data['phone'],
            data.get('payment_method', ''), data.get('transaction_id', ''),
            datetime.datetime.utcnow().isoformat()
        )
    )
    db.commit()
    return jsonify({"message": "অর্ডার সংরক্ষণ করা হয়েছে"}), 201


@app.route('/api/orders', methods=['GET'])
def list_orders():
    """সাধারণ এডমিন-ভিউ — বাস্তবে ব্যবহারের আগে এখানে অবশ্যই একটা
    লগইন/টোকেন-চেক যোগ করুন, এখন এটা উন্মুক্ত (শুধু ডেভেলপমেন্টের জন্য)।"""
    db = get_db()
    rows = db.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)
