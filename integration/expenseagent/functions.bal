import ballerina/ai;
import ballerina/io;
import ballerina/log;
import ballerina/sql;
import ballerina/workflow;

# Reads a bill image: the vendor, the date, the total and every line item.
#
# + fileUrl - The bill's link, as bill storage gives it: /files/<claim>/<name>
# + return - What the bill says
@workflow:Activity
function readBill(string fileUrl) returns BillDetails|error {
    byte[] content = check io:fileReadBytes(billDir + fileUrl.substring("/files".length()));
    ai:ImageDocument bill = {content};
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
