import ballerina/ai;
import ballerina/io;
import ballerina/sql;
import ballerina/workflow;

# Records a new claim, waiting for its bill. Pass the claim id and the claim from your input.
#
# + claimId - The claim id: this run's workflow id
# + claim - The claim, from the agent's input
# + return - An error if it cannot be recorded
@workflow:Activity
function createClaim(string claimId, Claim claim) returns error? {
    sql:ExecutionResult sqlExecutionresult = check claimsDb->execute(`INSERT INTO claims (claim_id, employee, description, amount, status) VALUES (${claimId}, ${claim.employee}, ${claim.description}, ${claim.amount}, 'BILL_REQUIRED')`);
}

# Records the bill on the claim, then reads the bill image: the vendor, the date, the total and every line item.
# Pass the claim id and the bill's fileName.
#
# + claimId - The claim id
# + fileName - The bill's file name, from the bill event
# + return - What the bill says
@workflow:Activity
function readBill(string claimId, string fileName) returns BillDetails|error {
    sql:ExecutionResult sqlExecutionresult = check claimsDb->execute(`UPDATE claims SET bill_name = ${fileName}, bill_url = CONCAT('/files/', ${claimId}, '/', ${fileName}) WHERE claim_id = ${claimId}`);
    byte[] content = check io:fileReadBytes(string `${billDir}/${claimId}/${fileName}`);
    ai:ImageDocument bill = {content};
    BillDetails details = check wso2ModelProvider->generate(`Read this bill. Give the vendor, the date, the total, the currency, and each line item with its amount. ${bill}`);
    return details;
}

# Sets the claim's status and the note the employee sees. For APPROVED and REJECTED the note is the manager's
# comment; otherwise it is empty. A question for the employee goes through askEmployee.
#
# + claimId - The claim id
# + status - The new status
# + note - The note shown with it
# + return - An error if it cannot be recorded
@workflow:Activity
function updateClaim(string claimId, ClaimStatus status, string note) returns error? {
    sql:ExecutionResult sqlExecutionresult = check claimsDb->execute(`UPDATE claims SET status = ${status}, comment = ${note} WHERE claim_id = ${claimId}`);
}

# Asks the employee a question about the claim: the claim shows it, waiting for their reply.
#
# + claimId - The claim id
# + question - A short question addressed to the employee
# + return - An error if it cannot be recorded
@workflow:Activity
function askEmployee(string claimId, string question) returns error? {
    sql:ExecutionResult sqlExecutionresult = check claimsDb->execute(`UPDATE claims SET status = 'INFO_REQUESTED', comment = ${question} WHERE claim_id = ${claimId}`);
}

# Subtracts an amount from a total, such as an item the policy does not reimburse.
#
# + total - The total
# + amount - The amount to subtract
# + return - The total less the amount
@workflow:Activity
function subtract(decimal total, decimal amount) returns decimal|error {
    return total - amount;
}

# Divides an amount between a number of people.
#
# + amount - The amount
# + people - How many people
# + return - The amount per person
@workflow:Activity
function perPerson(decimal amount, int people) returns decimal|error {
    return amount / <decimal>people;
}

# Pays the claim and marks it paid.
#
# + claimId - The claim id
# + amount - The amount to pay, after the policy
# + return - An error if the payment cannot be recorded
@workflow:Activity
function payClaim(string claimId, decimal amount) returns error? {
    sql:ExecutionResult sqlExecutionresult = check claimsDb->execute(`UPDATE claims SET status = 'PAID', paid_amount = ${amount} WHERE claim_id = ${claimId}`);
}
