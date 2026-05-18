import { ReviewComment } from './githubApi';

export type ComplexityScore = 'low' | 'medium' | 'high';

export interface AnnotatedComment {
  comment: ReviewComment;
  workPlan: string;
  complexity?: ComplexityScore;
  fileFound?: boolean;
  warnings?: string[];
}
