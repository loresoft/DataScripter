("use strict");

import * as vscode from "vscode";
import * as azdata from "azdata";

import { SqlGenerator } from "./SqlGenerator";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("data-scripter.generateMergeScript", async (oeContext: azdata.ObjectExplorerContext) => {
      if (!oeContext) {
        vscode.window.showErrorMessage("This extension cannot be run from the command menu.");
        return;
      }

      const metadata = oeContext.nodeInfo!.metadata;
      const tableName: string = `[${metadata!.schema}].[${metadata!.name}]`;

      const inputOptions: vscode.InputBoxOptions = {
        prompt: `Press [Enter] to accept the default of all data or edit the SQL statement to select subsets of data.`,
        value: `SELECT * FROM ${tableName};`,
      };

      const sql = await vscode.window.showInputBox(inputOptions);
      if (!sql || sql.trim() === "") {
        vscode.window.showInformationMessage("Query was cancelled");
        return;
      }

      const generateOptions: GenerateOptions = {
        context: oeContext,
        tableName: tableName,
        selectQuery: sql,
      };

      // run this as a background operation with status displaying in Tasks pane
      const backgroundOperationInfo: azdata.BackgroundOperationInfo = {
        connection: undefined,
        displayName: `Scripting Data for : ${tableName} `,
        description: "A data scripting operation",
        isCancelable: true,
        operation: (operation: azdata.BackgroundOperation) => {
          return scriptData(operation, generateOptions);
        },
      };
      azdata.tasks.startBackgroundOperation(backgroundOperationInfo);
    })
  );
}

async function scriptData(backgroundOperation: azdata.BackgroundOperation, args: GenerateOptions) {
  const connectionProfile = args.context.connectionProfile as azdata.IConnectionProfile;

  try {
    const connectionResult: azdata.ConnectionResult = await azdata.connection.connect(connectionProfile, false, false);

    if (!connectionResult.connected) {
      backgroundOperation.updateStatus(azdata.TaskStatus.Failed, "Could not connect to database server");
      vscode.window.showErrorMessage(`Error:${connectionResult?.errorMessage}`);
      return;
    }

    const connectionUri: string = await azdata.connection.getUriForConnection(connectionResult.connectionId as string);

    const providerId = connectionProfile?.providerName;
    const databaseName = connectionProfile?.databaseName;

    if (!providerId || !databaseName) {
      backgroundOperation.updateStatus(azdata.TaskStatus.Failed, "Could not connect to database server");
      vscode.window.showErrorMessage("Could not connect to database server");
      return;
    }

    const connectionProvider = azdata.dataprotocol.getProvider<azdata.ConnectionProvider>(providerId, azdata.DataProviderType.ConnectionProvider);
    const queryProvider = azdata.dataprotocol.getProvider<azdata.QueryProvider>(providerId, azdata.DataProviderType.QueryProvider);
    const metadataProvider = azdata.dataprotocol.getProvider<azdata.MetadataProvider>(providerId, azdata.DataProviderType.MetadataProvider);

    backgroundOperation.updateStatus(azdata.TaskStatus.InProgress, "Getting records...");

    const changeDatabaseResults = await connectionProvider.changeDatabase(connectionUri, databaseName);

    if (!changeDatabaseResults) {
      backgroundOperation.updateStatus(azdata.TaskStatus.Failed, `Could not switch to [${databaseName}] database`);
      vscode.window.showErrorMessage(`Could not switch to [${databaseName}] database`);
      return;
    }

    /*
  var columns = await metadataProvider.getTableInfo(
    connectionUri,
    args.context.nodeInfo?.metadata as azdata.ObjectMetadata
  );

  var metadata = await metadataProvider.getMetadata(connectionUri);
  var databases = await metadataProvider.getDatabases(connectionUri);
  */

    var results = await queryProvider.runQueryAndReturn(connectionUri, args.selectQuery);
    if (!results || results.rowCount === 0) {
      backgroundOperation.updateStatus(azdata.TaskStatus.Succeeded, "No data retrieved");
      vscode.window.showErrorMessage("The query produced no results!");
      return;
    }

    const metadata = args.context.nodeInfo!.metadata;
    const sqlGenerator: SqlGenerator = new SqlGenerator(results, metadata!.schema, metadata!.name);

    backgroundOperation.updateStatus(azdata.TaskStatus.InProgress, "Reading data...");
    const sqlScript = sqlGenerator.GenerateMerge();

    var textDocument = await vscode.workspace.openTextDocument({ language: "sql" });
    var textEditor = await vscode.window.showTextDocument(textDocument, 1, false);

    textEditor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(0, 0), sqlScript);
      backgroundOperation.updateStatus(azdata.TaskStatus.Succeeded);
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : "There was an unknown error retrieving data";
    backgroundOperation.updateStatus(azdata.TaskStatus.Failed, message);
    vscode.window.showErrorMessage(message);
  }
}
// this method is called when your extension is deactivated
export function deactivate() {}

interface GenerateOptions {
  context: azdata.ObjectExplorerContext;
  tableName: string;
  selectQuery: string;
}
