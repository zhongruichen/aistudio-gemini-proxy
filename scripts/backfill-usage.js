const fs = require('fs');
const path = require('path');
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

function normalizeUsage(usageMetadata) {
  if (!usageMetadata) return null;
  const promptTokens =
    usageMetadata.prompt_tokens ??
    usageMetadata.promptTokenCount ??
    usageMetadata.inputTokenCount ??
    usageMetadata.inputTokens;

  const completionTokens =
    usageMetadata.completion_tokens ??
    usageMetadata.candidatesTokenCount ??
    usageMetadata.outputTokenCount ??
    usageMetadata.outputTokens;

  const totalTokens =
    usageMetadata.total_tokens ??
    usageMetadata.totalTokenCount ??
    (typeof promptTokens === 'number' && typeof completionTokens === 'number'
      ? promptTokens + completionTokens
      : undefined);

  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return null;
  }

  const usage = {};
  if (promptTokens != null) usage.prompt_tokens = promptTokens;
  if (completionTokens != null) usage.completion_tokens = completionTokens;
  if (totalTokens != null) usage.total_tokens = totalTokens;
  if (usageMetadata.promptTokensDetails) {
    usage.prompt_tokens_details = usageMetadata.promptTokensDetails;
  }
  if (usageMetadata.completionTokensDetails) {
    usage.completion_tokens_details = usageMetadata.completionTokensDetails;
  }
  return usage;
}

function extractUsageFromStreamedContent(streamedContent) {
  if (typeof streamedContent !== 'string') return null;
  const lines = streamedContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('data: ')) continue;
    const jsonString = line.substring(6).trim();
    if (!jsonString || jsonString === '[DONE]') continue;
    try {
      const parsed = JSON.parse(jsonString);
      const usage = normalizeUsage(parsed.usageMetadata || parsed.usage);
      if (usage) return usage;
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

async function backfillOne(file) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch (err) {
    console.error(`Skip ${file}: read/parse failed (${err.message})`);
    return { updated: false, reason: 'parse_error' };
  }

  const hasUsage =
    parsed.usage != null ||
    parsed.promptTokens != null ||
    parsed.completionTokens != null ||
    parsed.totalTokens != null;
  if (hasUsage) {
    return { updated: false, reason: 'already_has_usage' };
  }

  const usage =
    normalizeUsage(parsed.responseBody && parsed.responseBody.usage) ||
    extractUsageFromStreamedContent(parsed.responseBody && parsed.responseBody.streamedContent);

  if (!usage) {
    return { updated: false, reason: 'no_usage_found' };
  }

  parsed.usage = usage;
  parsed.promptTokens = usage.prompt_tokens ?? null;
  parsed.completionTokens = usage.completion_tokens ?? null;
  parsed.totalTokens = usage.total_tokens ?? null;
  parsed.costUsd = parsed.costUsd || null; // leave cost empty; pricing varies per model

  try {
    await fs.promises.writeFile(file, JSON.stringify(parsed, null, 2));
    return { updated: true };
  } catch (err) {
    console.error(`Fail write ${file}: ${err.message}`);
    return { updated: false, reason: 'write_error' };
  }
}

async function main() {
  const root = path.join(process.cwd(), 'request_logs');
  let checked = 0;
  let updated = 0;
  let skipped = 0;
  for await (const file of walk(root)) {
    const result = await backfillOne(file);
    checked++;
    if (result.updated) {
      updated++;
      console.log(`Updated usage in ${file}`);
    } else {
      skipped++;
    }
  }
  console.log(`Backfill complete. Checked ${checked}, updated ${updated}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
