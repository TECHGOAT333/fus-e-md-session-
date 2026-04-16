const express = require('express');
const app = express();
const bodyParser = require("body-parser");

const PORT = process.env.PORT || 8000;
const __path = process.cwd();

const server = require('./qr');
const code = require('./pair');

// Increase event listeners limit
require('events').EventEmitter.defaultMaxListeners = 500;

// Middlewares (mete yo avan routes yo)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/server', server);
app.use('/code', code);

app.get('/pair', (req, res) => {
  res.sendFile(__path + '/pair.html');
});

app.get('/qr', (req, res) => {
  res.sendFile(__path + '/qr.html');
});

app.get('/', (req, res) => {
  res.sendFile(__path + '/main.html');
});

// Start server
app.listen(PORT, () => {
  console.log(`
🔥 Fus-e-MD Server Running
👉 http://localhost:${PORT}
Don't forget to star the project!
`);
});

module.exports = app;
