import type { ReviewReport } from '../src/types/report-types.js';

export const report: ReviewReport = {
  pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
  fileReviews: [{
    file: 'src/list.js',
    codeQuality: { file: 'src/list.js', issues: [], overallScore: 85, summary: 'No material issues.' },
    testCoverage: { file: 'src/list.js', hasTests: true, testFiles: ['tests/list.js'],
      untestedPaths: [], coverageEstimate: 100, summary: 'The existing test covers the change.' },
    refactorings: { file: 'src/list.js', suggestions: [], summary: 'No refactoring needed.' }
  }],
  summary: { totalFiles: 1, overallScore: 85, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 },
  recommendations: [],
  metadata: { analyzedAt: '2026-11-16T20:00:00Z', duration: 100, agentVersions: {} }
};
