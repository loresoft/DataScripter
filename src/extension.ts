import * as vscode from "vscode";
import type { IDbColumn, ITreeNodeInfo, SimpleExecuteResult } from "vscode-mssql";

import { SqlConnection, TableColumn } from "./mssql";
import { findTruncatedColumns, generateSelect, isScriptedColumn, quoteName, SqlGenerator } from "./generator";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("data-scripter.generateMergeScript", generateMergeScript)
  );
}

async function generateMergeScript(node?: ITreeNodeInfo): Promise<void> {
  const metadata = node?.metadata;

  if (!node || !metadata?.name) {
    vscode.window.showErrorMessage("Right-click a table or view in the SQL Server Object Explorer to script its data.");
    return;
  }

  const tableName = `${quoteName(metadata.schema)}.${quoteName(metadata.name)}`;
  const title = `Script Data as Merge: ${tableName}`;

  try {
    const tableColumns = await runQuery(node, `Reading columns of ${tableName}`, "Getting columns...", (connection) =>
      connection.getColumns(metadata.schema, metadata.name)
    );

    if (!tableColumns) {
      return;
    }

    const sql = await vscode.window.showInputBox({
      title: title,
      prompt: "Press [Enter] to accept the default of all data or edit the SQL statement to select subsets of data.",
      value: generateSelect(metadata.schema, metadata.name, tableColumns, getSkipColumns()),
      ignoreFocusOut: true,
    });

    if (!sql || sql.trim() === "") {
      vscode.window.showInformationMessage("Query was cancelled");
      return;
    }

    const results = await runQuery(node, `Scripting data for ${tableName}`, "Getting records...", (connection) =>
      connection.query(sql)
    );

    if (!results) {
      return;
    }

    if (results.rowCount === 0) {
      vscode.window.showInformationMessage("The query returned no rows to script.");
      return;
    }

    if (!results.columnInfo.some(isScriptedColumn)) {
      vscode.window.showErrorMessage("The query returned no columns that can be inserted or updated.");
      return;
    }

    const keyColumns = await resolveKeyColumns(title, results, tableColumns);
    if (!keyColumns) {
      return;
    }

    const settings = vscode.workspace.getConfiguration("dataScripter");

    const sqlGenerator = new SqlGenerator(results, keyColumns, metadata.schema, metadata.name, {
      singleLine: settings.get<boolean>("singleLine", false),
    });
    const sqlScript = sqlGenerator.GenerateMerge();

    const textDocument = await vscode.workspace.openTextDocument({ language: "sql", content: sqlScript });
    await vscode.window.showTextDocument(textDocument);

    warnAboutTruncatedValues(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "There was an unknown error retrieving data";
    vscode.window.showErrorMessage(message);
  }
}

/** Settings are not held to their schema, so anything other than a list of names is ignored. */
function getSkipColumns(): string[] {
  const skipColumns = vscode.workspace.getConfiguration("dataScripter").get<unknown>("skipColumns");

  return Array.isArray(skipColumns) ? skipColumns.filter((name): name is string => typeof name === "string") : [];
}

/** Runs a query on its own connection behind a progress notification, resolving with undefined when cancelled. */
function runQuery<T>(
  node: ITreeNodeInfo,
  title: string,
  message: string,
  run: (connection: SqlConnection) => Promise<T>
): Thenable<T | undefined> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: title, cancellable: true },
    (progress, token) => {
      let connection: SqlConnection | undefined;

      const query = async (): Promise<T | undefined> => {
        progress.report({ message: "Connecting..." });

        connection = await SqlConnection.open(node);

        try {
          if (token.isCancellationRequested) {
            return undefined;
          }

          progress.report({ message: message });

          return await run(connection);
        } finally {
          await connection.close().catch(() => undefined);
        }
      };

      // the service does not stop every query it is asked to cancel, so the command stops waiting
      // and leaves the connection to close once the query has ended
      return new Promise<T | undefined>((resolve, reject) => {
        const cancellation = token.onCancellationRequested(() => {
          resolve(undefined);
          connection?.cancel().catch(() => undefined);
        });

        query()
          .then(resolve, reject)
          .finally(() => cancellation.dispose());
      });
    }
  );
}

/** Asks for the columns used to match rows, preselecting the primary key or else the identity column. */
async function resolveKeyColumns(
  title: string,
  results: SimpleExecuteResult,
  tableColumns: TableColumn[]
): Promise<string[] | undefined> {
  const primaryKey = new Set(
    tableColumns.filter((column) => column.isKey === true).map((column) => column.columnName.toLowerCase())
  );

  // the query result only flags key columns for some queries, so the primary key of the table is matched by name
  const isPrimaryKey = (column: IDbColumn) => column.isKey === true || primaryKey.has(column.columnName.toLowerCase());

  const columns = results.columnInfo.filter(isScriptedColumn);
  const hasPrimaryKey = columns.some(isPrimaryKey);

  const picked = await vscode.window.showQuickPick(
    columns.map((column) => ({
      label: column.columnName,
      picked: hasPrimaryKey ? isPrimaryKey(column) : column.isIdentity === true,
    })),
    {
      canPickMany: true,
      ignoreFocusOut: true,
      title: title,
      placeHolder: "Select the column(s) used to match existing rows",
    }
  );

  if (!picked) {
    return undefined;
  }

  if (picked.length === 0) {
    vscode.window.showWarningMessage("No script was generated because no columns were selected to match existing rows.");
    return undefined;
  }

  return picked.map((item) => item.label);
}

/** The mssql extension cuts long values off without saying so, which would script incomplete data. */
function warnAboutTruncatedValues(results: SimpleExecuteResult): void {
  const settings = vscode.workspace.getConfiguration("mssql.query");

  const truncated = findTruncatedColumns(results, {
    maxCharsToStore: settings.get<number>("maxCharsToStore", 65535),
    maxXmlCharsToStore: settings.get<number>("maxXmlCharsToStore", 2097152),
  });

  if (truncated.length === 0) {
    return;
  }

  vscode.window.showWarningMessage(
    `Values of ${truncated.map(quoteName).join(", ")} reached the size limit of the SQL Server (mssql) extension ` +
      "and are probably cut short in the script. Raise the mssql.query.maxCharsToStore setting, " +
      "or mssql.query.maxXmlCharsToStore for xml, and script the data again."
  );
}
