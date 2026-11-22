import * as vscode from "vscode";
import type { IDbColumn, IExtension, ISharedConnectionsService, ITreeNodeInfo, SimpleExecuteResult } from "vscode-mssql";

import { quoteName } from "./generator";

const mssqlExtensionId = "ms-mssql.mssql";

/** A column of a table or view, flagged the way the mssql extension flags the columns of a query result. */
export type TableColumn = Pick<IDbColumn, "columnName" | "isIdentity" | "isKey" | "isReadOnly">;

/** A connection to the database that owns an Object Explorer node. */
export class SqlConnection {
  private constructor(
    private readonly api: ISharedConnectionsService,
    private readonly accessToken: string,
    private readonly connectionUri: string
  ) {}

  public static async open(node: ITreeNodeInfo): Promise<SqlConnection> {
    const connectionId = node.connectionProfile?.id;
    if (!connectionId) {
      throw new Error("Could not determine the connection of the selected object.");
    }

    const api = await getSharedConnectionsApi();

    // VS Code asks the user to allow access to their SQL Server connections the first time
    const session = await vscode.authentication.getSession(api.authenticationProviderId, [], { createIfNone: true });
    const connectionUri = await api.connect(session.accessToken, connectionId, getDatabaseName(node));

    return new SqlConnection(api, session.accessToken, connectionUri);
  }

  public query(sql: string): Promise<SimpleExecuteResult> {
    return this.api.executeSimpleQuery(this.accessToken, this.connectionUri, sql);
  }

  /** Reads the columns of a table or view, marking the primary key and the columns that cannot be written. */
  public async getColumns(schemaName: string, objectName: string): Promise<TableColumn[]> {
    const columnSql = getColumnsQuery(schemaName, objectName);
    const results = await this.query(columnSql);

    return results.rows.map((row) => ({
      columnName: row[0].displayValue,
      isIdentity: row[1].displayValue === "1",
      isReadOnly: row[2].displayValue === "1",
      isKey: row[3].displayValue === "1",
    }));
  }

  public cancel(): Promise<void> {
    return this.api.cancelQuery(this.accessToken, this.connectionUri);
  }

  public close(): Promise<void> {
    return this.api.disconnect(this.accessToken, this.connectionUri);
  }
}

async function getSharedConnectionsApi(): Promise<ISharedConnectionsService> {
  const extension = vscode.extensions.getExtension<IExtension>(mssqlExtensionId);
  if (!extension) {
    throw new Error("The SQL Server (mssql) extension is not installed.");
  }

  const api = extension.isActive ? extension.exports : await extension.activate();
  if (typeof api?.getSharedConnectionsApi !== "function") {
    throw new Error("Data Scripter requires version 1.47 or later of the SQL Server (mssql) extension.");
  }

  return api.getSharedConnectionsApi(1);
}

/**
 * Computed, rowversion and generated always columns cannot be written. The flags are returned as int because
 * the display of bit follows a setting, and GeneratedAlwaysType is NULL on versions without temporal tables.
 */
function getColumnsQuery(schemaName: string, objectName: string): string {
  const objectLiteral = `${quoteName(schemaName)}.${quoteName(objectName)}`.replace(/'/g, "''");

  return `SELECT c.name AS ColumnName,
  CAST(c.is_identity AS int) AS IsIdentity,
  CASE WHEN c.is_computed = 1 OR c.system_type_id = 189
    OR ISNULL(CAST(COLUMNPROPERTY(c.object_id, c.name, 'GeneratedAlwaysType') AS int), 0) <> 0 THEN 1 ELSE 0 END AS IsReadOnly,
  CASE WHEN EXISTS (
    SELECT 1 FROM sys.indexes AS i
    INNER JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    WHERE i.object_id = c.object_id AND i.is_primary_key = 1 AND ic.column_id = c.column_id
  ) THEN 1 ELSE 0 END AS IsKey
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'${objectLiteral}')
ORDER BY c.column_id;`;
}

/** Object nodes sit below their database node, unless the connection itself is scoped to a database. */
function getDatabaseName(node: ITreeNodeInfo): string | undefined {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent.metadata?.metadataTypeName === "Database") {
      return parent.metadata.name;
    }
  }

  return node.connectionProfile?.database || undefined;
}
