const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Milo Dating — Android App</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #fff; padding: 2rem; }
  </style>
</head>
<body>
  <h1>Milo Dating (Android React Native)</h1>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
