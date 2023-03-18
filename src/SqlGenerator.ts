import * as azdata from "azdata";

export class SqlGenerator {
  private _resultSet: azdata.SimpleExecuteResult;
  private _primaryKeySet: azdata.SimpleExecuteResult;
  private _tableName: string;
  private _schemaName: string;

  constructor(resultSet: azdata.SimpleExecuteResult, primaryKeySet: azdata.SimpleExecuteResult, schemaName: string, tableName: string) {
    this._schemaName = schemaName;
    this._tableName = tableName;
    this._resultSet = resultSet;
    this._primaryKeySet = primaryKeySet;
  }

  public GenerateMerge(): string {
    let scripted: string[] = [];
    const hasIdentity = this.hasIdentityColumn();

    scripted.push(`/* Table ${this._schemaName}.${this._tableName} data */\n`);

    if (hasIdentity) {
      scripted.push(`\nSET IDENTITY_INSERT [${this._schemaName}].[${this._tableName}] ON;\n\n`);
    }

    scripted.push(`MERGE INTO [${this._schemaName}].[${this._tableName}] AS t`);
    scripted.push(`USING`);
    scripted.push(`(`);
    scripted.push(`    VALUES`);
    this.writeValues(scripted);
    scripted.push(`)`);
    scripted.push(`AS s`);
    scripted.push(`(`);
    this.writeColumnNames(scripted);
    scripted.push(`)`);
    scripted.push(`ON`);
    scripted.push(`(`);
    this.writeJoin(scripted);
    scripted.push(`)`);
    scripted.push(`WHEN NOT MATCHED BY TARGET THEN `);
    scripted.push(`    INSERT`);
    scripted.push(`    (`);
    this.writeColumnNames(scripted, 8);
    scripted.push(`    )`);
    scripted.push(`    VALUES`);
    scripted.push(`    (`);
    this.writeColumnNames(scripted, 8, "s");
    scripted.push(`    )`);
    scripted.push(`WHEN MATCHED THEN `);
    scripted.push(`    UPDATE SET`);
    this.writeUpdate(scripted, 8);
    scripted.push(`OUTPUT $action as [Action];`);

    if (hasIdentity) {
      scripted.push(`\nSET IDENTITY_INSERT [${this._schemaName}].[${this._tableName}] OFF;`);
    }

    return scripted.join("\n");
  }

  private writeValues(scripted: string[], indention: number = 4): void {
    let columns: string[] = [];

    for (const row of this._resultSet.rows) {

      const indent = " ".repeat(indention);
      const rowData = this.getDataRow(row);

      columns.push(`${indent}(${rowData})`);
    }

    scripted.push(columns.join(",\n"));
  }

  private writeColumnNames(scripted: string[], indention: number = 4, alias: string = "") {
    let columns: string[] = [];

    for (const column of this._resultSet.columnInfo) {
      if (this.ignoreColumn(column)) {
        continue;
      }

      const indent = " ".repeat(indention);
      const prefix = alias ? `${alias}.` : "";
      const columnName = column.columnName;

      columns.push(`${indent}${prefix}[${columnName}]`);
    }

    scripted.push(columns.join(",\n"));
  }

  private writeJoin(scripted: string[], indention: number = 4) {
    let join: string[] = [];

    for (const row of this._primaryKeySet.rows) {
      const columnName = row[0].displayValue;
      join.push(`t.[${columnName}] = s.[${columnName}]`);
    }

    const indent = " ".repeat(indention);

    scripted.push(`${indent}${join.join(" AND ")}`);
  }

  private writeUpdate(scripted: string[], indention: number = 4) {
    let columns: string[] = [];

    for (const column of this._resultSet.columnInfo) {
      if (column.isKey || column.isAutoIncrement || column.isReadOnly) {
        continue;
      }
      const columnName = column.columnName;

      if (this._primaryKeySet.rows.find(p => p[0].displayValue === columnName)){
        continue;
      }
      const indent = " ".repeat(indention);


      columns.push(`${indent}t.[${columnName}] = s.[${columnName}]`);
    }

    scripted.push(columns.join(",\n"));
  }

  private hasIdentityColumn(): boolean {
    for (let i: number = 0; i !== this._resultSet.columnInfo.length; i++) {
      if (this._resultSet.columnInfo[i].isIdentity) {
        return true;
      }
    }

    return false;
  }

  private escapeQuotes(input: string): string {
    return input.replace(/'+/g, "''");
  }

  private getDataRow(row: azdata.DbCellValue[]): string {
    let rowData: string[] = [];

    try {
      for (let index: number = 0; index !== this._resultSet.columnInfo.length; index++) {
        const column = this._resultSet.columnInfo[index];

        if (this.ignoreColumn(column)) {
          continue;
        }

        if (row[index].isNull) {
          rowData.push("NULL");
          continue;
        }

        switch (this._resultSet.columnInfo[index].dataTypeName) {
          case "varchar":
          case "char":
          case "text":
          case "xml":
            rowData.push(`'${this.escapeQuotes(row[index].displayValue)}'`);
            break;
          case "nvarchar":
          case "ntext":
          case "nchar":
            rowData.push(`N'${this.escapeQuotes(row[index].displayValue)}'`);
            break;
          case "date":
          case "datetime":
          case "datetime2":
          case "datetimeoffset":
          case "smalldatetime":
          case "time":
            rowData.push(`'${row[index].displayValue}'`);
            break;
          case "decimal":
          case "numeric":
          case "real":
          case "float":
          case "money":
          case "smallmoney":
            // some collations use a comma for decimal places vs a period
            rowData.push(row[index].displayValue.replace(",", "."));
            break;
          case "uniqueidentifier":
            rowData.push(`'{${row[index].displayValue}}'`);
            break;
          case "bit":
          case "int":
          case "bigint":
          case "smallint":
          case "tinyint":
          case "geometry":
          case "binary":
          case "image":
          case "timestamp":
          case "varbinary":
            rowData.push(row[index].displayValue);
            break;
          default:
            rowData.push(`'${row[index].displayValue}'`);
            break;
        }
      }
    } catch (e) {
      if (e instanceof Error) {
        console.log(e);
        rowData.push("");
      } else {
        throw e;
      }
    }

    return rowData.join(", ");
  }

  private ignoreColumn(column: azdata.IDbColumn): boolean {
    return (column.isReadOnly === true && column.isIdentity !== true);
  }
}
