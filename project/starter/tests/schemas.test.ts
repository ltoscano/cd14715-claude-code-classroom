import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CodeQualityResultSchema, TestCoverageResultSchema, RefactoringSuggestionSchema,
  CodeQualityResultJSONSchema, TestCoverageResultJSONSchema, RefactoringSuggestionJSONSchema
} from '../src/types/analysis-results.js';
import { ReviewReportSchema, ReviewReportJSONSchema } from '../src/types/report-types.js';
import { report } from './fixture.js';

describe('Udacity schemas', () => {
  const file = report.fileReviews[0]!;

  it('accepts all three analyses and the final report', () => {
    expect(CodeQualityResultSchema.parse(file.codeQuality)).toEqual(file.codeQuality);
    expect(TestCoverageResultSchema.parse(file.testCoverage)).toEqual(file.testCoverage);
    expect(RefactoringSuggestionSchema.parse(file.refactorings)).toEqual(file.refactorings);
    expect(ReviewReportSchema.parse(report)).toEqual(report);
  });

  it('rejects missing fields, invalid types and enum values', () => {
    expect(() => ReviewReportSchema.parse({ ...report, summary: undefined })).toThrow(ZodError);
    expect(() => TestCoverageResultSchema.parse({ ...file.testCoverage, hasTests: 'true' })).toThrow(ZodError);
    expect(() => CodeQualityResultSchema.parse({
      ...file.codeQuality, issues: [{ line: 1, severity: 'urgent', category: 'style', description: 'Issue', suggestion: 'Fix' }]
    })).toThrow(ZodError);
    expect(() => RefactoringSuggestionSchema.parse({
      ...file.refactorings,
      suggestions: [{
        type: 'simplify', location: '1', impact: 'urgent', description: 'Simplify a branch',
        before: 'if (ok) return true;', after: 'return ok;', benefits: 'Fewer branches'
      }]
    })).toThrow(ZodError);
  });

  it('accepts empty arrays and the score boundaries', () => {
    expect(ReviewReportSchema.safeParse({ ...report, fileReviews: [] }).success).toBe(true);
    expect(TestCoverageResultSchema.safeParse({ ...file.testCoverage, testFiles: [], untestedPaths: [] }).success).toBe(true);
    for (const overallScore of [0, 100]) {
      expect(CodeQualityResultSchema.safeParse({ ...file.codeQuality, overallScore }).success).toBe(true);
      expect(TestCoverageResultSchema.safeParse({ ...file.testCoverage, coverageEstimate: overallScore }).success).toBe(true);
    }
    expect(CodeQualityResultSchema.safeParse({ ...file.codeQuality, overallScore: 101 }).success).toBe(false);
    expect(TestCoverageResultSchema.safeParse({ ...file.testCoverage, coverageEstimate: -1 }).success).toBe(false);
  });

  // The template defines no optional fields in these four schemas.
  it.each([
    ['code quality', CodeQualityResultJSONSchema, ['file', 'issues', 'overallScore', 'summary']],
    ['test coverage', TestCoverageResultJSONSchema, ['file', 'hasTests', 'testFiles', 'untestedPaths', 'coverageEstimate', 'summary']],
    ['refactoring', RefactoringSuggestionJSONSchema, ['file', 'suggestions', 'summary']],
    ['report', ReviewReportJSONSchema, ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']]
  ] as const)('exports an object and its required properties for %s', (_name, schema, required) => {
    expect(schema).toMatchObject({ type: 'object', required });
    expect(Object.keys(schema.properties as object)).toEqual(required);
  });
});
