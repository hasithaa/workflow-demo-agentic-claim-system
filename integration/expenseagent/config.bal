configurable string dbHost = ?;
configurable string dbUser = ?;
configurable string dbPassword = ?;
configurable string dbName = ?;
configurable string jwtIssuer = "https://localhost:8095";
configurable string jwksUrl = "http://localhost:8080/oidc/jwks";
// Where bill storage keeps the uploaded bills: a bill's link /files/<claim>/<name> is <billDir>/<claim>/<name>.
configurable string billDir = "/data/files";
