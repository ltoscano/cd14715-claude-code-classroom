import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CodeReviewOrchestrator, type ReviewProgress } from './orchestrator.js';
import { ReportGenerator, formatError } from './utils/index.js';

function showProgress({ completed, total, analysis }: ReviewProgress): void {
  const status = `Analyses: ${completed}/${total}`;
  const detail = analysis ? ` | ${analysis.agent}` : '';
  if (!process.stderr.isTTY) {
    const file = analysis ? ` | ${JSON.stringify(analysis.file)}` : '';
    console.error(status + detail + file);
    return;
  }

  const width = 12;
  const filled = total === 0 ? width : Math.floor(width * completed / total);
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
  const line = `${bar} ${status}${detail}`;
  process.stderr.clearLine(0);
  process.stderr.cursorTo(0);
  process.stderr.write(line.slice(0, process.stderr.columns - 1));
}

async function main(): Promise<void> {
  const [owner, repo, prStr, ...extra] = process.argv.slice(2);
  if (!owner?.trim() || !repo?.trim() || !prStr || extra.length) {
    throw new Error('Usage: npm run dev -- <owner> <repo> <positive-pr-number>');
  }
  const prNumber = Number(prStr);
  if (!/^\d+$/.test(prStr) || !Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new Error('The pull request number must be a positive integer.');
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error(
      'Set ANTHROPIC_API_KEY in .env for this CLI. The template also allows a Bedrock implementation with ' +
      'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION.'
    );
  }
  if (!process.env.ANTHROPIC_MODEL?.trim()) {
    throw new Error(
      'Set ANTHROPIC_MODEL in .env. Example formats: claude-sonnet-4-5-20250929 for Anthropic API, ' +
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0 for a Bedrock implementation.'
    );
  }
  console.log('🔐 Using Anthropic API authentication');

  console.error(`Fetching ${JSON.stringify(owner + '/' + repo)} #${prNumber} from GitHub...`);
  const orchestrator = new CodeReviewOrchestrator({ onProgress: showProgress });
  const report = await orchestrator.reviewPullRequest(owner, repo, prNumber).finally(() => {
    if (process.stderr.isTTY) {
      process.stderr.clearLine(0);
      process.stderr.cursorTo(0);
    }
  });
  console.error('Review validated. Saving reports...');
  const generator = new ReportGenerator();
  const directory = 'reports';
  const basename = `${owner}_${repo}_${prNumber}`;
  await mkdir(directory, { recursive: true });
  for (const [extension, content] of [
    ['json', generator.generateJSONReport(report)],
    ['md', generator.generateMarkdownReport(report)],
    ['html', generator.generateHTMLReport(report)]
  ] as const) {
    const file = join(directory, `${basename}.${extension}`);
    await writeFile(file, content, 'utf8');
    console.log(`Saved ${file}`);
  }
}

main().catch(error => {
  console.error(formatError(error));
  process.exitCode = 1;
});
