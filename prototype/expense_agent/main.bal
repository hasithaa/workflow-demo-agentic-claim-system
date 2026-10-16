import ballerina/ai;
import ballerina/io;
import ballerina/lang.runtime;
import ballerina/time;
import ballerina/workflow;
import ballerina/workflow.management;

type Claim record {|
    string employee;
    string description;
    decimal amount;
|};

type Bill record {|
    string fileName;
    string fileUrl;
|};

type LineItem record {|
    string description;
    decimal amount;
|};

type BillDetails record {|
    string vendor;
    string date;
    decimal total;
    string currency;
    LineItem[] lineItems;
|};

type Decision record {|
    boolean approved;
    string comment;
|};

const POLICY = string `
- Client entertainment (a meal with customers) needs the names of everyone who attended and the client's company.
  Up to 120 per person.
- Alcohol is not reimbursed: leave it out of the amount paid.
- Taxis for business travel are reimbursed; no further detail is needed.
- The bill's total must match the amount claimed; if it does not, say so to the manager.`;

final ai:Wso2ModelProvider model = check ai:getDefaultModelProvider();

# Subtracts amounts from a total, such as the items the policy does not reimburse.
#
# + total - The total
# + amounts - The amounts to subtract
# + return - The total less the amounts
@ai:AgentTool
isolated function subtract(decimal total, decimal[] amounts) returns decimal {
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
@ai:AgentTool
isolated function perPerson(decimal amount, int people) returns decimal|error {
    if people <= 0 {
        return error("people must be at least 1");
    }
    return amount / <decimal>people;
}

// Stand-in for the claims database: each claim's status and note, as the employee's app shows them.
isolated map<[string, string]> claimStatus = {};

# Reads a bill image: the vendor, the date, the total and every line item.
#
# + fileUrl - Where the bill is stored
# + return - What the bill says
@workflow:Activity
function readBill(string fileUrl) returns BillDetails|error {
    byte[] content = check io:fileReadBytes(fileUrl);
    ai:ImageDocument bill = {content};
    BillDetails details = check model->generate(
        `Read this bill. Give the vendor, the date, the total, the currency, and each line item with its amount. ${bill}`);
    io:println(string `[${now()}] readBill -> ${details.toString()}`);
    return details;
}

# Sets the claim's status and a note, as the employee sees them: BILL_REQUIRED, INFO_REQUESTED (the note is the
# question), WAITING_APPROVAL, APPROVED, REJECTED or PAID.
#
# + claimId - The claim id: this run's workflow id
# + status - The new status
# + note - The note shown with it
# + return - An error if it cannot be recorded
@workflow:Activity
function updateClaim(string claimId, string status, string note) returns error? {
    io:println(string `[${now()}] updateClaim ${status}: ${note}`);
    lock {
        claimStatus[claimId] = [status, note];
    }
}

# Pays the claim.
#
# + claimId - The claim id
# + amount - The amount to pay
# + return - A payment reference
@workflow:Activity
function payClaim(string claimId, decimal amount) returns string|error {
    io:println(string `[${now()}] payClaim ${amount}`);
    return "PAY-" + claimId.substring(0, 8);
}

final workflow:DurableAgent expenseAgent = check new ({
    systemPrompt: {
        role: "Expense claim assistant",
        instructions: string `You handle one employee expense claim from submission to payment, following the
company's expense policy:${POLICY}
Steps:
1. Get your workflow id: it is the claim id.
2. Call updateClaim with BILL_REQUIRED, then wait for the bill event.
3. Call readBill with the bill's fileUrl, and check the claim and the bill against the policy. Never do arithmetic
   yourself: use subtract for the amount to pay and perPerson for the per-person amount.
4. If the policy needs information the claim does not give, call updateClaim with INFO_REQUESTED and the question
   for the employee as the note, then wait for the reply event. Repeat until nothing is missing.
5. Call updateClaim with WAITING_APPROVAL, then managerApproval. Its task input: claimedAmount, billTotal,
   amountToPay (after the policy), and findings: one short line for EACH policy rule that applies, with the numbers
   (attendees and client, alcohol left out, per-person amount against the limit, bill total against the claim).
6. If the manager approves, call payClaim with amountToPay, then updateClaim with PAID. If not, call updateClaim with
   REJECTED and the manager's comment.
7. Finish with a one-line summary.`
    },
    model: model,
    inputType: Claim,
    tools: [subtract, perPerson],
    activities: [
        readBill,
        updateClaim,
        {activity: payClaim, approvalPolicy: {userRoles: "FINANCE", title: "Release the payment"}}
    ],
    events: {
        bill: {request: Bill, cardinality: workflow:SINGLE_EVENT},
        reply: {request: string}
    },
    humanTasks: {
        managerApproval: {userRoles: "MANAGER", title: "Approve expense claim", resultType: Decision}
    },
    maxIter: 30
});

isolated function now() returns string => time:utcToString(time:utcNow()).substring(11, 19);

public function main() returns error? {
    string id = check expenseAgent.run("A new expense claim.",
        {employee: "ann@example.com", description: "Team dinner with a customer", amount: 420.50d});
    io:println(string `[${now()}] claim ${id}`);

    // Ann: uploads the bill once it is asked for, and answers any question.
    _ = check waitStatus(id, "BILL_REQUIRED");
    _ = check expenseAgent.sendData(id, "bill", {fileName: "dinner-bill.png", fileUrl: "dinner-bill.png"});
    string next = check waitStatus(id, "INFO_REQUESTED", "WAITING_APPROVAL");
    if next == "INFO_REQUESTED" {
        _ = check expenseAgent.sendData(id, "reply",
            "Ann Lee, Tom Reed and Priya Shah from Acme Corp, and Leo Park from our sales team.");
        _ = check waitStatus(id, "WAITING_APPROVAL");
    }

    // Jane: sees the agent's assessment and approves.
    management:HumanTaskSummary task = check waitTask();
    management:HumanTaskInfo info = check management:getHumanTaskInfo(task.taskId);
    io:println(string `[${now()}] Jane sees: ${info.taskInput.toString()}`);
    check management:completeHumanTask(task.taskId, {approved: true, comment: "Thanks Ann"}, ["MANAGER"], "jane");

    // Ivy, in finance: releases the payment.
    management:ReviewActivitySummary review = check waitReview(id, "payClaim");
    management:ReviewActivityInfo payment = check management:getReviewActivityInfo(review.taskId);
    io:println(string `[${now()}] Ivy sees: ${payment.taskInput.toString()}`);
    check management:completeReviewActivity(review.taskId, {action: "proceed"}, ["FINANCE"], "ivy");

    string result = check expenseAgent.waitForResult(id);
    io:println(string `[${now()}] result: ${result}`);
}

function waitStatus(string id, string... wanted) returns string|error {
    foreach int i in 0 ..< 300 {
        string? status;
        lock {
            [string, string]? entry = claimStatus[id];
            status = entry is () ? () : entry[0];
        }
        if status is string && wanted.indexOf(status) != () {
            return status;
        }
        runtime:sleep(1);
    }
    return error("no status " + wanted.toString());
}

function waitTask() returns management:HumanTaskSummary|error {
    foreach int i in 0 ..< 300 {
        management:HumanTaskSummary[] tasks = check management:listAllHumanTasks("PENDING");
        if tasks.length() > 0 {
            return tasks[0];
        }
        runtime:sleep(1);
    }
    return error("no manager task");
}

function waitReview(string id, string activity) returns management:ReviewActivitySummary|error {
    foreach int i in 0 ..< 300 {
        foreach management:ReviewActivitySummary r in check management:listPendingReviewActivities(id) {
            if r.activityName.endsWith(activity) {
                return r;
            }
        }
        runtime:sleep(1);
    }
    return error("no review for " + activity);
}
