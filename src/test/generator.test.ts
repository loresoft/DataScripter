import * as assert from "assert";

import type { DbCellValue, IDbColumn, SimpleExecuteResult } from "vscode-mssql";

import { findTruncatedColumns, generateSelect, SqlGenerator } from "../generator";

/** The column fields the generator reads; the rest of IDbColumn is left out of the test data. */
type TestColumn = Pick<IDbColumn, "columnName" | "dataTypeName"> & Partial<IDbColumn>;

function cell(value: string | null): DbCellValue {
  return { displayValue: value ?? "NULL", isNull: value === null };
}

function resultSet(columnInfo: TestColumn[], rows: (string | null)[][]): SimpleExecuteResult {
  return { rowCount: rows.length, columnInfo: columnInfo as IDbColumn[], rows: rows.map((row) => row.map(cell)) };
}

suite("SqlGenerator", () => {
  test("merges on the key columns and updates the rest", () => {
    const results = resultSet(
      [
        { columnName: "OrderId", dataTypeName: "int" },
        { columnName: "LineNumber", dataTypeName: "int" },
        { columnName: "Quantity", dataTypeName: "int" },
      ],
      [
        ["1", "1", "5"],
        ["1", "2", "7"],
      ]
    );

    const script = new SqlGenerator(results, ["OrderId", "LineNumber"], "dbo", "OrderLine").GenerateMerge();

    assert.ok(script.includes("MERGE INTO [dbo].[OrderLine] AS t"));
    assert.ok(script.includes("    (1, 1, 5),\n    (1, 2, 7)"));
    assert.ok(script.includes("    t.[OrderId] = s.[OrderId] AND t.[LineNumber] = s.[LineNumber]"));
    assert.ok(script.includes("    UPDATE SET\n        t.[Quantity] = s.[Quantity]\nOUTPUT $action AS [Action];"));
    assert.ok(!script.includes("IDENTITY_INSERT"));
  });

  test("scripts identity columns and skips other read-only columns", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int", isIdentity: true, isReadOnly: true },
        { columnName: "Name", dataTypeName: "nvarchar" },
        { columnName: "NameLength", dataTypeName: "int", isReadOnly: true },
      ],
      [["1", "Active", "6"]]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Status").GenerateMerge();

    assert.ok(script.includes("SET IDENTITY_INSERT [dbo].[Status] ON;"));
    assert.ok(script.includes("SET IDENTITY_INSERT [dbo].[Status] OFF;"));
    assert.ok(script.includes("    (1, N'Active')\n"));
    assert.ok(script.includes("        s.[Id],\n        s.[Name]\n"));
    assert.ok(!script.includes("NameLength"));
  });

  test("formats values by data type", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "uniqueidentifier" },
        { columnName: "Code", dataTypeName: "varchar" },
        { columnName: "Title", dataTypeName: "nvarchar" },
        { columnName: "Price", dataTypeName: "decimal" },
        { columnName: "Created", dataTypeName: "datetime2" },
        { columnName: "Notes", dataTypeName: "nvarchar" },
      ],
      [["6f9619ff-8b86-d011-b42d-00c04fc964ff", "A", "It's", "12,50", "2024-01-31 08:15:00.0000000", null]]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Product").GenerateMerge();

    assert.ok(
      script.includes(
        "    ('6f9619ff-8b86-d011-b42d-00c04fc964ff', 'A', N'It''s', 12.50, '2024-01-31 08:15:00.0000000', NULL)\n"
      )
    );
  });

  test("prefers the culture invariant value", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Price", dataTypeName: "decimal" },
        { columnName: "Cost", dataTypeName: "decimal" },
      ],
      [["1", "\u22121234,5", "12.50"]]
    );
    results.rows[0][1].invariantCultureDisplayValue = "-1234.5";
    results.rows[0][2].invariantCultureDisplayValue = null;

    const script = new SqlGenerator(results, ["Id"], "dbo", "Product").GenerateMerge();

    assert.ok(script.includes("    (1, -1234.5, 12.50)\n"));
  });

  test("keeps every quote of a value", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Name", dataTypeName: "nvarchar" },
        { columnName: "Doc", dataTypeName: "json" },
      ],
      [["1", "a''b", `{"name":"O'Brien"}`]]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Person").GenerateMerge();

    assert.ok(script.includes(`    (1, N'a''''b', N'{"name":"O''Brien"}')\n`));
  });

  test("keeps a row on one line when a value has line breaks or tabs", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Code", dataTypeName: "varchar" },
        { columnName: "Notes", dataTypeName: "nvarchar" },
        { columnName: "Empty", dataTypeName: "nvarchar" },
      ],
      [
        ["1", "a\tb", "It's\r\ntwo", ""],
        ["2", "\n", "\nend\n", ""],
      ]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Note").GenerateMerge();

    assert.ok(script.includes("    (1, 'a' + CHAR(9) + 'b', N'It''s' + NCHAR(13) + NCHAR(10) + N'two', N''),\n"));
    assert.ok(script.includes("    (2, CHAR(10), NCHAR(10) + N'end' + NCHAR(10), N'')\n"));
    assert.ok(!/[\r\t]/.test(script));
  });

  test("joins a long value with line breaks as a max type", () => {
    const line = "x".repeat(1500);
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Body", dataTypeName: "varchar" },
        { columnName: "Notes", dataTypeName: "nvarchar" },
        { columnName: "Short", dataTypeName: "nvarchar" },
      ],
      [["1", `${line}\n${line}`, `${line}\n${line}\n${line}`, `${line}\n${line}`]]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Note").GenerateMerge();

    assert.ok(script.includes(`    (1, CAST('${line}' AS varchar(max)) + CHAR(10) + '${line}', `));
    assert.ok(script.includes(`, CAST(N'${line}' AS nvarchar(max)) + NCHAR(10) + N'${line}' + NCHAR(10) + N'${line}', `));
    assert.ok(script.includes(`, N'${line}' + NCHAR(10) + N'${line}')\n`));
  });

  test("joins a value with more parts than CONCAT takes in nested calls", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Notes", dataTypeName: "nvarchar" },
      ],
      [
        ["1", "a\t".repeat(128)],
        ["2", "a\t".repeat(127)],
      ]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Note").GenerateMerge();
    const group = `CONCAT(${"N'a', NCHAR(9), ".repeat(126)}N'a', NCHAR(9))`;

    assert.ok(script.includes(`    (1, CONCAT(${group}, CONCAT(N'a', NCHAR(9)))),\n`));
    assert.ok(script.includes(`    (2, ${"N'a' + NCHAR(9) + ".repeat(126)}N'a' + NCHAR(9))\n`));
  });

  test("formats values that depend on the type or a setting", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Body", dataTypeName: "xml" },
        { columnName: "Modified", dataTypeName: "datetime" },
        { columnName: "Active", dataTypeName: "bit" },
        { columnName: "Location", dataTypeName: "db.sys.geography", isBytes: true, isUdt: true },
      ],
      [["1", "<a>\u00e9</a>", "2024-01-31 08:15:00.000", "True", "0xE6100000010C"]]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Place").GenerateMerge();

    assert.ok(script.includes("    (1, N'<a>\u00e9</a>', '2024-01-31T08:15:00.000', 1, 0xE6100000010C)\n"));
  });

  test("escapes names", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Odd]Name", dataTypeName: "int" },
      ],
      [["1", "2"]]
    );

    const script = new SqlGenerator(results, ["Odd]Name"], "dbo", "Od]d").GenerateMerge();

    assert.ok(script.includes("MERGE INTO [dbo].[Od]]d] AS t"));
    assert.ok(script.includes("    t.[Odd]]Name] = s.[Odd]]Name]\n"));
    assert.ok(script.includes("        s.[Id],\n        s.[Odd]]Name]\n"));
  });

  test("leaves columns out of the part of the merge they cannot be written in", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int", isIdentity: true, isReadOnly: true },
        { columnName: "Code", dataTypeName: "varchar" },
        { columnName: "Name", dataTypeName: "varchar" },
        { columnName: "Version", dataTypeName: "timestamp", isReadOnly: true },
      ],
      [["1", "A", "Active", "0x00000000000007D1"]]
    );

    const script = new SqlGenerator(results, ["Code"], "dbo", "Status").GenerateMerge();

    assert.ok(script.includes("    INSERT\n    (\n        [Id],\n        [Code],\n        [Name]\n    )"));
    assert.ok(script.includes("    UPDATE SET\n        t.[Name] = s.[Name]\nOUTPUT"));
    assert.ok(!script.includes("Version"));
  });

  test("scripts every column list on a single line in single line mode", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int", isIdentity: true, isReadOnly: true },
        { columnName: "Code", dataTypeName: "varchar" },
        { columnName: "Name", dataTypeName: "varchar" },
        { columnName: "Version", dataTypeName: "timestamp", isReadOnly: true },
      ],
      [["1", "A", "Active", "0x00000000000007D1"]]
    );

    const script = new SqlGenerator(results, ["Id"], "dbo", "Status", { singleLine: true }).GenerateMerge();

    assert.ok(script.includes("    INSERT\n    (\n        [Id], [Code], [Name]\n    )\n"));
    assert.ok(script.includes("    VALUES\n    (\n        s.[Id], s.[Code], s.[Name]\n    )\n"));
    assert.ok(script.includes("AS s\n(\n    [Id], [Code], [Name]\n)\n"));
    assert.ok(script.includes("    UPDATE SET\n        t.[Code] = s.[Code], t.[Name] = s.[Name]\nOUTPUT"));
  });

  test("leaves the update out when every column is used to match rows", () => {
    const results = resultSet(
      [
        { columnName: "UserId", dataTypeName: "int" },
        { columnName: "RoleId", dataTypeName: "int" },
      ],
      [["1", "2"]]
    );

    const script = new SqlGenerator(results, ["UserId", "RoleId"], "dbo", "UserRole").GenerateMerge();

    assert.ok(script.includes("        s.[RoleId]\n    )\nOUTPUT $action AS [Action];"));
    assert.ok(!script.includes("WHEN MATCHED"));
  });

  test("fails instead of scripting a row with a missing value", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Name", dataTypeName: "nvarchar" },
      ],
      [["1", "x"]]
    );
    results.rows[0].pop();

    assert.throws(() => new SqlGenerator(results, ["Id"], "dbo", "Person").GenerateMerge());
  });
});

suite("generateSelect", () => {
  test("selects the columns that can be inserted or updated", () => {
    const query = generateSelect("dbo", "Ord]er", [
      { columnName: "Id", isIdentity: true },
      { columnName: "Na]me" },
      { columnName: "Total", isReadOnly: true },
    ]);

    assert.strictEqual(query, "SELECT [Id], [Na]]me] FROM [dbo].[Ord]]er];");
  });

  test("leaves out the skipped columns without regard to case", () => {
    const query = generateSelect(
      "dbo",
      "Order",
      [{ columnName: "Id", isIdentity: true }, { columnName: "Name" }, { columnName: "Created" }, { columnName: "UpdatedBy" }],
      ["created", " UPDATEDBY ", "Missing"]
    );

    assert.strictEqual(query, "SELECT [Id], [Name] FROM [dbo].[Order];");
  });

  test("selects every column when the columns are not known", () => {
    assert.strictEqual(generateSelect("dbo", "Order", []), "SELECT * FROM [dbo].[Order];");
  });
});

suite("findTruncatedColumns", () => {
  test("finds long columns with a value at the storage limit", () => {
    const results = resultSet(
      [
        { columnName: "Id", dataTypeName: "int" },
        { columnName: "Notes", dataTypeName: "nvarchar", isLong: true },
        { columnName: "Photo", dataTypeName: "varbinary", isLong: true, isBytes: true },
        { columnName: "Body", dataTypeName: "xml", isLong: true, isXml: true },
        { columnName: "Summary", dataTypeName: "nvarchar", isLong: true },
        { columnName: "Code", dataTypeName: "varchar" },
      ],
      [
        ["1", "12345678", "0x0102030405060708", "<a>12345</a>", "1234567", "12345678"],
        ["2", null, null, null, null, null],
      ]
    );

    const truncated = findTruncatedColumns(results, { maxCharsToStore: 8, maxXmlCharsToStore: 20 });

    assert.deepStrictEqual(truncated, ["Notes", "Photo"]);
  });
});
