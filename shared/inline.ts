import type { Review } from './review';

export const INLINE_REVIEW_URI = 'ui://fuse/review.html';
export const INLINE_REVIEW_MIME = 'text/html;profile=mcp-app';

export interface InlineReviewMetadata {
  reviewId: string;
  capability?: string;
  visualSvg?: string;
}
export interface InlineReviewResult {
  content: { type: 'text'; text: string }[];
  structuredContent: { schemaVersion: 1; data: Review };
  _meta: { fuse: InlineReviewMetadata };
}
