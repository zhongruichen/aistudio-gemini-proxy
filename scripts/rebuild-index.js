/**
 * Rebuild request_logs/index.json by scanning all date folders and JSON logs.
 * Run from project root: node scripts/rebuild-index.js
 */
const fs = require('fs');
const path = require('path');

const logsRoot = path.join(process.cwd(), 'request_logs');
const indexFile = path.join(logsRoot, 'index.json');
const skipFiles = new Set(['index.json', 'stats.json']);

async function* walk(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.json') && !skipFiles.has(entry.name)) {
      yield full;
    }
  }
}

function formatLocalDate(timestamp) {
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function rebuild() {
  if (!fs.existsSync(logsRoot)) {
    console.error(`logs root not found: ${logsRoot}`);
    process.exit(1);
  }

  const newIndex = [];
  for await (const file of walk(logsRoot)) {
    try {
      const json = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      const timestamp = json.timestamp ?? json.startTime ?? null;
      const date = json.date || formatLocalDate(timestamp);
      const statusCode = json.statusCode ??
        (json.responseBody && (json.responseBody.status || json.responseBody.statusCode)) ??
        null;
      newIndex.push({
        requestId: json.requestId,
        model: json.model,
        connectionId: json.connectionId ?? null,
        path: json.path,
        method: json.method ?? null,
        status: json.status,
        statusCode: statusCode,
        timestamp: timestamp,
        startTime: json.startTime,
        endTime: json.endTime,
        responseTime: json.responseTime,
        logFile: file,
        date: date,
        promptTokens: json.promptTokens,
        completionTokens: json.completionTokens,
        totalTokens: json.totalTokens,
        costUsd: json.costUsd
      });
    } catch (err) {
      console.warn(`Skip ${file}: ${err.message}`);
    }
  }

  newIndex.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  await fs.promises.writeFile(indexFile, JSON.stringify(newIndex, null, 2));
  console.log(`Rebuilt index with ${newIndex.length} entries -> ${indexFile}`);
}

rebuild().catch((err) => {
  console.error(err);
  process.exit(1);
});
