import ballerina/ai;
import ballerina/workflow;

final ai:Wso2ModelProvider expenseModel = check ai:getDefaultModelProvider();

const EXPENSE_POLICY = string `
- Client entertainment (a meal with customers) needs the names of everyone who attended and the client's company.
  Up to 120 per person.
- Alcohol is not reimbursed: leave it out of the amount paid.
- Taxis for business travel are reimbursed; no further detail is needed.
- The bill's total must match the amount claimed; if it does not, say so to the manager.`;

final workflow:DurableAgent expenseAgent = check new ({
    systemPrompt: {
        role: "Expense claim assistant",
        instructions: string `You handle one employee expense claim from submission to payment, following the
company's expense policy:${EXPENSE_POLICY}
Steps:
1. Get your workflow id: it is the claim id.
2. Call createClaim with the claim id and the claim from your input, then wait for the bill event.
3. Call readBill with the bill's fileUrl, and check the claim and the bill against the policy. Never do arithmetic
   yourself: use the subtract activity for the amount to pay and perPerson for the per-person amount.
4. If the policy needs information the claim does not give, call askEmployee with a short question addressed to the
   employee, then wait for the reply event. Repeat until nothing is missing. Only then go on to step 5.
5. Call updateClaim with WAITING_APPROVAL and an empty note, then managerApproval. Its task input: claimId,
   employee, description, billName and billUrl (from the bill event), claimedAmount, billTotal, amountToPay (after
   the policy), and findings: one short line, with the numbers, for each check: the attendees and client (when it
   is client entertainment), what was left out and why, the per-person amount against the limit, and the bill's
   total against the amount claimed.
6. If the manager approves, call updateClaim with APPROVED and the manager's comment, then payClaim with
   amountToPay. If not, call updateClaim with REJECTED and the manager's comment.
7. Finish with a one-line summary.`
    },
    model: expenseModel,
    inputType: Claim,
    activities: [
        createClaim,
        readBill,
        updateClaim,
        askEmployee,
        subtract,
        perPerson,
        {activity: payClaim, approvalPolicy: {userRoles: "FINANCE", title: "Release the payment"}}
    ],
    events: {
        bill: {request: Bill, cardinality: workflow:SINGLE_EVENT},
        reply: {request: Reply}
    },
    humanTasks: {
        // The fields are described here, since 1.0.0 does not show a taskInputType to the model (ballerina-library#9323).
        managerApproval: {
            userRoles: "MANAGER",
            title: "Approve expense claim",
            description: "Asks the manager to approve the claim, and waits for the decision. Pass claimId, employee, "
                + "description, billName, billUrl, claimedAmount, billTotal and amountToPay, and findings: a JSON "
                + "array of strings, one short line per policy check.",
            resultType: Decision
        }
    },
    maxIter: 30
});
