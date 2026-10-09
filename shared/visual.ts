import { z } from 'zod';

export const visualSchema = z
  .object({
    title: z.string().min(1).max(90),
    summary: z.string().min(1).max(350),
    metaphor: z.string().min(1).max(100),
    elements: z
      .array(
        z
          .object({
            type: z.enum(['panel', 'text', 'arrow', 'bar', 'circle']),
            x: z.number().min(0).max(1000),
            y: z.number().min(0).max(500),
            width: z.number().min(-1000).max(1000),
            height: z.number().min(-500).max(500),
            text: z.string().max(100),
            detail: z.string().max(180),
            tone: z.enum(['neutral', 'a', 'b', 'warning', 'success']),
          })
          .strict(),
      )
      .min(2)
      .max(40),
    options: z
      .array(
        z
          .object({
            action: z.enum(['a', 'b', 'a-first', 'b-first', 'reviewed']),
            label: z.string().min(1).max(70),
            description: z.string().min(1).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type VisualSpec = z.infer<typeof visualSchema>;
export type Visual = VisualSpec & {
  path: string;
  conflictId?: string;
  origin: 'ai' | 'example';
  provider: string;
  model?: string;
  responseId?: string;
  generatedAt: string;
  generationId: string;
  durationMs: number;
  inputHash: string;
  contextFiles: string[];
};
export const actionDecision = (action: VisualSpec['options'][number]['action']) =>
  action === 'a-first' || action === 'b-first'
    ? { choice: 'both' as const, order: action }
    : { choice: action };
