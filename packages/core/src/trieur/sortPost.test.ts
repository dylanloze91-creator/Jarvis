import { describe, expect, it } from 'vitest';
import { SORT_POST_MAX_BODY, sortPostBodySizeOk, sortPostContentTypeOk } from './sortPost.js';

describe('trieur sort POST', () => {
  it('exige application/json et un corps ≤ 4 Ko', () => {
    expect(sortPostContentTypeOk('application/json')).toBe(true);
    expect(sortPostContentTypeOk('application/json; charset=utf-8')).toBe(true);
    expect(sortPostContentTypeOk('text/plain')).toBe(false);
    expect(sortPostBodySizeOk(SORT_POST_MAX_BODY)).toBe(true);
    expect(sortPostBodySizeOk(SORT_POST_MAX_BODY + 1)).toBe(false);
  });
});
