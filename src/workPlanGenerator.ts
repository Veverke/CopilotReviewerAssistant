import { ReviewComment, SeverityScore } from './githubApi';

export type ComplexityScore = 'low' | 'medium' | 'high';

export interface AnnotatedComment {
  comment: ReviewComment;
  workPlan: string;
  complexity?: ComplexityScore;
  severity?: SeverityScore;
  fileFound?: boolean;
  warnings?: string[];
}
