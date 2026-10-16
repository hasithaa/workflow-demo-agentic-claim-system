-- One MySQL server for the whole demo: the claims, the Integration Control Plane, and (created by
-- Temporal's own setup) the workflow history.
CREATE DATABASE IF NOT EXISTS claims;
CREATE DATABASE IF NOT EXISTS icp_db;
CREATE DATABASE IF NOT EXISTS credentials_db;

CREATE USER IF NOT EXISTS 'claims'@'%' IDENTIFIED BY 'claims';
GRANT ALL PRIVILEGES ON claims.* TO 'claims'@'%';
CREATE USER IF NOT EXISTS 'icp'@'%' IDENTIFIED BY 'icp';
GRANT ALL PRIVILEGES ON icp_db.* TO 'icp'@'%';
GRANT ALL PRIVILEGES ON credentials_db.* TO 'icp'@'%';
FLUSH PRIVILEGES;
