// Deliberately vulnerable test fixture. Never deploy this code.
const express = require("express");
const { exec } = require("child_process");
const app = express();

app.get("/run", (req, res) => {
  exec("ls " + req.query.dir, (err, out) => res.send(out));
});

app.get("/calc", (req, res) => {
  res.send(String(eval(req.query.expr)));
});

app.get("/hello", (req, res) => {
  res.send("<h1>Hello " + req.query.name + "</h1>");
});

app.listen(3000);
