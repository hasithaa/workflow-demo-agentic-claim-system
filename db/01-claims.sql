-- The claims the expense agent records at every step; Expenses lists them. A claim's id is its agent run's id.
USE claims;
CREATE TABLE IF NOT EXISTS claims (
    claim_id     VARCHAR(64)    PRIMARY KEY,
    employee     VARCHAR(255)   NOT NULL,
    description  VARCHAR(255)   NOT NULL,
    amount       DECIMAL(12, 2) NOT NULL,
    paid_amount  DECIMAL(12, 2),
    status       VARCHAR(16)    NOT NULL,
    bill_name    VARCHAR(255),
    bill_url     VARCHAR(512),
    comment      VARCHAR(1024),
    submitted_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Ann's earlier claims, so the portal is not empty on first sign-in.
INSERT IGNORE INTO claims (claim_id, employee, description, amount, status, bill_name, bill_url, comment, submitted_at, updated_at)
VALUES
    ('019a4e21-6c3b-7d10-8f2e-5b7c9d020417', 'ann@example.com', 'Taxi to the airport', 38.40, 'PAID', 'taxi-receipt.png',
        '/files/seed/taxi-receipt.png', 'Thanks Ann', NOW() - INTERVAL 21 DAY, NOW() - INTERVAL 20 DAY),
    ('019a7f02-1e8d-7a44-9c61-3d2a8e031986', 'ann@example.com', 'Conference ticket', 690.00, 'REJECTED', 'ticket-invoice.png',
        '/files/seed/ticket-invoice.png', 'Please book this through the training budget', NOW() - INTERVAL 9 DAY,
        NOW() - INTERVAL 8 DAY);
