# Change Log

All notable changes to the "data-scripter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [2.0.0]

- Converted from an Azure Data Studio extension to a Visual Studio Code extension for the SQL Server (mssql) extension
- Added "Script Data as Merge" to the "Generate Script" menu of tables and to the context menu of views in the Object Explorer
- Added a prompt for the columns used to match rows
- Added a warning when long values were cut off by the SQL Server (mssql) extension
- Added the `dataScripter.singleLine` setting to script each list of columns on a single line
- Added the `dataScripter.skipColumns` setting to leave columns out of the default query
- Changed the default query to select the columns that can be inserted or updated instead of `SELECT *`
- Changed the `MERGE` to leave columns out of the part they cannot be written in, and to leave out the update when there is nothing to update
- Changed line breaks and tabs in values to be scripted as `CHAR` and `NCHAR` codes, which keeps every row of values on one line
- Fixed foreign key and unique constraint columns being treated as primary key columns
- Fixed values with consecutive quotes, and quotes in `json` and `sql_variant` values
- Fixed `geography`, `geometry` and `hierarchyid` values being scripted as text
- Fixed `xml` values losing characters outside the code page of the database
- Fixed `datetime` and `smalldatetime` values failing under languages with a day-month-year date format
- Fixed `bit` values when the `mssql.query.displayBitAsNumber` setting is off
- Fixed names containing `]`
- Fixed cancelling waiting for the query to end

## [1.0.0]

- Initial release for Azure Data Studio
