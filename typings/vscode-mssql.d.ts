/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/*
 * The parts of the SQL Server (mssql) extension API that Data Scripter uses, trimmed from
 * https://github.com/microsoft/vscode-mssql/blob/main/extensions/mssql/typings/vscode-mssql.d.ts
 *
 * There is no "vscode-mssql" module at runtime, so always use `import type`.
 * Members marked "not in the upstream typings" are sent by the mssql extension but missing from its typings.
 */
declare module "vscode-mssql" {
  import * as vscode from "vscode";

  /** The API provided to other extensions by the mssql extension. */
  export interface IExtension {
    /**
     * Returns the APIs for working with mssql connections after the user approves access
     * through VS Code's authentication consent.
     * @param version The API version, currently `1`.
     */
    getSharedConnectionsApi(version: 1): ISharedConnectionsService;
  }

  /**
   * Lets other extensions use connections established by the mssql extension.
   *
   * Before calling it, request a session from the {@link authenticationProviderId} authentication
   * provider. VS Code asks the user to approve your extension the first time. Pass the session's
   * access token to every method.
   */
  export interface ISharedConnectionsService {
    /** The ID of the authentication provider to request a session from. */
    readonly authenticationProviderId: string;
    /**
     * Connect to an existing connection using the connection ID.
     * @param accessToken The access token of a session from {@link authenticationProviderId}.
     * @param connectionId The ID of the connection.
     * @param database Optional database name to connect to.
     * @returns The URI of the new connection.
     * @throws Error if the connection is not found or cannot be established.
     */
    connect(accessToken: string, connectionId: string, database?: string): Promise<string>;
    /**
     * Disconnect a connection that {@link connect} opened.
     * @param accessToken The access token of the session that opened the connection.
     * @param connectionUri The URI of the connection.
     */
    disconnect(accessToken: string, connectionUri: string): Promise<void>;
    /**
     * Execute a simple query on a connection that {@link connect} opened.
     * @param accessToken The access token of the session that opened the connection.
     * @param connectionUri The URI of the connection.
     * @param queryString The SQL query to execute.
     */
    executeSimpleQuery(accessToken: string, connectionUri: string, queryString: string): Promise<SimpleExecuteResult>;
    /**
     * Cancel the query running on a connection that {@link connect} opened.
     * @param accessToken The access token of the session that opened the connection.
     * @param connectionUri The URI of the connection.
     */
    cancelQuery(accessToken: string, connectionUri: string): Promise<void>;
  }

  export interface SimpleExecuteResult {
    /** Count of rows returned by the query. */
    rowCount: number;
    /** Column information for the result set. */
    columnInfo: IDbColumn[];
    /** Rows returned by the query, each an array with the value of every column in that row. */
    rows: DbCellValue[][];
    /** Messages generated during query execution (e.g. PRINT output, info messages). */
    messages?: ResultMessage[];
  }

  export interface ResultMessage {
    batchId?: number;
    isError: boolean;
    time?: string;
    message: string;
  }

  /** Declared as a class upstream. */
  export interface DbCellValue {
    /** Display value for the cell. */
    displayValue: string;
    /** Whether or not the cell is NULL. */
    isNull: boolean;
    /** Culture invariant display value for the cell. Not in the upstream typings. */
    invariantCultureDisplayValue?: string | null;
    /** The internal ID for the row. Not in the upstream typings. */
    rowId?: number;
  }

  export interface IDbColumn {
    allowDBNull?: boolean;
    baseCatalogName: string;
    baseColumnName: string;
    baseSchemaName: string;
    baseServerName: string;
    baseTableName: string;
    columnName: string;
    columnOrdinal?: number;
    columnSize?: number;
    isAliased?: boolean;
    isAutoIncrement?: boolean;
    isExpression?: boolean;
    isHidden?: boolean;
    isIdentity?: boolean;
    isKey?: boolean;
    isBytes?: boolean;
    isChars?: boolean;
    isSqlVariant?: boolean;
    isUdt?: boolean;
    dataType: string;
    isXml?: boolean;
    isJson?: boolean;
    isVector?: boolean;
    isLong?: boolean;
    isReadOnly?: boolean;
    isUnique?: boolean;
    numericPrecision?: number;
    numericScale?: number;
    udtAssemblyQualifiedName: string;
    dataTypeName: string;
  }

  /** A node of the Object Explorer tree, passed to the commands of its context menu. */
  export interface ITreeNodeInfo extends vscode.TreeItem {
    /** Marked upstream for removal once dependent extensions have migrated. */
    readonly connectionProfile: IConnectionInfo;
    nodeType: string;
    metadata: ObjectMetadata;
    parentNode: ITreeNodeInfo;
  }

  /** Information about a database connection necessary for connecting to a database. */
  export interface IConnectionInfo {
    /** server name */
    server: string;
    /** database name */
    database: string;
    /** The ID of a saved connection, as taken by {@link ISharedConnectionsService.connect}. Not in the upstream typings. */
    id?: string;
  }

  export interface ObjectMetadata {
    metadataTypeName: string;
    urn: string;
    name: string;
    schema: string;
    parentName?: string;
    parentTypeName?: string;
  }
}
