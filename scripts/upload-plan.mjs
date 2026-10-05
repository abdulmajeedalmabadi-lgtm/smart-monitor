export const uploadTables=['workspaces','pools','devices','notification_settings','contacts','alerts','telemetry','audit_log'];
export function buildUploadPlan(rows){
const tables=uploadTables;
const statements=[
  {sql:'CREATE TABLE _upload_guard (n INTEGER CHECK(n=0))',args:[]},
  {sql:`INSERT INTO _upload_guard SELECT
    (SELECT COALESCE(SUM(revision),0) FROM workspaces)+
    (SELECT COUNT(*) FROM contacts)+(SELECT COUNT(*) FROM alerts)+
    (SELECT COUNT(*) FROM telemetry)+(SELECT COUNT(*) FROM audit_log)`,args:[]},
  ...[...tables].reverse().map(table=>({sql:`DELETE FROM ${table}`,args:[]})),
];
for(const table of tables)for(const row of rows[table]){
  const columns=Object.keys(row);
  statements.push({sql:`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,args:Object.values(row)});
}
statements.push({sql:'DROP TABLE _upload_guard',args:[]});
return statements;
}
