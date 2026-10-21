import ballerina/ai;
import ballerinax/mysql;
import ballerinax/mysql.driver as _;

final mysql:Client claimsDb = check new (dbHost, dbUser, dbPassword, dbName);
final ai:Wso2ModelProvider wso2ModelProvider = check ai:getDefaultModelProvider();
