# Deliberately vulnerable test fixture. Never deploy this code.
import hashlib
import pickle
import sqlite3
import subprocess

import yaml
from flask import Flask, request

app = Flask(__name__)


@app.route("/user")
def user():
    conn = sqlite3.connect("db.sqlite")
    name = request.args.get("name")
    return str(conn.execute("SELECT * FROM users WHERE name = '%s'" % name).fetchall())


@app.route("/ping")
def ping():
    host = request.args.get("host")
    return subprocess.check_output("ping -c 1 " + host, shell=True)


@app.route("/load")
def load():
    return str(pickle.loads(request.data))


def read_config(path):
    with open(path) as f:
        return yaml.load(f)


def password_hash(pw):
    return hashlib.md5(pw.encode()).hexdigest()


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0")
