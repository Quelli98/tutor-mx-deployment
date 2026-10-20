import http from "node:http";

// supertest starts a new server for every request. Node 19+ keeps client
// connections alive by default, so when a new server is given a port that an
// earlier test's server used, a request can travel down the old connection and
// receive the earlier app's response. Give every test request a fresh connection.
http.globalAgent = new http.Agent({ keepAlive: false });
