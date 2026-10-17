import ballerina/ai;
import ballerina/log;
import ballerina/sql;
import ballerina/workflow;

# Records a new claim, waiting for its bill.
#
# + claimId - The claim id: this run's workflow id
# + claim - The claim, from the agent's input
# + return - An error if it cannot be recorded
@workflow:Activity
function createClaim(string claimId, Claim claim) returns error? {
    sql:ExecutionResult _ = check claimsDb->execute(`INSERT INTO claims (claim_id, employee, description, amount, status) VALUES (${claimId}, ${claim.employee}, ${claim.description}, ${claim.amount}, 'BILL_REQUIRED')`);
}

# Reads a bill image: the vendor, the date, the total and every line item.
#
# + fileUrl - The bill's link, as bill storage gives it: /files/<claim>/<name>
# + return - What the bill says
@workflow:Activity
function readBill(string fileUrl) returns BillDetails|error {
    ai:ImageDocument bill = check billImage(fileUrl);
    BillDetails details = check expenseModel->generate(
        `Read this bill. Give the vendor, the date, the total, the currency, and each line item with its amount. ${bill}`);
    return details;
}

# Sets the claim's status and the note the employee sees with it: BILL_REQUIRED, INFO_REQUESTED (the note is the
# question for the employee), WAITING_APPROVAL, APPROVED or REJECTED (the note is the manager's comment).
#
# + claimId - The claim id: this run's workflow id
# + status - The new status
# + note - The note shown with it
# + return - An error if it cannot be recorded
@workflow:Activity
function updateClaim(string claimId, string status, string note) returns error? {
    sql:ExecutionResult _ = check claimsDb->execute(
        `UPDATE claims SET status = ${status}, comment = ${note} WHERE claim_id = ${claimId}`);
}

# Pays the claim and marks it paid.
#
# + claimId - The claim id
# + amount - The amount to pay, after the policy
# + return - An error if the payment cannot be recorded
@workflow:Activity
function payClaim(string claimId, decimal amount) returns error? {
    sql:ExecutionResult _ = check claimsDb->execute(
        `UPDATE claims SET status = 'PAID', paid_amount = ${amount} WHERE claim_id = ${claimId}`);
    log:printInfo("Claim paid", claimId = claimId, amount = amount);
}

# Subtracts amounts from a total, such as the items the policy does not reimburse.
#
# + total - The total
# + amounts - The amounts to subtract
# + return - The total less the amounts
@workflow:Activity
function subtract(decimal total, decimal[] amounts) returns decimal|error {
    decimal result = total;
    foreach decimal amount in amounts {
        result -= amount;
    }
    return result;
}

# Divides an amount between a number of people.
#
# + amount - The amount
# + people - How many people
# + return - The amount per person
@workflow:Activity
function perPerson(decimal amount, int people) returns decimal|error {
    if people <= 0 {
        return error("people must be at least 1");
    }
    return amount / <decimal>people;
}
