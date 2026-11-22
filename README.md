# Data Scripter

Visual Studio Code extension that generates a `MERGE` script for the data in a SQL Server table or view. It adds a **Script Data as Merge** command to the Object Explorer of the [SQL Server (mssql)](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) extension.

## Requirements

- Visual Studio Code 1.105 or later
- [SQL Server (mssql)](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) extension 1.47 or later

## Usage

1. In the SQL Server Object Explorer, right-click a table and select **Generate Script** > **Script Data as Merge**, or right-click a view and select **Script Data as Merge**.
2. Press <kbd>Enter</kbd> to script all data with the default query, or edit the query to script a subset of the data. The default query selects every column that can be inserted or updated, which leaves out computed, `rowversion` and generated always columns, and the columns of the `dataScripter.skipColumns` setting.
3. Select the columns used to match existing rows. The primary key is selected by default, or the identity column when there is no primary key.
4. The generated `MERGE` statement opens in a new editor tab.

Columns are left out of the part of the `MERGE` they cannot be written in: identity columns are inserted but not updated, and read-only columns are not scripted.

Every row of values is scripted on one line. Line breaks and tabs in a value are scripted as `CHAR` or `NCHAR` codes, such as `N'first' + NCHAR(13) + NCHAR(10) + N'second'`, which inserts the same value. A value with more than 254 parts is joined with `CONCAT` instead, because that many `+` operators can exceed the stack limit of SQL Server.

The SQL Server (mssql) extension only keeps the first 65,535 characters or bytes of a long value, and the first 2 MB of an `xml` value. Data Scripter warns when a value reached the limit, which is raised with the `mssql.query.maxCharsToStore` and `mssql.query.maxXmlCharsToStore` settings.

The first time the command runs, Visual Studio Code asks you to allow Data Scripter to use your SQL Server connections. Access can be revoked at any time from the Accounts menu.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `dataScripter.singleLine` | `false` | Script each list of columns on a single line instead of one column per line. This applies to the source columns, the `INSERT` columns and values, and the `UPDATE SET` assignments. |
| `dataScripter.skipColumns` | `[]` | Names of columns to leave out of the default query, such as `Created` or `Updated`. Names are matched without regard to case, in every table and view. |

Skipped columns are only left out of the default query. Add a column back to the query to script it.

```json
{
  "dataScripter.singleLine": true,
  "dataScripter.skipColumns": ["Created", "CreatedBy", "Updated", "UpdatedBy"]
}
```

## Installation

The current release is available to [download](https://github.com/loresoft/DataScripter/releases) as a .vsix file and can be installed by opening the Extensions view, selecting the **...** menu, and selecting *Install from VSIX...*

## Building

```
npm install
npm test
npm run package
```

Press <kbd>F5</kbd> in Visual Studio Code to launch the extension in an Extension Development Host.
