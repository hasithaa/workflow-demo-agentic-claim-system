-- Single sign-on to the ICP console with Thunder: identity-provider groups -> console groups -> roles -> permissions.
-- Thunder's MANAGER group sees the workflows and their runs and decides human tasks; FINANCE does the same for the
-- payment reviews; EMPLOYEE sees the runs only.
-- The roles carry the same names as the groups: the console forwards role names to the Workflow Management API,
-- the approval task is addressed to MANAGER, and the payment review to FINANCE.
-- The issuer must string-equal the token's `iss`, Thunder's browser-facing address. Fixed IDs keep this idempotent.
USE icp_db;

INSERT IGNORE INTO roles_v2 (role_id, role_name, org_id, description) VALUES
    ('c1000000-0000-4000-8000-000000000001', 'MANAGER', 1, 'Watches claim workflows and decides their tasks'),
    ('c1000000-0000-4000-8000-000000000002', 'EMPLOYEE', 1, 'Watches claim workflows'),
    ('c1000000-0000-4000-8000-000000000003', 'FINANCE', 1, 'Watches claim workflows and releases payments');

INSERT IGNORE INTO user_groups (group_id, group_name, org_uuid, description) VALUES
    ('c2000000-0000-4000-8000-000000000001', 'Managers', 1, 'Identity provider group MANAGER'),
    ('c2000000-0000-4000-8000-000000000002', 'Employees', 1, 'Identity provider group EMPLOYEE'),
    ('c2000000-0000-4000-8000-000000000003', 'Finance', 1, 'Identity provider group FINANCE');

INSERT IGNORE INTO group_role_mapping (group_id, role_id, org_uuid) VALUES
    ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 1),
    ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 1),
    ('c2000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 1);

INSERT IGNORE INTO sso_group_mappings (mapping_id, org_uuid, issuer, claim_name, claim_value, group_id) VALUES
    ('c3000000-0000-4000-8000-000000000001', 1, 'https://localhost:8095', 'groups', 'MANAGER',
     'c2000000-0000-4000-8000-000000000001'),
    ('c3000000-0000-4000-8000-000000000002', 1, 'https://localhost:8095', 'groups', 'EMPLOYEE',
     'c2000000-0000-4000-8000-000000000002'),
    ('c3000000-0000-4000-8000-000000000003', 1, 'https://localhost:8095', 'groups', 'FINANCE',
     'c2000000-0000-4000-8000-000000000003');

INSERT IGNORE INTO role_permission_mapping (role_id, permission_id)
SELECT 'c1000000-0000-4000-8000-000000000001', permission_id FROM permissions
 WHERE permission_name IN ('workflow_mgt:view_workflows', 'workflow_mgt:manage_workflows',
                           'workflow_mgt:view_human_tasks', 'workflow_mgt:manage_human_tasks',
                           'project_mgt:view', 'integration_mgt:view', 'observability_mgt:view_logs');

INSERT IGNORE INTO role_permission_mapping (role_id, permission_id)
SELECT 'c1000000-0000-4000-8000-000000000002', permission_id FROM permissions
 WHERE permission_name IN ('workflow_mgt:view_workflows', 'project_mgt:view', 'integration_mgt:view');

INSERT IGNORE INTO role_permission_mapping (role_id, permission_id)
SELECT 'c1000000-0000-4000-8000-000000000003', permission_id FROM permissions
 WHERE permission_name IN ('workflow_mgt:view_workflows', 'workflow_mgt:manage_workflows',
                           'workflow_mgt:view_human_tasks', 'workflow_mgt:manage_human_tasks',
                           'project_mgt:view', 'integration_mgt:view', 'observability_mgt:view_logs');
