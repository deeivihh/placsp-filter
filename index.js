const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const yauzl = require('yauzl');

function printHelp() {
  console.log(`placsp-filter\n\nUsage:\n  node index.js <zip-file> --search "madrid" [--field all|authority|city|title|summary] [--exact] [--output json|csv|<file-path>]\n\nOptions:\n  --search <text>      Text to search for\n  --field <field>      Field to search in: all, authority, city, title, summary\n  --exact              Use exact phrase matching\n  --output <value>     Output format or file path: json, csv, or a custom file path\n  --help               Show this help message\n\nExamples:\n  node index.js C:\\data\\may.zip --search "ayuntamiento de madrid" --field authority --exact\n  node index.js C:\\data\\may.zip --search "madrid" --field all --output csv\n  node index.js C:\\data\\may.zip --search "madrid" --output C:\\exports\\madrid.json\n`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return { help: true };

  let inputZip = null;
  let search = null;
  let output = null;
  let field = 'all';
  let exact = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--') && !inputZip) {
      inputZip = arg;
      continue;
    }
    if (arg === '--search') {
      search = args[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith('--search=')) {
      search = arg.slice('--search='.length);
      continue;
    }
    if (arg === '--output') {
      output = args[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--field') {
      field = args[i + 1] || 'all';
      i++;
      continue;
    }
    if (arg.startsWith('--field=')) {
      field = arg.slice('--field='.length);
      continue;
    }
    if (arg === '--exact') {
      exact = true;
      continue;
    }
  }

  return { inputZip, search, output, field, exact, help: false };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#xD;/g, ' ')
    .replace(/&#xA;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanup(s) {
  return decodeEntities(String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? cleanup(m[1]) : null;
}

function extractAllEntries(xml) {
  const entries = [];
  const re = /<entry\b[\s\S]*?<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) entries.push(m[0]);
  return entries;
}

function extractLink(entryXml) {
  const m = entryXml.match(/<link\b[^>]*href="([^"]+)"[^>]*>/i);
  return m ? decodeEntities(m[1]) : null;
}

function extractFirst(entryXml, patterns) {
  for (const re of patterns) {
    const m = entryXml.match(re);
    if (m) return cleanup(m[1]);
  }
  return null;
}

function extractMany(entryXml, patterns) {
  const values = [];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    while ((m = r.exec(entryXml)) !== null) values.push(cleanup(m[1]));
  }
  return [...new Set(values.filter(Boolean))];
}

function extractAuthorityName(entryXml) {
  return extractFirst(entryXml, [
    /<cac-place-ext:LocatedContractingParty>[\s\S]*?<cac:PartyName>[\s\S]*?<cbc:Name>([\s\S]*?)<\/cbc:Name>[\s\S]*?<\/cac:PartyName>[\s\S]*?<\/cac-place-ext:LocatedContractingParty>/i,
    /<cac:PartyName>[\s\S]*?<cbc:Name>([\s\S]*?)<\/cbc:Name>[\s\S]*?<\/cac:PartyName>/i
  ]);
}

function extractCity(entryXml) {
  return extractFirst(entryXml, [
    /<cac:PostalAddress>[\s\S]*?<cbc:CityName>([\s\S]*?)<\/cbc:CityName>[\s\S]*?<\/cac:PostalAddress>/i
  ]);
}

function extractFolderId(entryXml) {
  return extractFirst(entryXml, [
    /<cbc:ContractFolderID>([\s\S]*?)<\/cbc:ContractFolderID>/i
  ]);
}

function extractStatus(entryXml) {
  return extractFirst(entryXml, [
    /<cbc-place-ext:ContractFolderStatusCode\b[^>]*>([\s\S]*?)<\/cbc-place-ext:ContractFolderStatusCode>/i
  ]);
}

function extractBudget(entryXml) {
  return extractFirst(entryXml, [
    /<cbc:TaxExclusiveAmount\b[^>]*>([\s\S]*?)<\/cbc:TaxExclusiveAmount>/i,
    /<cbc:EstimatedOverallContractAmount\b[^>]*>([\s\S]*?)<\/cbc:EstimatedOverallContractAmount>/i,
    /<cbc:TotalAmount\b[^>]*>([\s\S]*?)<\/cbc:TotalAmount>/i
  ]);
}

function extractCpvs(entryXml) {
  return extractMany(entryXml, [
    /<cbc:ItemClassificationCode\b[^>]*>([\s\S]*?)<\/cbc:ItemClassificationCode>/i
  ]);
}

function extractDocumentUris(entryXml) {
  return extractMany(entryXml, [
    /<cbc:URI>(https:\/\/[\s\S]*?)<\/cbc:URI>/i
  ]);
}

function getSearchableFields(entry) {
  return {
    authority: entry.authorityName || '',
    city: entry.city || '',
    title: entry.title || '',
    summary: entry.summary || '',
    all: [entry.authorityName, entry.city, entry.title, entry.summary].filter(Boolean).join(' | ')
  };
}

function matchesSearch(search, entry, field, exact) {
  const q = normalizeText(search);
  if (!q) return true;

  const fields = getSearchableFields(entry);
  const hay = normalizeText(fields[field] ?? fields.all);

  if (!hay) return false;

  if (exact) {
    return hay === q || hay.includes(q);
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every(token => hay.includes(token));
}

function generateRandomId() {
  return Math.floor(Math.random() * 100000000)
    .toString()
    .padStart(8, '0');
}

function parseEntry(entryXml, sourceFile, options) {
  const id = extractTag(entryXml, 'id');
  const shortId = id ? id.split('/').pop() : generateRandomId();
  const title = extractTag(entryXml, 'title');
  const updated = extractTag(entryXml, 'updated');
  const published = extractTag(entryXml, 'published');
  const summary = extractTag(entryXml, 'summary');
  const link = extractLink(entryXml);
  const authorityName = extractAuthorityName(entryXml);
  const city = extractCity(entryXml);
  const contractFolderId = extractFolderId(entryXml);
  const status = extractStatus(entryXml);
  const budget = extractBudget(entryXml);
  const cpvCodes = extractCpvs(entryXml);
  const documentUris = extractDocumentUris(entryXml);

  const entry = {
    id,
    shortId,
    contractFolderId,
    title,
    authorityName,
    city,
    status,
    budget,
    cpvCodes,
    updated,
    published,
    link,
    summary,
    documentUris,
    sourceFile
  };

  if (!matchesSearch(options.search, entry, options.field, options.exact)) return null;
  return entry;
}

function escapeCsvValue(value) {
  const stringValue = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

function toCsv(results) {
  const headers = [
    'id',
    "shortId",
    'contractFolderId',
    'title',
    'authorityName',
    'city',
    'status',
    'budget',
    'cpvCodes',
    'updated',
    'published',
    'link',
    'summary',
    'documentUris',
    'sourceFile'
  ];

  const lines = [headers.join(',')];
  for (const row of results) {
    lines.push(headers.map(header => escapeCsvValue(row[header])).join(','));
  }
  return lines.join('\n');
}

function resolveOutputConfig(outputValue, inputZip, search) {
  const base = path.basename(inputZip, path.extname(inputZip));
  const slug = normalizeText(search || 'results').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'results';
  const scriptDir = __dirname;
  const outputDir = path.join(scriptDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  if (!outputValue || outputValue === 'json') {
    return { format: 'json', filePath: path.join(outputDir, `${base}-${slug}.json`) };
  }

  if (outputValue === 'csv') {
    return { format: 'csv', filePath: path.join(outputDir, `${base}-${slug}.csv`) };
  }

  const resolvedPath = path.resolve(outputValue);
  const ext = path.extname(resolvedPath).toLowerCase();
  const format = ext === '.csv' ? 'csv' : 'json';
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  return { format, filePath: resolvedPath };
}

function writeOutput(outputConfig, payload) {
  if (outputConfig.format === 'csv') {
    fs.writeFileSync(outputConfig.filePath, toCsv(payload.results), 'utf8');
    return;
  }

  fs.writeFileSync(outputConfig.filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function processZip(zipPath, outputConfig, options) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      const results = [];
      const errors = [];
      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        const name = entry.fileName.toLowerCase();
        const allowed = name.endsWith('.atom') || name.endsWith('.xml') || name.endsWith('.gz');
        if (!allowed) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            errors.push({ sourceFile: entry.fileName, error: streamErr.message });
            zipfile.readEntry();
            return;
          }

          const chunks = [];
          readStream.on('data', chunk => chunks.push(chunk));
          readStream.on('end', () => {
            try {
              const buf = Buffer.concat(chunks);
              const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
              const xml = isGzip ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
              const entries = extractAllEntries(xml);
              for (const entryXml of entries) {
                const parsed = parseEntry(entryXml, entry.fileName, options);
                if (parsed) results.push(parsed);
              }
            } catch (e) {
              errors.push({ sourceFile: entry.fileName, error: e.message });
            }
            zipfile.readEntry();
          });
          readStream.on('error', (e) => {
            errors.push({ sourceFile: entry.fileName, error: e.message });
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => {
        const dedup = new Map();
        for (const item of results) {
          const key = item.id || `${item.contractFolderId}|${item.title}|${item.link}`;
          if (!dedup.has(key)) dedup.set(key, item);
        }

        const finalResults = Array.from(dedup.values()).sort((a, b) => {
          const da = new Date(a.updated || a.published || 0).getTime();
          const db = new Date(b.updated || b.published || 0).getTime();
          return db - da;
        });

        const payload = {
          total: finalResults.length,
          generatedAt: new Date().toISOString(),
          inputZip: path.resolve(zipPath),
          search: options.search,
          field: options.field,
          exact: options.exact,
          results: finalResults,
          errors
        };

        writeOutput(outputConfig, payload);
        console.log(`OK: ${finalResults.length} results saved to ${outputConfig.filePath}`);
        resolve(payload);
      });

      zipfile.on('error', reject);
    });
  });
}

async function main() {
  const { inputZip, search, output, field, exact, help } = parseArgs(process.argv);

  if (help) {
    printHelp();
    return;
  }

  if (!inputZip || !search) {
    console.error('Missing required arguments. You must provide <zip-file> and --search <text>.');
    printHelp();
    process.exit(1);
  }

  const validFields = new Set(['all', 'authority', 'city', 'title', 'summary']);
  if (!validFields.has(field)) {
    console.error('Invalid --field value. Use one of: all, authority, city, title, summary.');
    process.exit(1);
  }

  const zipPath = path.resolve(inputZip);
  if (!fs.existsSync(zipPath)) {
    console.error(`ZIP file not found: ${zipPath}`);
    process.exit(1);
  }

  const outputConfig = resolveOutputConfig(output, zipPath, search);

  try {
    await processZip(zipPath, outputConfig, { search, field, exact });
  } catch (e) {
    console.error(`Error processing ZIP file: ${e.message}`);
    process.exit(1);
  }
}

main();