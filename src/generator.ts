import type { DbCellValue, IDbColumn, SimpleExecuteResult } from "vscode-mssql";

/** The column flags that decide which parts of a merge a column takes part in. */
export type ColumnFlags = Pick<IDbColumn, "isAutoIncrement" | "isIdentity" | "isReadOnly">;

/** The most characters or bytes the mssql extension keeps of a long value, from its `mssql.query` settings. */
export interface StorageLimits {
  maxCharsToStore: number;
  maxXmlCharsToStore: number;
}

/** Read-only columns such as computed or rowversion columns cannot be inserted, identity columns can with IDENTITY_INSERT. */
export function isInsertable(column: ColumnFlags): boolean {
  return column.isReadOnly !== true || column.isIdentity === true;
}

/** Read-only columns and identity columns cannot be updated. */
export function isUpdatable(column: ColumnFlags): boolean {
  return column.isReadOnly !== true && column.isIdentity !== true && column.isAutoIncrement !== true;
}

/** Columns that can be neither inserted nor updated are left out of the script. */
export function isScriptedColumn(column: ColumnFlags): boolean {
  return isInsertable(column) || isUpdatable(column);
}

export function quoteName(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

/** How the script is laid out. */
export interface GeneratorOptions {
  /** Writes each list of columns on a single line instead of one column per line: the source, the insert and its values, and the update. */
  singleLine?: boolean;
}

/**
 * Selects the columns of a table that can be scripted, or every column when none are left.
 * Columns are skipped by name without regard to case, the way SQL Server matches names under most collations.
 */
export function generateSelect(
  schemaName: string,
  tableName: string,
  columns: (ColumnFlags & Pick<IDbColumn, "columnName">)[],
  skipColumns: string[] = []
): string {
  const skipped = new Set(skipColumns.map((name) => name.trim().toLowerCase()));

  const names = columns
    .filter((column) => isScriptedColumn(column) && !skipped.has(column.columnName.toLowerCase()))
    .map((column) => quoteName(column.columnName));

  return `SELECT ${names.length > 0 ? names.join(", ") : "*"} FROM ${quoteName(schemaName)}.${quoteName(tableName)};`;
}

/** Names the scripted columns holding a value at the storage limit, which is where the mssql extension cuts long values off. */
export function findTruncatedColumns(resultSet: SimpleExecuteResult, limits: StorageLimits): string[] {
  return resultSet.columnInfo
    .filter((column, index) => {
      if (column.isLong !== true || !isScriptedColumn(column)) {
        return false;
      }

      const limit = column.isXml === true ? limits.maxXmlCharsToStore : limits.maxCharsToStore;

      return resultSet.rows.some((row) => {
        const value = row[index].displayValue;
        // binary values are shown as 0x followed by two characters for every byte
        const length = column.isBytes === true ? (value.length - 2) / 2 : value.length;

        return !row[index].isNull && length >= limit;
      });
    })
    .map((column) => column.columnName);
}

/** The most arguments a CONCAT takes, and the most parts joined with +, which runs out of stack on thousands of them. */
const maxConcatArguments = 254;

/** Part of a string value as SQL, with the characters it holds and whether it is a max type. */
interface ValuePart {
  sql: string;
  length: number;
  isMax: boolean;
}

export class SqlGenerator {
  private _resultSet: SimpleExecuteResult;
  private _keyColumns: string[];
  private _tableName: string;
  private _schemaName: string;
  private _singleLine: boolean;

  constructor(
    resultSet: SimpleExecuteResult,
    keyColumns: string[],
    schemaName: string,
    tableName: string,
    options: GeneratorOptions = {}
  ) {
    this._schemaName = schemaName;
    this._tableName = tableName;
    this._resultSet = resultSet;
    this._keyColumns = keyColumns;
    this._singleLine = options.singleLine === true;
  }

  public GenerateMerge(): string {
    let scripted: string[] = [];
    const hasIdentity = this.hasIdentityColumn();
    const table = `${quoteName(this._schemaName)}.${quoteName(this._tableName)}`;

    scripted.push(`/* Table ${this._schemaName}.${this._tableName} data */`);
    scripted.push(``);

    if (hasIdentity) {
      scripted.push(`SET IDENTITY_INSERT ${table} ON;`);
      scripted.push(``);
    }

    scripted.push(`MERGE INTO ${table} AS t`);
    scripted.push(`USING`);
    scripted.push(`(`);
    scripted.push(`    VALUES`);
    this.writeValues(scripted);
    scripted.push(`)`);
    scripted.push(`AS s`);
    scripted.push(`(`);
    this.writeColumnNames(scripted, 4, "", isScriptedColumn, this._singleLine);
    scripted.push(`)`);
    scripted.push(`ON`);
    scripted.push(`(`);
    this.writeJoin(scripted);
    scripted.push(`)`);
    scripted.push(`WHEN NOT MATCHED BY TARGET THEN `);
    scripted.push(`    INSERT`);
    scripted.push(`    (`);
    this.writeColumnNames(scripted, 8, "", isInsertable, this._singleLine);
    scripted.push(`    )`);
    scripted.push(`    VALUES`);
    scripted.push(`    (`);
    this.writeColumnNames(scripted, 8, "s", isInsertable, this._singleLine);
    scripted.push(`    )`);
    this.writeUpdate(scripted, 8, this._singleLine);
    scripted.push(`OUTPUT $action as [Action];`);

    if (hasIdentity) {
      scripted.push(``);
      scripted.push(`SET IDENTITY_INSERT ${table} OFF;`);
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

  private writeColumnNames(
    scripted: string[],
    indention: number = 4,
    alias: string = "",
    include: (column: IDbColumn) => boolean = isScriptedColumn,
    singleLine: boolean = false
  ) {
    let columns: string[] = [];

    const indent = " ".repeat(indention);
    const prefix = alias ? `${alias}.` : "";

    for (const column of this._resultSet.columnInfo) {
      if (!include(column)) {
        continue;
      }

      columns.push(`${prefix}${quoteName(column.columnName)}`);
    }

    scripted.push(`${indent}${columns.join(singleLine ? ", " : `,\n${indent}`)}`);
  }

  private writeJoin(scripted: string[], indention: number = 4) {
    let join: string[] = [];

    for (const columnName of this._keyColumns) {
      join.push(`t.${quoteName(columnName)} = s.${quoteName(columnName)}`);
    }

    const indent = " ".repeat(indention);

    scripted.push(`${indent}${join.join(" AND ")}`);
  }

  /** Leaves the update out when there is nothing to update, such as when every column is used to match rows. */
  private writeUpdate(scripted: string[], indention: number = 4, singleLine: boolean = false) {
    let columns: string[] = [];

    const indent = " ".repeat(indention);

    for (const column of this._resultSet.columnInfo) {
      if (column.isKey || !isUpdatable(column) || this._keyColumns.includes(column.columnName)) {
        continue;
      }

      const columnName = quoteName(column.columnName);

      columns.push(`t.${columnName} = s.${columnName}`);
    }

    if (columns.length === 0) {
      return;
    }

    scripted.push(`WHEN MATCHED THEN `);
    scripted.push(`    UPDATE SET`);
    scripted.push(`${indent}${columns.join(singleLine ? ", " : `,\n${indent}`)}`);
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
    return input.replace(/'/g, "''");
  }

  /** Writes line breaks and tabs as character codes, which keeps every row of values on a line of its own. */
  private quoteString(value: string, unicode: boolean): string {
    const prefix = unicode ? "N" : "";
    const char = unicode ? "NCHAR" : "CHAR";

    const terms = value
      .split(/([\r\n\t])/)
      .filter((part) => part.length > 0)
      .map((part) => ({
        sql: /^[\r\n\t]$/.test(part) ? `${char}(${part.charCodeAt(0)})` : `${prefix}'${this.escapeQuotes(part)}'`,
        length: part.length,
        isMax: false,
      }));

    return terms.length === 0 ? `${prefix}''` : this.concat(terms, unicode).sql;
  }

  /** Joins the parts of a value with +, or in nested CONCAT calls when there are more parts than a CONCAT takes. */
  private concat(
    terms: ValuePart[],
    unicode: boolean,
    useConcat: boolean = terms.length > maxConcatArguments
  ): ValuePart {
    if (terms.length === 1) {
      return terms[0];
    }

    if (terms.length > maxConcatArguments) {
      const groups: ValuePart[] = [];

      for (let start = 0; start < terms.length; start += maxConcatArguments) {
        groups.push(this.concat(terms.slice(start, start + maxConcatArguments), unicode, true));
      }

      return this.concat(groups, unicode, true);
    }

    const length = terms.reduce((total, term) => total + term.length, 0);
    const parts = terms.map((term) => term.sql);
    let isMax = terms.some((term) => term.isMax);

    // the result is cut off at 4000 characters, or at 8000 bytes that hold as little as a third as many characters,
    // unless one of the parts is a max type
    if (!isMax && length > (unicode ? 4000 : 2000)) {
      parts[0] = `CAST(${parts[0]} AS ${unicode ? "nvarchar" : "varchar"}(max))`;
      isMax = true;
    }

    return { sql: useConcat ? `CONCAT(${parts.join(", ")})` : parts.join(" + "), length, isMax };
  }

  private getDataRow(row: DbCellValue[]): string {
    let rowData: string[] = [];

    for (let index: number = 0; index !== this._resultSet.columnInfo.length; index++) {
      const column = this._resultSet.columnInfo[index];

      if (this.ignoreColumn(column)) {
        continue;
      }

      if (row[index].isNull) {
        rowData.push("NULL");
        continue;
      }

      // the display value follows the culture of the SQL tools service, which sends an invariant value when it differs
      const value = row[index].invariantCultureDisplayValue ?? row[index].displayValue;

      const formatted = this.formatValue(column, value);
      rowData.push(formatted);
    }

    return rowData.join(", ");
  }

  private formatValue(column: IDbColumn, value: string): string {
    // binary values arrive as a hexadecimal number, including CLR types such as geometry and hierarchyid
    if (column.isBytes === true) {
      return value;
    }

    switch (column.dataTypeName) {
      case "varchar":
      case "char":
      case "text":
        return this.quoteString(value, false);
      case "nvarchar":
      case "ntext":
      case "nchar":
      case "xml":
        return this.quoteString(value, true);
      case "datetime":
      case "smalldatetime":
        // only the ISO 8601 format is read the same way under every language and date format
        return `'${value.replace(" ", "T")}'`;
      case "date":
      case "datetime2":
      case "datetimeoffset":
      case "time":
      case "uniqueidentifier":
        return `'${value}'`;
      case "decimal":
      case "numeric":
      case "real":
      case "float":
      case "money":
      case "smallmoney":
        // money has no invariant value, and some cultures use a comma for decimal places vs a period
        return value.replace(",", ".");
      case "bit":
        // shown as True or False when the mssql.query.displayBitAsNumber setting is off
        return /^true$/i.test(value) ? "1" : /^false$/i.test(value) ? "0" : value;
      case "int":
      case "bigint":
      case "smallint":
      case "tinyint":
      case "geometry":
      case "binary":
      case "image":
      case "timestamp":
      case "varbinary":
        return value;
      default:
        return this.quoteString(value, true);
    }
  }

  private ignoreColumn(column: IDbColumn): boolean {
    return !isScriptedColumn(column);
  }
}
