# placsp-filter

> [!WARNING]
> This is a vibe-coded project. Use it at your own risk.

`placsp-filter` is a simple Node.js CLI that searches official PLACSP ZIP files and exports matching results to JSON.

It reads a ZIP file, scans all `.atom`, `.xml`, and `.gz` files inside it, extracts procurement entries, and filters them using a search term.

## Data source

*Ministerio de Hacienda y Administraciones Públicas* publishes these open procurement datasets in their website. The dataset is updated daily, and for the current year a new ZIP file is published each month with the updates from the previous month. The ZIP for the current month contains data updated up to the previous day.

This tool does not download ZIP files for you. You must [download these datasets manually first](https://www.hacienda.gob.es/es-es/gobiernoabierto/datos%20abiertos/paginas/licitacionescontratante.aspx), then run the CLI against that local file.

## Install

```bash
npm install
```

## Basic use

```bash
node index.js <zip-file> --search "text"
```

Example:

```bash
node index.js C:\data\may.zip --search "madrid"
```

## Options

- `--search <text>`: text to search for.
- `--field <field>`: where to search. Available values:
  - `all`
  - `authority`
  - `city`
  - `title`
  - `summary`
- `--exact`: use exact phrase matching.
- `--output json|csv|<file-path>`: output format or file path.
- `--help` or `-h`: show help.

## Command format

```bash
node index.js <zip-file> --search "text" [--field all|authority|city|title|summary] [--exact] [--output csv|json|<file-path>]
```

## Examples

### Search everywhere

```bash
node index.js C:\data\may.zip --search "madrid"
```

### Search only in authority name

```bash
node index.js C:\data\may.zip --search "madrid" --field authority
```

### Exact phrase search

```bash
node index.js C:\data\may.zip --search "ayuntamiento de madrid" --field authority --exact
```

### Search only in city

```bash
node index.js C:\data\may.zip --search "madrid" --field city --exact
```

### Custom output path

```bash
node index.js C:\data\may.zip --search "madrid" --output C:\exports\madrid.json
```

### Show help

```bash
node index.js --help
```

## Default output

If you do not use `--output`, the JSON file is saved automatically inside:

```text
./output/
```

This `output` folder is created next to `index.js`.

Example default output:

```text
output/may-madrid.json
```

## Output structure

The generated JSON looks like this:

```json
{
  "total": 0,
  "generatedAt": "2026-06-20T12:00:00.000Z",
  "inputZip": "C:\\data\\may.zip",
  "search": "madrid",
  "field": "all",
  "exact": false,
  "results": [],
  "errors": []
}
```

Each result may include:

- `id`
- `contractFolderId`
- `title`
- `authorityName`
- `city`
- `status`
- `budget`
- `cpvCodes`
- `updated`
- `published`
- `link`
- `summary`
- `documentUris`
- `sourceFile`

## Windows example

```powershell
node .\index.js H:\data\licitaciones\mayo.zip --search "madrid" --field authority --exact
```