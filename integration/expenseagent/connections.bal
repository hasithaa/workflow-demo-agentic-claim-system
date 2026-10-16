import ballerinax/mysql;
import ballerinax/mysql.driver as _;

final mysql:Client claimsDb = check new (dbHost, dbUser, dbPassword, dbName);
