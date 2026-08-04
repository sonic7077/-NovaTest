import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { arkAiCommentReviewCases, seedArkAiCommentReviewCases } from '../server/seed/ark-ai-comment-review-cases.js';

describe('Ark AI comment review API cases', () => {
  it('defines a 60-case Editorial matrix without unsafe generated requests', () => {
    const cases = arkAiCommentReviewCases({ projectId: 'editorial-project', baseUrl: 'https://editorial.example.test' });

    expect(cases.slice(0, 4).map((testCase) => testCase.name)).toEqual([
      'AI 评论概览查询', 'AI 评论审核列表查询', 'AI 评论人工通过闭环', 'AI 评论人工驳回闭环'
    ]);
    const generatedCases = cases.slice(4);
    expect(cases).toHaveLength(60);
    expect(generatedCases.filter((testCase) => testCase.name.includes('正例'))).toHaveLength(36);
    expect(generatedCases.filter((testCase) => testCase.name.includes('反例'))).toHaveLength(20);
    expect(generatedCases.every((testCase) => testCase.target === 'api' && testCase.steps.length === 1)).toBe(true);
    expect(generatedCases.flatMap((testCase) => testCase.steps).every((step) => step.request.protocol === 'editorial' && step.request.method === 'GET' && step.request.safety === 'readonly')).toBe(true);
    expect(cases.flatMap((testCase) => testCase.steps).every((step) => step.request.protocol === 'editorial')).toBe(true);
    expect(generatedCases.flatMap((testCase) => testCase.steps).some((step) => step.request.action === 'ai-comment/trigger' || step.request.action === 'ai-comment-review/action' || step.request.payload.action === 'delete')).toBe(false);
    expect(cases.filter((testCase) => testCase.name.includes('人工')).flatMap((testCase) => testCase.steps)
      .some((step) => step.request.safety === 'mutating')).toBe(true);
  });

  it('stores the cases in the 方舟AI评论审核 project idempotently', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '方舟AI评论审核' });

    expect(seedArkAiCommentReviewCases(store, { baseUrl: 'https://first.example.test' })).toBe(60);
    expect(seedArkAiCommentReviewCases(store, { baseUrl: 'https://second.example.test' })).toBe(60);
    expect(store.listCases('', project.id)).toHaveLength(60);
    expect(store.listCases('', project.id).every((testCase) => testCase.baseUrl === 'https://second.example.test')).toBe(true);
  });
});
