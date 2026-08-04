import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../server/app.js';
import { arkAiCommentReviewCases, seedArkAiCommentReviewCases } from '../server/seed/ark-ai-comment-review-cases.js';

describe('Ark AI comment review API cases', () => {
  it('defines the four documented non-delete Editorial API cases', () => {
    const cases = arkAiCommentReviewCases({ projectId: 'editorial-project', baseUrl: 'https://editorial.example.test' });

    expect(cases.map((testCase) => testCase.name)).toEqual([
      'AI 评论概览查询', 'AI 评论审核列表查询', 'AI 评论人工通过闭环', 'AI 评论人工驳回闭环'
    ]);
    expect(cases.flatMap((testCase) => testCase.steps).every((step) => step.request.protocol === 'editorial')).toBe(true);
    expect(JSON.stringify(cases).toLowerCase()).not.toContain('delete');
    expect(JSON.stringify(cases)).not.toContain('trigger');
    expect(cases.filter((testCase) => testCase.name.includes('人工')).flatMap((testCase) => testCase.steps)
      .some((step) => step.request.safety === 'mutating')).toBe(true);
  });

  it('stores the cases in the 方舟AI评论审核 project idempotently', () => {
    const store = createMemoryStore();
    const project = store.saveProject({ name: '方舟AI评论审核' });

    expect(seedArkAiCommentReviewCases(store, { baseUrl: 'https://first.example.test' })).toBe(4);
    expect(seedArkAiCommentReviewCases(store, { baseUrl: 'https://second.example.test' })).toBe(4);
    expect(store.listCases('', project.id)).toHaveLength(4);
    expect(store.listCases('', project.id).every((testCase) => testCase.baseUrl === 'https://second.example.test')).toBe(true);
  });
});
