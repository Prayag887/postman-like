import http from "node:http";

const server = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") {
    response.end(JSON.stringify({ ok: true, user: { id: "abc" } }));
    return;
  }
  if (request.url === "/users/abc") {
    response.end(JSON.stringify({ id: "abc", name: "Ada Lovelace", role: "admin" }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(8787, "127.0.0.1", () => {
  console.log("APIQA fixture server listening on http://127.0.0.1:8787");
});
