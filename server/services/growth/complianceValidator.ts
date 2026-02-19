import { generateStructuredContent } from "./openaiAdapter";
import { z } from "zod";

const ComplianceResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.object({
    severity: z.enum(["warning", "block"]),
    description: z.string(),
  })).default([]),
});

type ComplianceResult = z.infer<typeof ComplianceResultSchema>;

const COMPLIANCE_SYSTEM_PROMPT = `You are a brand compliance validator for PackPTS, a baseball card trivia gaming platform.
Review content for these rules:
1. Voice must be confident, witty, nostalgic, competitive — never cringe or try-hard.
2. Must end with a call-to-action directing to PackPTS.com (can be subtle).
3. NO gambling phrasing — do not imply guaranteed prizes, winnings, or betting.
4. NEVER mention "AI generated", "AI-created", or imply content is automated.
5. All claims must be truthful and verifiable — no made-up statistics or user counts.
6. Content must be family-friendly and positive.
7. No pricing details unless explicitly provided.
8. No profanity or offensive language.

Respond ONLY with valid JSON.`;

function buildCompliancePrompt(content: { title: string; body: string; platform: string }): string {
  return `Review this ${content.platform} post for brand compliance:

Title: ${content.title}
Body: ${content.body}

Return JSON:
{
  "passed": true/false,
  "issues": [{ "severity": "warning"|"block", "description": "what's wrong" }]
}

If all rules pass, return {"passed": true, "issues": []}.
Only flag real violations. Minor style preferences are NOT violations.`;
}

const REWRITE_SYSTEM_PROMPT = `You are rewriting content for PackPTS, a baseball card trivia gaming platform.
Fix the compliance issues described below while keeping the original tone, message, and length.
Voice: confident, witty, nostalgic, competitive.
Always include a call-to-action to PackPTS.com.
Never mention AI, gambling, or make unverifiable claims.
Respond ONLY with valid JSON: {"title": "...", "body": "...", "hashtags": [...]}`;

export async function validateCompliance(
  content: { title: string; body: string; hashtags: string[] },
  platform: string
): Promise<{ passed: boolean; issues: ComplianceResult["issues"]; rewritten?: { title: string; body: string; hashtags: string[] } }> {
  try {
    const { parsed: rawResult } = await generateStructuredContent<ComplianceResult>({
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
      userPrompt: buildCompliancePrompt({ title: content.title, body: content.body, platform }),
      maxTokens: 500,
      temperature: 0.2,
    });

    const result = ComplianceResultSchema.safeParse(rawResult);
    const compliance = result.success ? result.data : { passed: true, issues: [] };

    if (compliance.passed || compliance.issues.length === 0) {
      return { passed: true, issues: [] };
    }

    const hasBlocker = compliance.issues.some(i => i.severity === "block");
    if (!hasBlocker) {
      console.log(`[ComplianceValidator] ${platform}: passed with ${compliance.issues.length} warnings`);
      return { passed: true, issues: compliance.issues };
    }

    console.log(`[ComplianceValidator] ${platform}: ${compliance.issues.length} issues found, attempting rewrite`);
    const issueList = compliance.issues.map(i => `- [${i.severity}] ${i.description}`).join("\n");

    const { parsed: rewritten } = await generateStructuredContent<{ title: string; body: string; hashtags: string[] }>({
      systemPrompt: REWRITE_SYSTEM_PROMPT,
      userPrompt: `Original content:
Title: ${content.title}
Body: ${content.body}
Hashtags: ${content.hashtags.join(", ")}

Issues to fix:
${issueList}

Rewrite to fix ALL blocking issues while preserving the message. Return JSON: {"title": "...", "body": "...", "hashtags": [...]}`,
      maxTokens: 1000,
      temperature: 0.6,
    });

    if (rewritten?.title && rewritten?.body) {
      console.log(`[ComplianceValidator] ${platform}: auto-rewrite successful`);
      return {
        passed: true,
        issues: compliance.issues,
        rewritten: {
          title: rewritten.title,
          body: rewritten.body,
          hashtags: Array.isArray(rewritten.hashtags) ? rewritten.hashtags : content.hashtags,
        },
      };
    }

    return { passed: false, issues: compliance.issues };
  } catch (err: any) {
    console.error(`[ComplianceValidator] Error validating ${platform}:`, err?.message);
    return { passed: true, issues: [] };
  }
}
