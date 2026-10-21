import ballerina/http;
import ballerina/sql;
import ballerina/workflow.management.rest as _;

listener http:Listener httpDefaultListener = http:getDefaultListener();

// Every call carries the signed-in user's access token from the identity provider.
@http:ServiceConfig {
    auth: [{jwtValidatorConfig: {issuer: jwtIssuer, signatureConfig: {jwksConfig: {url: jwksUrl}}}}]
}
service /claims on httpDefaultListener {
    // Starts the expense agent for the claim: the run's id is the claim id.
    resource function post .(@http:Payload Claim payload) returns json|error {
        do {
            string claimId = check expenseAgent.run("A new expense claim.", payload);
            return claimId;
        } on fail error err {
            return error("unhandled error", err);
        }
    }

    // The bill, sent to the claim's agent run, which is waiting for it.
    resource function post [string claimId]/bill(@http:Payload Bill payload) returns json|error {
        do {
            _ = check expenseAgent.sendData(claimId, "bill", payload);
        } on fail error err {
            return error("unhandled error", err);
        }
    }

    // The employee's answer to the agent's question.
    resource function post [string claimId]/reply(@http:Payload Reply payload) returns json|error {
        do {
            _ = check expenseAgent.sendData(claimId, "reply", payload);
        } on fail error err {
            return error("unhandled error", err);
        }
    }

    // One employee's claims, newest first.
    resource function get .(string employee) returns json|error {
        do {
            stream<record {|anydata...;|}, sql:Error?> claims = claimsDb->query(`SELECT claim_id AS claimId, employee, description, amount, paid_amount AS paidAmount, status, bill_name AS billName, bill_url AS billUrl, comment, DATE_FORMAT(submitted_at, '%Y-%m-%dT%H:%i:%sZ') AS submittedAt, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updatedAt FROM claims WHERE employee = ${employee} ORDER BY submitted_at DESC`);
            record {|anydata...;|}[] rows = check from var row in claims
                select row;
            return rows.toJson();
        } on fail error err {
            return error("unhandled error", err);
        }
    }
}
